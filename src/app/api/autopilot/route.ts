// ─── /api/autopilot — auto-pilot config + action log ────────────────────────
// GET  → { config, log } — admin-gated since 2026-09-21 (the heal log
//        names hosts, projects and deploy uids — recon when anonymous).
// POST → { action: "set", autoHeal: boolean } — admin-gated master switch.

import { NextResponse } from "next/server";

import {
  readAutoPilotConfig,
  readAutoPilotLog,
  writeAutoPilotConfig,
} from "@/lib/autopilot";
import { requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  const [config, log] = await Promise.all([readAutoPilotConfig(), readAutoPilotLog()]);
  return NextResponse.json(
    { config, log: log.slice(0, 20) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  let body: { action?: string; autoHeal?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "set") {
    const config = { autoHeal: Boolean(body.autoHeal) };
    await writeAutoPilotConfig(config);
    return NextResponse.json({ ok: true, config });
  }

  return NextResponse.json(
    { error: 'Unknown action — expected "set".' },
    { status: 400 },
  );
}
