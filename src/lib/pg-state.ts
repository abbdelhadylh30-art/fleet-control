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

/**
 * Write a state blob: upsert into Postgres (durable) and best-effort mirror
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
