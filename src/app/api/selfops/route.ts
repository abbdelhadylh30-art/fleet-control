// ─── /api/selfops — the dashboard's own deployment control room ──────────────
// GET        → status: fs persistence probe, env agent keys, latest production deploy
// POST       → { action: "redeploy" }                          → fresh production deploy
//              { action: "promote", key: "flk_…" }             → minted link → permanent env key + redeploy
//
// Only reachable from the dashboard (never exposed through /api/agent/proxy),
// so promotions are limited to keys actually minted by this instance.

import { NextResponse } from "next/server";

import { promoteSessionToEnv, redeployProduction, selfOpsStatus } from "@/lib/selfops";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const status = await selfOpsStatus();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  let body: { action?: string; key?: string };
  try {
    body = (await request.json()) as { action?: string; key?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action === "redeploy") {
    const res = await redeployProduction();
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  }

  if (body.action === "promote" && typeof body.key === "string") {
    const res = await promoteSessionToEnv(body.key.trim());
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  return NextResponse.json(
    { ok: false, error: "action must be \"redeploy\" or \"promote\" (+ key)." },
    { status: 400 },
  );
}
