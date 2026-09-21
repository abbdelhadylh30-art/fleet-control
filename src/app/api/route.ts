import { NextResponse } from "next/server";

// 2026-09-21: replaced the leftover "Hello, world!" stub with a minimal,
// version-free service descriptor — no reason to confirm reachability with
// template noise.
export async function GET() {
  return NextResponse.json(
    { ok: true, service: "fleet-control" },
    { headers: { "cache-control": "no-store" } },
  );
}
