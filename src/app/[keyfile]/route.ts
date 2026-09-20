// ─── IndexNow key file — /[KEY].txt for the dashboard's own domain ───────────
// Fleet Control joins its own fleet, so it must serve the IndexNow key like
// every other site. The dynamic segment ONLY responds for the real key
// (with or without .txt) — every other single-segment path gets a 404 so the
// route never masks broken links.

import { NextResponse } from "next/server";

import { INDEXNOW_KEY } from "@/lib/fleet";

export const dynamic = "force-static";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ keyfile: string }> },
) {
  const { keyfile } = await params;
  const valid = new Set([INDEXNOW_KEY, `${INDEXNOW_KEY}.txt`]);
  if (!valid.has(keyfile)) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(INDEXNOW_KEY, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
