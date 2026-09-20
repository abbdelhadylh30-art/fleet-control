// ─── Global security headers (Task 16 hardening) ─────────────────────────────
//  • Referrer-Policy: no-referrer  — agent links carry ?session=flk_…; this
//    guarantees the capability key never leaks via the Referer header when a
//    visitor navigates away from any URL.
//  • X-Frame-Options DENY + frame-ancestors 'none' — the control panel must
//    not be clickjacked inside someone else's iframe.
//  • nosniff, minimal Permissions-Policy, locked-down CSP (self + inline, so
//    Next.js keeps working while cross-origin exfil is blocked).
//  • API responses: no-store + noindex so capability URLs and status payloads
//    are never cached by intermediaries or indexed by crawlers.

import { NextResponse, type NextRequest } from "next/server";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function middleware(request: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("Content-Security-Policy", CSP);

  if (request.nextUrl.pathname.startsWith("/api/")) {
    res.headers.set("Cache-Control", "no-store, max-age=0");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
