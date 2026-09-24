// ─── Security core — admin gate, challenge tokens, rate limits, audit ────────
//
// Response to the external security review (Task 16). The management plane
// (mint/revoke agent links, connect/disconnect vault tokens, redeploy,
// promote, domain reattach) is now behind an admin login, while the agent
// capability plane stays key-gated as before.
//
// DESIGN (serverless-friendly — no FS required for auth):
//   • FLEET_ADMIN_PASSWORD env → admin login. If unset (local dev), the gate
//     opens automatically so scripts/QA keep working; the UI shows a banner.
//   • Admin session = HMAC-signed {exp} token in an httpOnly, SameSite=Strict,
//     Secure cookie. Stateful session store NOT needed → survives cold starts.
//     Rotating the password instantly invalidates every issued session.
//   • Destructive ops require a one-time "challenge" token issued ≤120s
//     earlier (in-memory, single-use) — the re-auth step the review asked for.
//   • Security events: console.warn (durable in Vercel log drains) + best-effort
//     db/security-events.json so the dashboard can show them while warm.
//
// The agent capability plane (flk_ keys) is NOT cookie-based by design: AI
// agents calling fetch() have no cookie jar. Capability links stay in URLs,
// but mitigations land in middleware (no-referrer) + proxy hardening
// (header-first key, no-store, rate limits) so keys stop leaking sideways.

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { mutateState, readState } from "@/lib/pg-state";
import { sendAlert } from "@/lib/alerts";

export const ADMIN_COOKIE = "fleet_admin";
export const ADMIN_TTL_MS = 12 * 3600_000; // sessions expire — hours, not forever
const CHALLENGE_TTL_MS = 120_000; // one-time confirm window: 2 minutes
const MAX_SECURITY_EVENTS = 100;

// ─── password / open mode ─────────────────────────────────────────────────────

export function adminPassword(): string | null {
  const pw = (process.env.FLEET_ADMIN_PASSWORD ?? "").trim();
  return pw.length >= 8 ? pw : null;
}

/**
 * true when the deployment must be gated. A configured password always gates.
 * A MISSING password now fails CLOSED in production (2026-09-21 audit fix —
 * previously an unset FLEET_ADMIN_PASSWORD opened the management plane
 * everywhere); local dev keeps open mode so scripts/QA keep working.
 */
export function authRequired(): boolean {
  if (adminPassword() !== null) return true;
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

/**
 * HMAC signing secret for admin sessions. Optional dedicated secret first
 * (FLEET_SESSION_SECRET ≥ 16 chars — decouples session forgery resistance
 * from password entropy); otherwise derived from the password as before
 * (rotates with the password, stays backward compatible).
 */
function sessionSecret(): Buffer {
  const dedicated = (process.env.FLEET_SESSION_SECRET ?? "").trim();
  if (dedicated.length >= 16) {
    return createHash("sha256").update(`fleet-session:${dedicated}`).digest();
  }
  return createHash("sha256")
    .update(`fleet-control-admin:${adminPassword() ?? "open"}`)
    .digest();
}

// ─── constant-time string compare (hash both sides → equal length) ───────────

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ─── admin session token (HMAC-signed expiry) ─────────────────────────────────

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function signAdminToken(): { token: string; expiresAt: string } {
  const exp = Date.now() + ADMIN_TTL_MS;
  const payload = b64url(JSON.stringify({ e: exp }));
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, expiresAt: new Date(exp).toISOString() };
}

function verifyAdminToken(token: string): { valid: boolean; expiresAt: string | null } {
  const dot = token.indexOf(".");
  if (dot <= 0) return { valid: false, expiresAt: null };
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  if (!safeEqual(sig, expect)) return { valid: false, expiresAt: null };
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { e?: number };
    if (!parsed.e || typeof parsed.e !== "number") return { valid: false, expiresAt: null };
    return {
      valid: parsed.e > Date.now(),
      expiresAt: new Date(parsed.e).toISOString(),
    };
  } catch {
    return { valid: false, expiresAt: null };
  }
}

// ─── cookie helpers (framework-agnostic — plain Request works) ────────────────

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function isSecureRequest(request: Request): boolean {
  if (request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https") return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function adminCookieString(request: Request, token: string, maxAgeSec: number): string {
  const bits = [
    `${ADMIN_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
  ];
  if (isSecureRequest(request)) bits.push("Secure");
  return bits.join("; ");
}

export function clearAdminCookieString(request: Request): string {
  return adminCookieString(request, "", 0);
}

export interface AdminAuthState {
  authRequired: boolean;
  authenticated: boolean;
  expiresAt: string | null;
}

/** Inspect the admin cookie without gating. */
export function getAdminAuth(request: Request): AdminAuthState {
  const required = authRequired();
  if (!required) return { authRequired: false, authenticated: false, expiresAt: null };
  if (adminPassword() === null) {
    // production with no password configured — fail CLOSED. Nothing can
    // authenticate here: with no password the signing secret would derive
    // from a public constant, so every token is rejected outright.
    return { authRequired: true, authenticated: false, expiresAt: null };
  }
  const token = parseCookies(request.headers.get("cookie"))[ADMIN_COOKIE];
  if (!token) return { authRequired: true, authenticated: false, expiresAt: null };
  const v = verifyAdminToken(token);
  return { authRequired: true, authenticated: v.valid, expiresAt: v.expiresAt };
}

/**
 * Gate for management routes. Returns a 401 NextResponse when the caller is
 * not an authenticated admin (or null when the request may proceed).
 */
export function requireAdmin(request: Request): NextResponse | null {
  const state = getAdminAuth(request);
  if (!state.authRequired || state.authenticated) return null;
  logSecurityEvent({
    kind: "admin-gate-denied",
    detail: `${request.method} ${new URL(request.url).pathname}`,
    request,
  });
  return NextResponse.json(
    {
      ok: false,
      error: "Admin sign-in required — unlock the dashboard first.",
      needsAuth: true,
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

// ─── one-time challenge tokens (step-up for destructive ops) ─────────────────
//
// WHY SIGNED, NOT IN-MEMORY: /api/auth (issuer) and the destructive route
// (consumer) compile to DIFFERENT route bundles — on Vercel they can be
// different lambdas with isolated memory. A Map-based store can never hand a
// token across that boundary (found the hard way: challenge issued → consume
// failed with 403). So challenges are HMAC-signed, short-TTL (120s) and
// op-bound — stateless and verifiable by any route. Single-use is enforced
// best-effort via a per-warm-instance consumed set; a cross-lambda replay
// within the 120s window is theoretically possible and accepted (the token
// only proves a signed-in admin pressed "confirm" in the last 2 minutes —
// it grants nothing by itself).

const CHALLENGE_PREFIX = "fc1.";

function signChallenge(op: string, exp: number): string {
  const payload = b64url(JSON.stringify({ op, exp }));
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${CHALLENGE_PREFIX}${payload}.${sig}`;
}

export function issueChallenge(op: string): { token: string; expiresIn: number } {
  const exp = Date.now() + CHALLENGE_TTL_MS;
  return { token: signChallenge(op, exp), expiresIn: Math.round(CHALLENGE_TTL_MS / 1000) };
}

// best-effort single-use ledger (per warm instance — see header note)
const consumedChallenges = new Map<string, number>();

export function consumeChallenge(token: string, op: string): boolean {
  if (!token.startsWith(CHALLENGE_PREFIX)) return false;
  const rest = token.slice(CHALLENGE_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return false;
  const payload = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  const expect = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  if (!safeEqual(sig, expect)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      op?: string;
      exp?: number;
    };
    if (!parsed.op || parsed.op !== op) return false;
    if (!parsed.exp || parsed.exp < Date.now()) return false;
    if (consumedChallenges.has(token)) return false;
    consumedChallenges.set(token, parsed.exp);
    // prune expired entries (tokens live 120s — the ledger stays tiny)
    const now = Date.now();
    for (const [k, exp] of consumedChallenges) if (exp < now) consumedChallenges.delete(k);
    return true;
  } catch {
    return false;
  }
}

/** Guard helper: null = proceed; NextResponse = reject (400). */
export function requireChallenge(
  body: Record<string, unknown>,
  op: string,
): NextResponse | null {
  const token = typeof body.confirmToken === "string" ? body.confirmToken : "";
  if (consumeChallenge(token, op)) return null;
  return NextResponse.json(
    {
      ok: false,
      error:
        "Missing or expired one-time confirmation for a destructive action — request a fresh challenge first.",
      needsChallenge: true,
    },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}

// ─── rate limiting ───────────────────────────────────────────────────────────

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 500) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t > windowMs)) buckets.delete(k);
    }
  }
  return { ok: true, retryAfter: 0 };
}

// ─── durable rate limiting (2026-09-21 H7 fix) ───────────────────────────────
// The in-memory limiter above is per warm serverless instance — N concurrent
// lambdas meant N× the intended budget (proven live: 2 of 12 spoofed-IP login
// attempts slipped through on a second instance). For auth-sensitive
// endpoints the counter now ALSO lives in Postgres (the CAS-primitive state
// layer from the H1 fix), so every instance shares one sliding window.
//
// Semantics: identical to rateLimit() — sliding window of hit timestamps,
// checked-and-incremented atomically under optimistic-CAS. Returns null when
// the state layer is unreachable (Neon hiccup) so callers can fall back to
// the in-memory verdict instead of hard-failing logins.

const RATE_LIMIT_KEY = "rate-limits";
const RATE_LIMIT_MAX_KEYS = 400;

type RateLimitStore = Record<string, number[]>;

export async function durableRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; retryAfter: number } | null> {
  // The verdict is captured from the CAS attempt that actually commits (the
  // callback re-runs with fresh state on retry — the last run is the winner),
  // so no read-back round-trip is needed to know if THIS call was counted.
  let verdict: { ok: boolean; retryAfter: number } | null = null;
  try {
    await mutateState<RateLimitStore>(RATE_LIMIT_KEY, (cur) => {
      const store: RateLimitStore = cur && typeof cur === "object" ? cur : {};
      const now = Date.now();
      const hits = (store[key] ?? []).filter((t) => now - t < windowMs);
      if (hits.length < limit) {
        hits.push(now);
        verdict = { ok: true, retryAfter: 0 };
      } else {
        // over-limit hits don't extend the window
        verdict = {
          ok: false,
          retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000),
        };
      }
      store[key] = hits;
      // bound the blob: drop fully-stale keys once the store grows
      const ks = Object.keys(store);
      if (ks.length > RATE_LIMIT_MAX_KEYS) {
        for (const k of ks) {
          if (store[k].every((t) => now - t > windowMs)) delete store[k];
        }
      }
      return store;
    });
    return verdict;
  } catch {
    // state layer hiccup — caller falls back to the in-memory limiter
    return null;
  }
}

// ─── request metadata ─────────────────────────────────────────────────────────

export function clientIp(request: Request): string {
  // 2026-09-21 audit fix: this used to trust the FIRST x-forwarded-for entry,
  // which is fully attacker-controlled (spoof a fresh IP per request → bypass
  // every IP rate limit — proven live against the login limiter). Correct
  // order on Vercel: x-real-ip (platform-set, unspoofable) first, then the
  // LAST xff entry (appended by the nearest trusted proxy).
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 45);
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1].slice(0, 45);
  }
  return "unknown";
}

function clientUa(request: Request): string {
  return (request.headers.get("user-agent") ?? "unknown").slice(0, 80);
}

// ─── security events (console + best-effort file for the UI) ─────────────────

export interface SecurityEvent {
  t: string;
  kind: string;
  detail: string;
  ip: string;
  ua: string;
}

export async function logSecurityEvent(e: {
  kind: string;
  detail: string;
  request: Request;
}): Promise<void> {
  const event: SecurityEvent = {
    t: new Date().toISOString(),
    kind: e.kind,
    detail: e.detail.slice(0, 160),
    ip: clientIp(e.request),
    ua: clientUa(e.request),
  };
  // console is the durable channel on Vercel (log drain picks it up)
  console.warn(
    `[fleet-security] ${event.kind} ip=${event.ip} ${event.detail} ua="${event.ua}"`,
  );
  try {
    // Atomic prepend under optimistic-CAS — concurrent requests can no longer
    // drop each other's security events (H1, 2026-09-21).
    // Postgres (durable) with file fallback — the audit trail survives cold starts
    await mutateState<SecurityEvent[]>("security-events", (cur) =>
      [event, ...(cur ?? [])].slice(0, MAX_SECURITY_EVENTS),
    );
  } catch {
    // state layer hiccup — console is still the durable channel (log drain)
    console.error("[fleet-security] failed to persist security event", event.kind);
  }
  // M7: outbound alert for high-signal kinds (Telegram/webhook channels since
  // v21 — the legacy FLEET_ALERT_WEBHOOK env rides along inside sendAlert)
  if (ALERTING_KINDS.has(event.kind)) {
    void sendAlert(
      "security",
      `⚠️ <b>Security event</b> — ${event.kind}\n${event.detail}\nip ${event.ip}`,
    );
  }
}

export async function readSecurityEvents(): Promise<SecurityEvent[]> {
  const list = await readState<SecurityEvent[]>("security-events");
  return Array.isArray(list) ? list : [];
}

// ─── outbound security alerting (M7, 2026-09-21) ─────────────────────────────
//
// FLEET_ALERT_WEBHOOK (optional): a Slack/Discord-style incoming-webhook URL.
// When set, high-signal security events and confirmed incidents are POSTed
// there (fire-and-forget, 4s timeout, never blocks the request path). When
// unset this is a no-op — zero behavior change for existing deployments.
//
// Per-kind dedupe (10 min, per warm instance) keeps a brute-force burst from
// producing one webhook call per attempt.

const ALERT_DEDUPE_MS = 10 * 60_000;
const lastAlertAt = new Map<string, number>();

export async function alertWebhook(text: string, kind = "general"): Promise<void> {
  const url = process.env.FLEET_ALERT_WEBHOOK;
  if (!url) return;
  const now = Date.now();
  const last = lastAlertAt.get(kind) ?? 0;
  if (now - last < ALERT_DEDUPE_MS) return; // already alerted recently
  lastAlertAt.set(kind, now);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        source: "fleet-control",
        at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
  } catch {
    // alerting must never break the operation it reports on
  }
}

/** Event kinds that warrant an immediate outbound alert. */
const ALERTING_KINDS = new Set([
  "proxy-auth-failed",
  "proxy-rate-limited",
  "proxy-token-block",
  "proxy-secret-leak-blocked",
  "proxy-catastrophic-block",
  "proxy-path-rejected",
  "login-failed",
  "login-denied",
  "login-rate-limited",
  "admin-gate-denied",
  "exchange-auth-failed",
  "exchange-rate-limited",
  "pair-rejected",
]);
