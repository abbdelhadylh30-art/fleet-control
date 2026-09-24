import { NextResponse } from "next/server";

import { readResubmitLog, readWatchState, runDeployWatch } from "@/lib/deploy-watch";
import { readVercelTokenForAgent } from "@/lib/vercel-ops";
import { requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";

/** GET → watch state + recent deploy-triggered resubmission log (admin). */
export async function GET(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  const [state, log, vaultToken] = await Promise.all([
    readWatchState(),
    readResubmitLog(15),
    readVercelTokenForAgent(),
  ]);
  return NextResponse.json(
    { state, log, vaultConnected: Boolean(vaultToken) },
    { headers: { "cache-control": "no-store" } },
  );
}

/** POST { action: "run" } → force a watch pass now (bypasses throttle via direct call). */
export async function POST(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.action !== "run") {
    return NextResponse.json(
      { error: 'Unknown action — expected "run".' },
      { status: 400 },
    );
  }

  const result = await runDeployWatch(true);
  const [state, log] = await Promise.all([readWatchState(), readResubmitLog(15)]);
  return NextResponse.json({ ok: true, ...result, state, log });
}
