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
  clearAdminCookieString,
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
      // open mode: nothing to log into — tell the client the gate is open
      return NextResponse.json(
        {
          ok: true,
          openMode: true,
          message: "no admin password configured — dashboard is open",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const rl = rateLimit(`login:${clientIpOf(request)}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    if (!rl.ok) {
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

function clientIpOf(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}
