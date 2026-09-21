// ─── /api/analytics — full fleet analytics feed (open, aggregates only) ─────
// Mirrors /api/fleet's openness: every value here is aggregate telemetry, no
// secrets, no token material. Rebuilds live on each call (cheap: a handful of
// FS reads + 2 upstream calls when Vercel is connected).

import { NextResponse } from "next/server";

import { buildAnalytics } from "@/lib/analytics";
import { requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  // 2026-09-21: admin-gated — was public and handed out deployments, repo
  // lists and host→project mappings (infrastructure reconnaissance).
  const gate = requireAdmin(req);
  if (gate) return gate;

  const data = await buildAnalytics();
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
