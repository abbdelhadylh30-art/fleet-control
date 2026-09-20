// ─── /api/selfops — the dashboard's own deployment control room ──────────────
// GET        → status: fs persistence probe, env agent keys, latest production deploy
// POST       → { action: "redeploy" }                          → fresh production deploy
//              { action: "promote", key: "flk_…" }             → minted link → permanent env key + redeploy
//
// Only reachable from the dashboard behind the admin gate (never exposed
// through /api/agent/proxy), so promotions are limited to keys actually
// minted by this instance — plus a one-time challenge on every action.

import { NextResponse } from "next/server";

import { promoteSessionToEnv, redeployProduction, selfOpsStatus } from "@/lib/selfops";
import { logSecurityEvent, requireAdmin, requireChallenge } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // exposes env key hints + deployment internals → admin-only
  const gate = requireAdmin(request);
  if (gate) return gate;
  const status = await selfOpsStatus();
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const gate = requireAdmin(request);
  if (gate) return gate;

  let body: { action?: string; key?: string; confirmToken?: string };
  try {
    body = (await request.json()) as { action?: string; key?: string; confirmToken?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action === "redeploy") {
    // destructive (touches production) → one-time challenge required
    const ch = requireChallenge(body as Record<string, unknown>, "selfops-redeploy");
    if (ch) return ch;
    const res = await redeployProduction();
    if (res.ok) {
      await logSecurityEvent({
        kind: "selfops-redeploy",
        detail: `production redeploy uid=${res.uid ?? "?"} (challenge-confirmed)`,
        request,
      });
    }
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  }

  if (body.action === "promote" && typeof body.key === "string") {
    const ch = requireChallenge(body as Record<string, unknown>, "selfops-promote");
    if (ch) return ch;
    const res = await promoteSessionToEnv(body.key.trim());
    if (res.ok && res.updated) {
      await logSecurityEvent({
        kind: "selfops-promote",
        detail: `minted key promoted to FLEET_AGENT_KEYS + redeploy ${res.redeployUid ?? ""}`,
        request,
      });
    }
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  return NextResponse.json(
    { ok: false, error: "action must be \"redeploy\" or \"promote\" (+ key)." },
    { status: 400 },
  );
}
