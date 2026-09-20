// ─── /api/security — read-only view of the security event log ────────────────
// GET → recent security events (auth failures, rate limits, blocked paths,
//       challenge-confirmed destructive ops). Admin-only: the log contains
//       IPs and user-agents, so it must not be public.
//
// Events are ALWAYS written to console.warn (durable via the Vercel log
// drain) and best-effort to db/security-events.json (visible here while the
// lambda is warm — persistence moves to Postgres with the next milestone).

import { NextResponse } from "next/server";

import { readSecurityEvents, requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = requireAdmin(request);
  if (gate) return gate;
  const events = await readSecurityEvents();
  return NextResponse.json(
    { events, count: events.length },
    { headers: { "cache-control": "no-store" } },
  );
}
