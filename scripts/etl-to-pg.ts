// One-off ETL: seed Neon PgState with the local db/*.json history so the
// deployed (previously stateless) instance starts with real data.
// Idempotent — checks the PG row DIRECTLY (readState would silently fall back
// to the file copy and false-positive "already migrated").
// Run with: bun scripts/etl-to-pg.ts
import { promises as fs } from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { writeState } from "../src/lib/pg-state";

const db = new PrismaClient();
const DB_DIR = path.join(process.cwd(), "db");

const KEYS = [
  "uptime-log",
  "score-history",
  "incidents",
  "security-events",
  "indexnow-log",
  "agent-activity",
  "agent-sessions",
  "autopilot",
  "autopilot-log",
  "postgres-audit",
  "pg-migration-status",
];

async function main() {
  let migrated = 0;
  for (const key of KEYS) {
    const file = path.join(DB_DIR, `${key}.json`);
    let value: unknown;
    try {
      value = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      console.log(`- ${key}: no local file, skipped`);
      continue;
    }
    try {
      const row = await db.pgState.findUnique({ where: { key } });
      if (row && JSON.stringify(row.value) === JSON.stringify(value)) {
        console.log(`= ${key}: identical row already in Postgres, skipped`);
        continue;
      }
      const persisted = await writeState(key, value);
      migrated += persisted ? 1 : 0;
      const n = Array.isArray(value) ? value.length : "object";
      console.log(`${persisted ? "✓" : "✗"} ${key}: ${persisted ? "persisted" : "FAILED"} (${n} entries)`);
    } catch (e) {
      console.log(`✗ ${key}: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`);
    }
  }
  const total = await db.pgState.count();
  console.log(`\nDone. migrated=${migrated}, total PgState rows=${total}`);
  await db.$disconnect();
}

main();
