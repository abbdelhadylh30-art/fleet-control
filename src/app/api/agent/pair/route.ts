// ─── /api/agent/pair — RETIRED (v22) ─────────────────────────────────────────
// Pairing codes are gone. The dashboard now mints TEMP PASSWORDS (fac_…) for
// the approval flow instead: create-access-code → the AI requests at
// /api/agent/access → the owner approves → the AI polls and gets a 1-hour
// session. Kept as a route so old callers get a structured answer.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "retired: pairing codes are disabled — mint a temp access password (fac_…) in the dashboard and use /api/agent/access instead",
    },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}