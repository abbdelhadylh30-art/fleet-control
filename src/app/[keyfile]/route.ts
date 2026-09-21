// ─── IndexNow key file — /[KEY].txt for the dashboard's own domain ───────────
// Fleet Control joins its own fleet, so it must serve the IndexNow key like
// every other site. The dynamic segment ONLY responds for the real key
// (with or without .txt) — every other single-segment path gets a 404 so the
// route never masks broken links.

import { NextResponse } from "next/server";

import { INDEXNOW_KEY } from "@/lib/fleet";

export const dynamic = "force-static";

/** L2 (2026-09-21): single-segment misses used to return a bare 9-byte
 *  "Not found". Route handlers can't render the app's not-found page (that
 *  path renders through the gated layout), so this serves a tiny
 *  self-contained branded 404 with a recovery link — same design language,
 *  zero framework dependencies, deterministic in dev and prod. */
const KEYFILE_MISS_404 = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>404 — Fleet Control</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0a0c10;color:#e4e4e7;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    text-align:center;padding:1rem}
  .rings{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
  .rings div{position:absolute;border-radius:9999px;border:1px solid rgba(16,185,129,.25)}
  .r1{width:560px;height:560px}.r2{width:380px;height:380px;border-color:rgba(16,185,129,.4)}
  .r3{width:220px;height:220px;border-color:rgba(16,185,129,.55)}
  .code{font:600 64px/1 ui-monospace,monospace;color:rgba(52,211,153,.9);margin:0 0 8px}
  h1{font-size:16px;margin:0}
  p{color:#71717a;font-size:14px;max-width:34ch;margin:8px auto 0;line-height:1.6}
  a{display:inline-block;margin-top:28px;height:44px;padding:0 20px;line-height:44px;border-radius:10px;
    background:#10b981;color:#052e21;font-weight:600;font-size:13px;text-decoration:none}
  @media (max-width:640px){.r1{width:340px;height:340px}.r2{width:230px;height:230px}.r3{width:140px;height:140px}}
</style></head>
<body>
  <div class="rings" aria-hidden="true"><div class="r1"></div><div class="r2"></div><div class="r3"></div></div>
  <div style="position:relative">
    <p class="code" aria-hidden="true">404</p>
    <h1>Off the chart</h1>
    <p>This coordinate isn&rsquo;t in the fleet. The page may have moved, or the link that brought you here is stale.</p>
    <a href="/">Back to the dashboard &rarr;</a>
  </div>
</body></html>`;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ keyfile: string }> },
) {
  const { keyfile } = await params;
  const valid = new Set([INDEXNOW_KEY, `${INDEXNOW_KEY}.txt`]);
  if (!valid.has(keyfile)) {
    return new NextResponse(KEYFILE_MISS_404, {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  return new NextResponse(INDEXNOW_KEY, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
