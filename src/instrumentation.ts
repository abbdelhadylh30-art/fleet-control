// ─── Runtime env normalization (Next.js instrumentation) ────────────────────
// Runs once per server start. Fleet Control's Prisma schema reads
// DATABASE_URL (pooled) + DIRECT_URL (direct). Different attach paths use
// different names:
//   • Vercel Storage / Neon marketplace → DATABASE_URL + DATABASE_URL_UNPOOLED
//   • older Vercel Postgres attach      → POSTGRES_URL + POSTGRES_URL_NON_POOLING
//   • self-wired (this dashboard's ops) → DATABASE_URL + DIRECT_URL
// This shim maps any of them onto the two names the schema expects, so the
// Postgres state layer works no matter which path provisioned the database.

export function register() {
  // only meaningful in the Node.js runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!process.env.DATABASE_URL) {
    if (process.env.POSTGRES_URL) process.env.DATABASE_URL = process.env.POSTGRES_URL;
  }
  if (!process.env.DIRECT_URL) {
    if (process.env.DATABASE_URL_UNPOOLED) process.env.DIRECT_URL = process.env.DATABASE_URL_UNPOOLED;
    else if (process.env.POSTGRES_URL_NON_POOLING) process.env.DIRECT_URL = process.env.POSTGRES_URL_NON_POOLING;
    else if (process.env.POSTGRES_URL_NO_POOLING) process.env.DIRECT_URL = process.env.POSTGRES_URL_NO_POOLING;
  }
}
