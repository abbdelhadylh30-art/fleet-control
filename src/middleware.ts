// ─── Global security headers (Task 16 hardening) ─────────────────────────────
//  • Referrer-Policy: no-referrer  — agent links carry ?session=flk_…; this
//    guarantees the capability key never leaks via the Referer header when a
//    visitor navigates away from any URL.
//  • X-Frame-Options DENY + frame-ancestors 'none' — the control panel must
//    not be clickjacked inside someone else's iframe.
//  • nosniff, minimal Permissions-Policy, and a NONCE-BASED CSP.
//  • API responses: no-store + noindex so capability URLs and status payloads
//    are never cached by intermediaries or indexed by crawlers.
//
// M8 (2026-09-21): script-src moved from 'unsafe-inline' 'unsafe-eval' to a
// per-request nonce + 'strict-dynamic'. Next.js reads the nonce out of the
// CSP header we set on the REQUEST (NextResponse.next({ request }) below) and
// stamps it onto every script it renders — bootstrap, chunks and inline data.
// 'strict-dynamic' lets those trusted scripts load their own dependencies, so
// no 'self' fallback is needed for scripts. Styles keep 'unsafe-inline'
// (React/Radix inject style attributes and Tailwind ships an inline <style>;
// nonce-ing styles is a breaking change with no security win here since style
// injection cannot execute script). Dev mode keeps 'unsafe-eval' because the
// React refresh runtime needs it — production does not.

import { NextResponse, type NextRequest } from "next/server";

function buildCsp(nonce: string): string {
  const scriptSrc =
    process.env.NODE_ENV === "development"
      ? `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // The CSP must ALSO ride on the request headers — Next.js parses it there
  // to extract the nonce and apply it to the scripts it renders.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("Content-Security-Policy", csp);

  if (request.nextUrl.pathname.startsWith("/api/")) {
    res.headers.set("Cache-Control", "no-store, max-age=0");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
