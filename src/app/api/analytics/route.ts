// ─── /api/analytics — full fleet analytics feed (open, aggregates only) ─────
// Mirrors /api/fleet's openness: every value here is aggregate telemetry, no
// secrets, no token material. Rebuilds live on each call (cheap: a handful of
// FS reads + 2 upstream calls when Vercel is connected).

import { NextResponse } from "next/server";

import { buildAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const data = await buildAnalytics();
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
