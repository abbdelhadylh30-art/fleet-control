// One-off: inspect PgState rows in Neon (run with: bun scripts/pg-check.ts)
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const rows = await db.pgState.findMany({ select: { key: true, updatedAt: true } });
console.log("PgState rows:", rows.length);
for (const r of rows) console.log(" -", r.key, "|", r.updatedAt.toISOString());
await db.$disconnect();
