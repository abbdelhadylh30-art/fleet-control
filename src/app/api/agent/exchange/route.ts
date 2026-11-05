// ─── /api/agent/exchange — RETIRED (v22) ─────────────────────────────────────
// The pair-code handoff and the direct-link exchange are gone. The ONLY way
// an AI gets access now is the approval flow:
//
//   POST /api/agent/access { action: "request", code: "fac_…", client }
//     → pending request lands in the owner's dashboard
//     → owner approves → poll with the same code → 1-hour fls_ session
//
// Kept as a route so old integrations get a clear, structured answer instead
// of a bare 404.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "retired: pair codes and direct-link exchanges are disabled — use /api/agent/access with a temp password (fac_…): request → owner approval → poll",
    },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}