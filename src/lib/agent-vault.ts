// ─── Agent vault — connect tokens once, mint revocable agent links ──────────
// The user's idea, implemented: tokens are pasted into the DASHBOARD (never
// into chat). The dashboard stores them server-side and mints scoped, expiring
// "agent links". The AI (or any automation) receives ONLY the link — it can
// then call /api/agent/proxy to run GitHub/Vercel operations through this
// server. Real tokens never appear in chat, sessions can be revoked without
// rotating the underlying tokens, and every proxy call is logged for the user
// to audit in the UI.
//
// STORAGE (all chmod 600, server-side only):
//   db/github-auth.json    — GitHub PAT + account info
//   db/agent-sessions.json — minted sessions (key, scopes, expiry, usage)
//   db/agent-activity.json — audit log of agent proxy calls (cap 200)
// Vercel tokens live in db/vercel-auth.json via lib/vercel-ops.ts (shared).

import { promises as fs } from "fs";
import path from "path";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

import { mutateState, readState } from "@/lib/pg-state";

const GITHUB_AUTH_PATH = path.join(process.cwd(), "db", "github-auth.json");

const GITHUB_API = "https://api.github.com";
const MAX_ACTIVITY = 200;
const MAX_SESSIONS = 20;

// ─── types ───────────────────────────────────────────────────────────────────

export type AgentScope =
  | "github:read"
  | "github:write"
  | "vercel:read"
  | "vercel:write";

export const ALL_SCOPES: AgentScope[] = [
  "github:read",
  "github:write",
  "vercel:read",
  "vercel:write",
];

export interface GithubAuthStore {
  token: string;
  savedAt: string; // ISO
  account: { login: string; type: string; scopes: string | null };
}

export interface AgentSession {
  id: string;
  key: string; // capability — shown once at creation, hint-masked afterwards
  label: string;
  scopes: AgentScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  callCount: number;
  revoked: boolean;
}

export interface AgentActivityEntry {
  t: string; // ISO
  label: string; // session label
  provider: "github" | "vercel" | "-";
  op: string; // "GET /user" etc.
  ok: boolean;
  status: number | string;
}

// ─── small file helpers (best-effort, non-fatal on read errors) ─────────────

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(p: string, data: unknown): Promise<void> {
  try {
    await fs.writeFile(p, JSON.stringify(data), { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

// ─── GitHub token vault ──────────────────────────────────────────────────────

/**
 * Serverless fallback: on Vercel the db/ files don't persist, so a deployed
 * instance reads the vault token from env instead (FLEET_GITHUB_TOKEN).
 * Never used when the local file exists.
 */
function envGithubStore(): GithubAuthStore | null {
  const t = process.env.FLEET_GITHUB_TOKEN;
  if (!t || t.length < 20) return null;
  return {
    token: t,
    savedAt: "",
    account: { login: "env-configured", type: "User", scopes: null },
  };
}

export async function readGithubAuth(): Promise<GithubAuthStore | null> {
  const store = await readJson<GithubAuthStore>(GITHUB_AUTH_PATH);
  return store?.token ? store : envGithubStore();
}

export async function githubStatus(): Promise<{
  connected: boolean;
  savedAt: string | null;
  account: { login: string; type: string; scopes: string | null } | null;
}> {
  const store = await readGithubAuth();
  return {
    connected: !!store,
    savedAt: store?.savedAt ?? null,
    account: store
      ? { login: store.account.login, type: store.account.type, scopes: store.account.scopes }
      : null,
  };
}

/** Validate a GitHub PAT live against /user, then store it (chmod 600). */
export async function connectGithub(
  rawToken: string,
): Promise<{ ok: boolean; error?: string; login?: string }> {
  const token = rawToken.trim();
  if (token.length < 20 || /\s/.test(token)) {
    return {
      ok: false,
      error:
        "That doesn't look like a GitHub token — create a fine-grained or classic PAT at github.com/settings/tokens.",
    };
  }
  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "fleet-control-agent",
      },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 401
            ? "GitHub rejected the token (401) — it may be expired or a typo."
            : `GitHub API returned ${res.status}.`,
      };
    }
    const body = (await res.json()) as { login?: string; type?: string };
    const scopes = res.headers.get("x-oauth-scopes");
    await writeJson(GITHUB_AUTH_PATH, {
      token,
      savedAt: new Date().toISOString(),
      account: {
        login: String(body.login ?? "unknown"),
        type: String(body.type ?? "User"),
        scopes: scopes && scopes.length > 0 ? scopes : null,
      },
    });
    return { ok: true, login: String(body.login ?? "unknown") };
  } catch (e) {
    return {
      ok: false,
      error: `Could not reach GitHub: ${e instanceof Error ? e.message : "network error"}`,
    };
  }
}

export async function disconnectGithub(): Promise<void> {
  try {
    await fs.rm(GITHUB_AUTH_PATH, { force: true });
  } catch {
    /* best-effort */
  }
}

// ─── sessions ────────────────────────────────────────────────────────────────

function newId(): string {
  return `s_${randomBytes(6).toString("hex")}`;
}

function newKey(): string {
  return `flk_${randomBytes(24).toString("hex")}`;
}

export async function readSessions(): Promise<AgentSession[]> {
  // Postgres (durable) with file fallback — minted links survive cold starts now
  const store = await readState<{ sessions: AgentSession[] }>("agent-sessions");
  return store?.sessions ?? [];
}

/**
 * Atomic session-list mutation under optimistic-CAS (H1, 2026-09-21).
 * Concurrent proxy calls (touchSession bursts) and dashboard edits (create/
 * revoke) can no longer drop each other's changes. The callback may run more
 * than once on retry — keep it pure.
 */
async function mutateSessions(
  fn: (sessions: AgentSession[]) => AgentSession[],
): Promise<void> {
  await mutateState<{ sessions: AgentSession[] }>("agent-sessions", (cur) => ({
    sessions: fn(cur?.sessions ?? []).slice(-MAX_SESSIONS),
  }));
}

export interface CreatedSession {
  session: AgentSession;
  url: string; // the link the user pastes into chat
}

export async function createSession(input: {
  label: string;
  scopes: AgentScope[];
  ttlHours: number;
}): Promise<CreatedSession> {
  const ttl = Math.min(Math.max(Math.round(input.ttlHours), 1), 24 * 30);
  const session: AgentSession = {
    id: newId(),
    key: newKey(),
    label: input.label.trim().slice(0, 60) || "agent session",
    scopes: input.scopes.filter((s) => ALL_SCOPES.includes(s)),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 3600_000).toISOString(),
    lastUsedAt: null,
    callCount: 0,
    revoked: false,
  };
  await mutateSessions((sessions) => [...sessions, session]);
  return {
    session,
    url: `/api/agent/proxy?session=${session.key}`,
  };
}

export async function revokeSession(id: string): Promise<boolean> {
  let found = false;
  await mutateSessions((sessions) => {
    if (!sessions.some((s) => s.id === id)) return sessions;
    found = true;
    return sessions.map((s) => (s.id === id ? { ...s, revoked: true } : s));
  });
  return found;
}

/**
 * Split the FLEET_AGENT_KEYS value into entries. "|" separates entries
 * (canonical — an entry's scope spec itself uses ","). Legacy comma-joined
 * values are handled by re-attaching any fragment that does not start with
 * "flk_" to the previous entry (scope fragments never start with flk_, keys
 * always do). Comma-splitting the whole value used to truncate multi-scope
 * entries to their first scope — caught during the v14.1 rotation.
 */
export function splitKeyEntries(raw: string): string[] {
  const fragments = raw
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const entries: string[] = [];
  for (const frag of fragments) {
    if (frag.startsWith("flk_") || entries.length === 0) {
      entries.push(frag);
    } else {
      entries[entries.length - 1] += `,${frag}`;
    }
  }
  return entries;
}

/**
 * Parse one FLEET_AGENT_KEYS entry. Entries look like
 *   flk_<hex>                          → scopes fall back to FLEET_AGENT_SCOPES
 *   flk_<hex>:github:read,vercel:read  → fine-grained per-key scopes
 * (keys themselves never contain ":", so the first colon is the separator —
 * this is what makes permanent env keys narrow-scope instead of all-powerful,
 * closing the "env keys are full-scope" gap flagged by the security review.)
 */
function parseKeyEntry(entry: string): { key: string; scopeSpec?: string } {
  const idx = entry.indexOf(":");
  if (idx === -1) return { key: entry };
  return { key: entry.slice(0, idx), scopeSpec: entry.slice(idx + 1) };
}

function parseScopes(spec: string): AgentScope[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AgentScope => (ALL_SCOPES as string[]).includes(s));
}

/**
 * Serverless fallback for deployed instances: keys from FLEET_AGENT_KEYS
 * (comma-separated, optionally `key:scope1,scope2` per entry) act as
 * always-valid links. Bare keys get the scopes in FLEET_AGENT_SCOPES
 * (default: all four).
 */
function envSession(key: string): AgentSession | null {
  const entries = splitKeyEntries(process.env.FLEET_AGENT_KEYS ?? "");
  const matched = entries
    .map(parseKeyEntry)
    .find((e) => e.key === key);
  if (!matched) return null;
  const scopes = matched.scopeSpec
    ? parseScopes(matched.scopeSpec)
    : parseScopes(
        process.env.FLEET_AGENT_SCOPES ??
          "github:read,github:write,vercel:read,vercel:write",
      );
  return {
    id: "env_agent",
    key,
    label: "env agent link",
    scopes,
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(Date.now() + 3650 * 86400_000).toISOString(),
    lastUsedAt: null,
    callCount: 0,
    revoked: false,
  };
}

/** Resolve a capability key → live session (or null with a reason).
 * Accepts `flk_…` links (store / env) AND `fls_…` derived sessions — the
 * 1-hour handshake tokens minted by /api/agent/exchange. */
export async function resolveSession(
  key: string | null,
): Promise<{ session: AgentSession } | { error: string }> {
  if (!key || (!key.startsWith("flk_") && !key.startsWith("fls_"))) {
    return { error: "missing or malformed session key — send the agent link" };
  }
  if (key.startsWith("fls_")) {
    const p = verifyDerivedToken(key);
    if (!p) return { error: "invalid or expired derived session — exchange again" };
    const parent = await findParentByHash(p.ph);
    if (!parent) return { error: "parent link is gone — this derived session is dead" };
    const scopes = p.sc.filter((s) => parent.scopes.includes(s));
    if (scopes.length === 0) return { error: "derived session has no usable scopes" };
    return {
      session: {
        id: `derived_${p.jti}`,
        key,
        label: `derived session · ${parent.label}`,
        scopes,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(p.exp).toISOString(),
        lastUsedAt: null,
        callCount: 0,
        revoked: false,
      },
    };
  }
  const sessions = await readSessions();
  // timing-safe scan: never short-circuit on key bytes (defense in depth —
  // a 48-hex-char key is unguessable anyway, but comparisons shouldn't leak)
  let session: AgentSession | undefined;
  for (const s of sessions) {
    const a = createHash("sha256").update(s.key).digest();
    const b = createHash("sha256").update(key).digest();
    if (timingSafeEqual(a, b)) {
      session = s;
      break;
    }
  }
  if (session) {
    if (session.revoked) return { error: "this agent link was revoked by the owner" };
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return { error: "this agent link has expired — generate a new one in the dashboard" };
    }
    return { session };
  }
  const env = envSession(key);
  if (env) return { session: env };
  return { error: "unknown session — generate a new agent link in the dashboard" };
}

export async function touchSession(id: string): Promise<void> {
  const now = new Date().toISOString();
  await mutateSessions((sessions) =>
    sessions.map((x) =>
      x.id === id ? { ...x, lastUsedAt: now, callCount: x.callCount + 1 } : x,
    ),
  );
}

// ─── derived sessions + pairing codes (stateless HMAC — cold-start-proof) ───
//
// The SESSION HANDOFF pattern (user's idea, third round of the security
// review): the long-lived agent link becomes a BOOTSTRAP secret, not the
// working credential. Two tiers:
//
//   1. EXCHANGE — present a valid link (or a pair code) → get a 1-hour
//      derived session `fls_<payload>.<sig>`. All work happens under the
//      short-lived token; the link can stay out of URLs and chat from then
//      on.
//   2. PAIRING — the dashboard (admin-gated) shows a ONE-TIME `pair_<…>`
//      code bound to a parent link, valid 10 minutes. Paste ONLY the code
//      in chat — the link itself never enters the transcript.
//
// Design notes (all deliberate):
//   • Stateless: HMAC-signed {parentHash, scopes, exp} — any lambda instance
//     can verify without shared storage, so derived sessions survive cold
//     starts (the exact failure mode of FS-backed minted links).
//   • The parent key is NEVER embedded — only sha256(parentKey)[0:32]. A
//     leaked fls_ token does NOT leak the parent.
//   • Every verification re-resolves the parent from the live store/env —
//     revoking or rotating the parent kills ALL derived sessions instantly.
//   • Scopes are intersected with the parent's at verify time — a derived
//     token can never out-scope its parent.
//   • Pair codes are one-time via a per-warm-instance consumed ledger
//     (best-effort on serverless, same honesty as the challenge flow) and
//     die in 10 minutes regardless.

const DERIVED_TTL_MS = 60 * 60_000; // 1 hour of work per handshake
const PAIR_TTL_MS = 10 * 60_000; // one-time code lives 10 minutes

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Token signing secret — dedicated env if set, else the agent keys themselves
 * (always present on the deployed instance), else the admin gate secret. */
function derivedSecret(): Buffer {
  const basis =
    process.env.FLEET_AGENT_SESSION_SECRET ||
    process.env.FLEET_AGENT_KEYS ||
    process.env.FLEET_ADMIN_PASSWORD ||
    "open";
  return createHash("sha256").update(`fleet-derived:${basis}`).digest();
}

/** Parents are referenced by sha256(key) prefix — never by plaintext. */
function parentHash(parentKey: string): string {
  return createHash("sha256").update(parentKey).digest("hex").slice(0, 32);
}

function hintOf(key: string): string {
  return key.length > 12 ? `flk_…${key.slice(-4)}` : "flk_…";
}

interface ParentCandidate {
  key: string;
  scopes: AgentScope[];
  label: string;
}

async function listParentCandidates(): Promise<ParentCandidate[]> {
  const sessions = await readSessions();
  const out: ParentCandidate[] = sessions
    .filter((s) => !s.revoked && new Date(s.expiresAt).getTime() > Date.now())
    .map((s) => ({ key: s.key, scopes: s.scopes, label: s.label }));
  for (const entry of splitKeyEntries(process.env.FLEET_AGENT_KEYS ?? "")) {
    const parsed = parseKeyEntry(entry);
    const es = envSession(parsed.key);
    if (es) out.push({ key: es.key, scopes: es.scopes, label: es.label });
  }
  return out;
}

async function findParentByHash(ph: string): Promise<ParentCandidate | null> {
  const wanted = Buffer.from(ph, "hex");
  for (const c of await listParentCandidates()) {
    const h = Buffer.from(parentHash(c.key), "hex");
    if (h.length === wanted.length && timingSafeEqual(h, wanted)) return c;
  }
  return null;
}

async function findParentByKey(parentKey: string): Promise<ParentCandidate | null> {
  const wanted = createHash("sha256").update(parentKey).digest();
  for (const c of await listParentCandidates()) {
    const h = createHash("sha256").update(c.key).digest();
    if (timingSafeEqual(h, wanted)) return c;
  }
  return null;
}

function hmacSign(payload: string): string {
  return createHmac("sha256", derivedSecret()).update(payload).digest("base64url");
}

function hmacCheck(payload: string, sig: string): boolean {
  const a = createHash("sha256").update(sig).digest();
  const b = createHash("sha256").update(hmacSign(payload)).digest();
  return timingSafeEqual(a, b);
}

export interface DerivedToken {
  token: string;
  expiresAt: string;
  scopes: AgentScope[];
  parentHint: string;
}

/** Mint a 1-hour derived session bound to a parent link. */
export async function mintDerivedSession(
  parentKey: string,
  requestedScopes?: string[],
): Promise<DerivedToken | { error: string }> {
  const parent = await findParentByKey(parentKey);
  if (!parent) return { error: "unknown, expired or revoked parent link" };
  const scopes = (
    requestedScopes?.length
      ? requestedScopes.filter(
          (s): s is AgentScope =>
            (ALL_SCOPES as string[]).includes(s) && parent.scopes.includes(s as AgentScope),
        )
      : parent.scopes
  ).filter((s, i, a) => a.indexOf(s) === i);
  if (scopes.length === 0) return { error: "no requested scope is granted by the parent link" };
  const exp = Date.now() + DERIVED_TTL_MS;
  const payload = b64url(
    JSON.stringify({
      v: 1,
      ph: parentHash(parentKey),
      sc: scopes,
      exp,
      jti: randomBytes(8).toString("hex"),
    }),
  );
  return {
    token: `fls_${payload}.${hmacSign(payload)}`,
    expiresAt: new Date(exp).toISOString(),
    scopes,
    parentHint: hintOf(parent.key),
  };
}

interface DerivedPayload {
  v: number;
  ph: string;
  sc: AgentScope[];
  exp: number;
  jti: string;
}

function verifyDerivedToken(token: string): DerivedPayload | null {
  if (!token.startsWith("fls_")) return null;
  const body = token.slice(4);
  const dot = body.indexOf(".");
  if (dot <= 0) return null;
  const payload = body.slice(0, dot);
  if (!hmacCheck(payload, body.slice(dot + 1))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString()) as DerivedPayload;
    if (p.v !== 1 || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    if (typeof p.ph !== "string" || !Array.isArray(p.sc) || typeof p.jti !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

export interface PairCode {
  code: string;
  expiresAt: string;
  parentHint: string;
}

/** Mint a one-time pairing code. Default parent: the permanent env key (the
 * workhorse on deployed instances), else the newest live minted link. */
export async function mintPairCode(parentKey?: string): Promise<PairCode | { error: string }> {
  let parent: ParentCandidate | null = null;
  if (parentKey) {
    parent = await findParentByKey(parentKey);
    if (!parent) return { error: "unknown, expired or revoked parent link" };
  } else {
    const cands = await listParentCandidates();
    parent = cands.find((c) => c.label === "env agent link") ?? cands[0] ?? null;
    if (!parent) return { error: "no live agent link or env key to pair against" };
  }
  const exp = Date.now() + PAIR_TTL_MS;
  const payload = b64url(
    JSON.stringify({ v: 1, ph: parentHash(parent.key), exp, jti: randomBytes(6).toString("hex") }),
  );
  return {
    code: `pair_${payload}.${hmacSign(payload)}`,
    expiresAt: new Date(exp).toISOString(),
    parentHint: hintOf(parent.key),
  };
}

const consumedPairJtis = new Set<string>(); // one-time ledger (per warm instance)

/** Verify a pairing code → parent hash (or reason). Single-use, 10 min TTL. */
export async function verifyPairCode(code: string): Promise<{ ph: string } | { error: string }> {
  if (!code.startsWith("pair_")) return { error: "malformed pairing code" };
  const body = code.slice(5);
  const dot = body.indexOf(".");
  if (dot <= 0) return { error: "malformed pairing code" };
  const payload = body.slice(0, dot);
  if (!hmacCheck(payload, body.slice(dot + 1))) return { error: "invalid pairing code" };
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      v: number;
      ph: string;
      exp: number;
      jti: string;
    };
    if (p.v !== 1 || typeof p.exp !== "number" || p.exp < Date.now()) {
      return { error: "pairing code expired — generate a new one in the dashboard" };
    }
    if (consumedPairJtis.has(p.jti)) {
      return { error: "pairing code already used — it is one-time" };
    }
    consumedPairJtis.add(p.jti);
    return { ph: p.ph };
  } catch {
    return { error: "invalid pairing code" };
  }
}

/** Exchange a verified pair-code parent hash → 1h derived session. */
export async function mintDerivedFromPairHash(
  ph: string,
  requestedScopes?: string[],
): Promise<DerivedToken | { error: string }> {
  const parent = await findParentByHash(ph);
  if (!parent) return { error: "the paired link is gone or expired" };
  return mintDerivedSession(parent.key, requestedScopes);
}

// ─── activity audit log ──────────────────────────────────────────────────────

export async function readActivity(): Promise<AgentActivityEntry[]> {
  return (await readState<AgentActivityEntry[]>("agent-activity")) ?? [];
}

export async function logActivity(entry: AgentActivityEntry): Promise<void> {
  // Atomic prepend under optimistic-CAS — burst proxy calls can no longer drop
  // each other's audit entries (H1, 2026-09-21).
  await mutateState<AgentActivityEntry[]>("agent-activity", (cur) =>
    [entry, ...(cur ?? [])].slice(0, MAX_ACTIVITY),
  );
}

// ─── outbound helpers used by the proxy route ────────────────────────────────

export interface ProxyResult {
  status: number;
  data: unknown;
  errorText?: string;
}

export async function githubFetch(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
): Promise<ProxyResult> {
  const store = await readGithubAuth();
  if (!store) return { status: 0, data: null, errorText: "GitHub not connected in the vault" };
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${store.token}`,
        accept: "application/vnd.github+json",
        "user-agent": "fleet-control-agent",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text.slice(0, 400);
    }
    return { status: res.status, data, errorText: text.slice(0, 240) };
  } catch (e) {
    return { status: 0, data: null, errorText: e instanceof Error ? e.message : "network error" };
  }
}

export async function vercelFetch(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
): Promise<ProxyResult> {
  // reuse the vercel-ops token store
  const { readVercelTokenForAgent } = await import("./vercel-ops");
  const token = await readVercelTokenForAgent();
  if (!token) return { status: 0, data: null, errorText: "Vercel not connected in the vault" };
  try {
    const res = await fetch(`https://api.vercel.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text.slice(0, 400);
    }
    return { status: res.status, data, errorText: text.slice(0, 240) };
  } catch (e) {
    return { status: 0, data: null, errorText: e instanceof Error ? e.message : "network error" };
  }
}
