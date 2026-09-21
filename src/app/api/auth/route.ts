// ─── /api/auth — admin login for the dashboard management plane ──────────────
// GET  → { authRequired, authenticated, expiresAt }   (pollable, no secrets)
// POST → { action: "login",    password }             → httpOnly session cookie
//        { action: "logout" }                        → clears cookie
//        { action: "challenge", op }                 → one-time destructive-op
//                                                      confirm token (120s)
//
// When FLEET_ADMIN_PASSWORD is unset (local dev instances) the gate reports
// openMode and every management route proceeds without a cookie — scripts and
// QA flows keep working on a trusted machine. Production sets the env var.

import { NextResponse } from "next/server";

import {
  adminCookieString,
  adminPassword,
  authRequired,
  clearAdminCookieString,
  clientIp,
  durableRateLimit,
  getAdminAuth,
  issueChallenge,
  logSecurityEvent,
  rateLimit,
  requireAdmin,
  safeEqual,
  signAdminToken,
} from "@/lib/security";

export const dynamic = "force-dynamic";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 10 * 60_000;
const ADMIN_TTL_SEC = 12 * 3600;

export async function GET(request: Request) {
  const state = getAdminAuth(request);
  return NextResponse.json(
    { ...state, openMode: !state.authRequired },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const action = String(body.action ?? "");

  if (action === "login") {
    const password = adminPassword();
    if (!password) {
      // No password configured. In production the gate now fails CLOSED
      // (2026-09-21 audit fix) — report that clearly instead of "open mode".
      if (authRequired()) {
        await logSecurityEvent({
          kind: "login-denied",
          detail: "no admin password configured — production fails closed",
          request,
        });
        return NextResponse.json(
          {
            ok: false,
            error:
              "No admin password is configured on this deployment — set FLEET_ADMIN_PASSWORD to enable sign-in.",
          },
          { status: 403, headers: { "cache-control": "no-store" } },
        );
      }
      // local dev: nothing to log into — tell the client the gate is open
      return NextResponse.json(
        {
          ok: true,
          openMode: true,
          message: "no admin password configured — dashboard is open",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    // shared clientIp() — platform-set x-real-ip first, last-xff fallback.
    // The previous local copy trusted the first xff entry (spoofable) and was
    // the actual login rate-limit bypass from the 2026-09-20 audit.
    //
    // H7 (2026-09-21): the limiter is now TWO layers — the cheap in-memory
    // window (fast fail on a warm instance) PLUS a Postgres-backed sliding
    // window shared by every serverless instance, so N warm lambdas no longer
    // multiply the attempt budget. State-layer hiccup → in-memory verdict only.
    const rlKey = `login:${clientIp(request)}`;
    const rl = rateLimit(rlKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    if (rl.ok) {
      const durable = await durableRateLimit(rlKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
      if (durable && !durable.ok) {
        await logSecurityEvent({
          kind: "login-rate-limited",
          detail: `${durable.retryAfter}s cooldown (durable limiter)`,
          request,
        });
        return NextResponse.json(
          { ok: false, error: `Too many failed attempts — try again in ${durable.retryAfter}s.` },
          { status: 429, headers: { "cache-control": "no-store" } },
        );
      }
    } else {
      await logSecurityEvent({
        kind: "login-rate-limited",
        detail: `${rl.retryAfter}s cooldown`,
        request,
      });
      return NextResponse.json(
        { ok: false, error: `Too many failed attempts — try again in ${rl.retryAfter}s.` },
        { status: 429, headers: { "cache-control": "no-store" } },
      );
    }

    const given = typeof body.password === "string" ? body.password : "";
    if (!given || !safeEqual(given, password)) {
      await logSecurityEvent({
        kind: "login-failed",
        detail: "wrong admin password",
        request,
      });
      return NextResponse.json(
        { ok: false, error: "Wrong password." },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }

    const { token, expiresAt } = signAdminToken();
    return NextResponse.json(
      { ok: true, expiresAt },
      {
        headers: {
          "set-cookie": adminCookieString(request, token, ADMIN_TTL_SEC),
          "cache-control": "no-store",
        },
      },
    );
  }

  if (action === "logout") {
    return NextResponse.json(
      { ok: true },
      {
        headers: {
          "set-cookie": clearAdminCookieString(request),
          "cache-control": "no-store",
        },
      },
    );
  }

  if (action === "challenge") {
    const gate = requireAdmin(request);
    if (gate) return gate;
    const op = String(body.op ?? "");
    const allowed = [
      "selfops-redeploy",
      "selfops-promote",
      "selfops-neon",
      "vercel-reattach",
      "vercel-disconnect",
      "agent-disconnect-github",
      "agent-disconnect-vercel",
      "gsc-disconnect",
    ];
    if (!allowed.includes(op)) {
      return NextResponse.json(
        { ok: false, error: `Unknown challenge op “${op}”.` },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const { token, expiresIn } = issueChallenge(op);
    return NextResponse.json(
      { ok: true, confirmToken: token, expiresIn },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: false, error: 'Unknown action — expected "login", "logout" or "challenge".' },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}
