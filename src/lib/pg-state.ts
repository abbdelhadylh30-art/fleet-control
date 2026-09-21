// ─── pg-state — durable JSON state in Postgres (Neon), file fallback ────────
// Every runtime-state lib (security events, activity, uptime, sessions…)
// stores its state through this layer. When DATABASE_URL is present the state
// lives in the `PgState` table and SURVIVES serverless cold starts; when it is
// absent (local dev without a DB) the layer transparently falls back to the
// classic db/<key>.json files, so nothing breaks anywhere.

import { promises as fs } from "fs";
import path from "path";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export const pgEnabled = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_URL,
);

const DB_DIR = path.join(process.cwd(), "db");

async function readFromFile<T>(key: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(DB_DIR, `${key}.json`), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeToFile(key: string, value: unknown): Promise<void> {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
    await fs.writeFile(path.join(DB_DIR, `${key}.json`), JSON.stringify(value, null, 2), "utf8");
  } catch {
    /* read-only FS (serverless) — best-effort */
  }
}

/**
 * Delete a state blob entirely (e.g. credential disconnect). Removes the
 * Postgres row and the local file copy when possible. Returns true when the
 * row was durably deleted in Postgres.
 */
export async function deleteState(key: string): Promise<boolean> {
  let persisted = false;
  if (pgEnabled) {
    try {
      await db.pgState.delete({ where: { key } });
      persisted = true;
    } catch {
      /* row may not exist — treat as deleted */
      persisted = true;
    }
  }
  try {
    await fs.rm(path.join(DB_DIR, `${key}.json`), { force: true });
  } catch {
    /* best-effort */
  }
  return persisted;
}

/** Read a state blob: Postgres first (durable), file as fallback. */
export async function readState<T>(key: string): Promise<T | null> {
  if (pgEnabled) {
    try {
      const row = await db.pgState.findUnique({ where: { key } });
      if (row) return row.value as T;
    } catch {
      /* PG hiccup — fall through to the file copy */
    }
  }
  return readFromFile<T>(key);
}

export interface StateLayerMeta {
  mode: "postgres" | "file";
  version: number | null; // CAS version of the row (null when unknown/file)
  updatedAt: string | null; // ISO timestamp of the last durable write
}

/**
 * Health metadata for one state key (L4 state-layer health surface).
 * Reads only the row's version/updatedAt columns — never the value — so it
 * is cheap and safe to expose in the admin payload.
 */
export async function readStateMeta(key: string): Promise<StateLayerMeta> {
  if (pgEnabled) {
    try {
      const row = await db.pgState.findUnique({
        where: { key },
        select: { version: true, updatedAt: true },
      });
      if (row) {
        return {
          mode: "postgres",
          version: row.version,
          updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
        };
      }
      return { mode: "postgres", version: null, updatedAt: null };
    } catch {
      return { mode: "postgres", version: null, updatedAt: null };
    }
  }
  return { mode: "file", version: null, updatedAt: null };
}

/** Write a state blob: upsert into Postgres (durable) and best-effort mirror
 * to the file (keeps local dev + any pre-PG reader in sync). Returns true
 * when the row was durably persisted in Postgres.
 */
export async function writeState(key: string, value: unknown): Promise<boolean> {
  let persisted = false;
  if (pgEnabled) {
    try {
      const data = value as Prisma.InputJsonValue;
      await db.pgState.upsert({
        where: { key },
        update: { value: data },
        create: { key, value: data },
      });
      persisted = true;
    } catch {
      /* PG hiccup — the file mirror below still records it */
    }
  }
  if (!persisted) await writeToFile(key, value);
  return persisted;
}

/**
 * Atomic read-modify-write on a state blob (2026-09-21 H1 fix).
 *
 * The old pattern — `readState` → mutate in JS → `writeState` — loses every
 * concurrent update (last write wins on the WHOLE blob), which corrupted the
 * incident history (recoveredAt before startedAt) and drops security events,
 * session call-counts and uptime samples under load.
 *
 * This helper runs the mutation against the row's CURRENT value and commits
 * it with an optimistic compare-and-swap:
 *
 *   UPDATE "PgState" SET value=$next, version=version+1
 *   WHERE key=$key AND version=$seen
 *
 * If another writer landed first, zero rows match → re-read and retry (with
 * jittered backoff). Every statement is a single round-trip, so it is safe
 * through Neon's transaction-mode pooler (no interactive transactions, no
 * session pinning, no FOR UPDATE).
 *
 * Returning `null` from `mutate` DELETES the row (only if still at the
 * version that was read). The callback must be pure-ish: it may run more
 * than once when a retry happens.
 *
 * File-fallback mode (no DATABASE_URL) keeps the plain RMW — local dev is a
 * single process, so the race doesn't exist there.
 */
export async function mutateState<T>(
  key: string,
  mutate: (current: T | null) => T | null,
  opts: { retries?: number } = {},
): Promise<T | null> {
  const retries = opts.retries ?? 5;

  if (!pgEnabled) {
    const cur = await readFromFile<T>(key);
    const next = mutate(cur);
    if (next === null) {
      await fs.rm(path.join(DB_DIR, `${key}.json`), { force: true }).catch(() => {});
    } else {
      await writeToFile(key, next);
    }
    return next;
  }

  for (let attempt = 0; ; attempt++) {
    // Fresh read each attempt — carries the version we base the CAS on.
    const row = await db.pgState.findUnique({ where: { key } });
    const cur = (row?.value as T | undefined) ?? null;
    const next = mutate(cur);
    if (next === undefined) {
      throw new TypeError(`mutateState(${key}): callback must return a value or null`);
    }

    if (next === null) {
      if (!row) return null; // already gone — done
      const n = await db.$executeRaw`
        DELETE FROM "PgState" WHERE "key" = ${key} AND "version" = ${row.version}`;
      if (n === 1) return null;
      // else: version moved under us → retry
    } else if (row) {
      const n = await db.$executeRaw`
        UPDATE "PgState"
        SET "value" = ${JSON.stringify(next)}::jsonb,
            "version" = "version" + 1,
            "updatedAt" = now()
        WHERE "key" = ${key} AND "version" = ${row.version}`;
      if (n === 1) return next;
      // else: lost the race → retry with a fresh read
    } else {
      const n = await db.$executeRaw`
        INSERT INTO "PgState" ("key", "value", "version", "updatedAt")
        VALUES (${key}, ${JSON.stringify(next)}::jsonb, 1, now())
        ON CONFLICT ("key") DO NOTHING`;
      if (n === 1) return next;
      // else: someone created the row first → retry (row now exists)
    }

    if (attempt >= retries) {
      throw new Error(
        `mutateState(${key}): lost ${retries + 1} optimistic-write races — state too hot`,
      );
    }
    // Jittered backoff so hot keys (agent-sessions on proxy bursts) don't
    // lockstep into the same retry cadence.
    await new Promise((r) => setTimeout(r, 30 * (attempt + 1) + Math.random() * 25));
  }
}
