// ─── API catch-all — JSON 404 for unknown /api/* paths ───────────────────────
// Audit L2 (2026-09-20): unknown API paths used to return the 13KB HTML app
// shell — confusing for API clients and wasted bytes. Concrete routes always
// win over this catch-all (Next.js route precedence), so only genuinely
// unknown API paths land here. Every method answers the same JSON shape so
// clients get a parseable error instead of an HTML parse bomb.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function unknown(path: string) {
  return NextResponse.json(
    { ok: false, error: "Unknown API route.", path },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

type Ctx = { params: Promise<{ unknown: string[] }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { unknown: seg } = await params;
  return unknown(`/api/${seg.join("/")}`);
}
export async function POST(req: Request, ctx: Ctx) {
  return GET(req, ctx);
}
export async function PUT(req: Request, ctx: Ctx) {
  return GET(req, ctx);
}
export async function PATCH(req: Request, ctx: Ctx) {
  return GET(req, ctx);
}
export async function DELETE(req: Request, ctx: Ctx) {
  return GET(req, ctx);
}
export async function HEAD(req: Request, ctx: Ctx) {
  return GET(req, ctx);
}
