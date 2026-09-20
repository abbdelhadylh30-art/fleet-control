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
import { createHash, randomBytes, timingSafeEqual } from "crypto";

const GITHUB_AUTH_PATH = path.join(process.cwd(), "db", "github-auth.json");
const SESSIONS_PATH = path.join(process.cwd(), "db", "agent-sessions.json");
const ACTIVITY_PATH = path.join(process.cwd(), "db", "agent-activity.json");

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
  const store = await readJson<{ sessions: AgentSession[] }>(SESSIONS_PATH);
  return store?.sessions ?? [];
}

async function writeSessions(sessions: AgentSession[]): Promise<void> {
  await writeJson(SESSIONS_PATH, { sessions: sessions.slice(-MAX_SESSIONS) });
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
  const sessions = await readSessions();
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
  await writeSessions([...sessions, session]);
  return {
    session,
    url: `/api/agent/proxy?session=${session.key}`,
  };
}

export async function revokeSession(id: string): Promise<boolean> {
  const sessions = await readSessions();
  const target = sessions.find((s) => s.id === id);
  if (!target) return false;
  target.revoked = true;
  await writeSessions(sessions);
  return true;
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

/** Resolve a capability key → live session (or null with a reason). */
export async function resolveSession(
  key: string | null,
): Promise<{ session: AgentSession } | { error: string }> {
  if (!key || !key.startsWith("flk_")) {
    return { error: "missing or malformed session key — send the agent link" };
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
  const sessions = await readSessions();
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  s.lastUsedAt = new Date().toISOString();
  s.callCount += 1;
  await writeSessions(sessions);
}

// ─── activity audit log ──────────────────────────────────────────────────────

export async function readActivity(): Promise<AgentActivityEntry[]> {
  return (await readJson<AgentActivityEntry[]>(ACTIVITY_PATH)) ?? [];
}

export async function logActivity(entry: AgentActivityEntry): Promise<void> {
  const list = await readActivity();
  const next = [entry, ...list].slice(0, MAX_ACTIVITY);
  await writeJson(ACTIVITY_PATH, next);
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
