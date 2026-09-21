// ─── Approval-based agent access — temp passwords + human-in-the-loop ───────
// The user's flow, replacing the "paste a long-lived agent link into chat"
// mess:
//
//   1. OWNER generates a TEMP PASSWORD (`fac_…`) in the dashboard — scoped,
//      expiring (5 min → 24 h). The code only authorizes ASKING, never doing.
//   2. The AI presents the code at /api/agent/access → a PENDING REQUEST
//      appears in the owner's dashboard with who is asking (declared AI name,
//      user-agent, IP) and what it wants to do.
//   3. The owner taps Approve (or Deny). On approval a 1-hour derived session
//      (`fls_…`) is minted — the AI picks it up by polling with the same code.
//   4. The dashboard tracks every active session live: which AI, how long it
//      has been working, and exactly what it is doing (proxy activity feed).
//
// Security properties:
//   • temp passwords are stored HASHED (sha256) — shown exactly once
//   • a code can only create requests for itself; polling binds request↔code
//   • approval is a separate, admin-gated, human action — per request
//   • the minted session derives from the vault parent (same HMAC scheme as
//     pair codes): revoking the parent link kills every live session
//   • everything persists in Postgres via pg-state (survives cold starts)
//
// Storage (pg-state keys):
//   agent-access-codes     — { codes: AccessCode[] }     (cap 25)
//   agent-access-requests  — { requests: AccessRequest[] } (cap 60)

import { createHash, randomBytes } from "crypto";

import {
  ALL_SCOPES,
  AgentScope,
  defaultAccessParent,
  mintDerivedFromPairHash,
} from "@/lib/agent-vault";
import { mutateState, readState } from "@/lib/pg-state";

const CODES_KEY = "agent-access-codes";
const REQUESTS_KEY = "agent-access-requests";
const MAX_CODES = 25;
const MAX_REQUESTS = 60;

/** How long the owner has to decide on a pending request. */
export const DECISION_WINDOW_MS = 10 * 60_000;

export const ACCESS_TTL_OPTIONS = [5, 15, 60, 360, 1440] as const; // minutes

// ─── types ───────────────────────────────────────────────────────────────────

export interface AccessCode {
  id: string;
  /** sha256(code) — the plaintext temp password is NEVER stored. */
  codeHash: string;
  /** masked display form, e.g. "fac_…9f2c" */
  codeHint: string;
  /** owner-set label — which AI / what this code is for */
  label: string;
  scopes: AgentScope[];
  /** parent-link hash prefix this code derives sessions from */
  ph: string;
  parentHint: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  useCount: number;
  lastUsedAt: string | null;
}

export type AccessRequestStatus = "pending" | "approved" | "denied" | "expired";

export interface AccessRequest {
  id: string;
  codeId: string;
  codeHint: string;
  /** self-declared AI identity, e.g. "Claude on web" */
  clientName: string;
  userAgent: string;
  ip: string;
  /** what the AI says it wants to do */
  task: string;
  scopes: AgentScope[];
  ph: string;
  parentHint: string;
  status: AccessRequestStatus;
  createdAt: string;
  /** decision deadline (createdAt + DECISION_WINDOW) */
  expiresAt: string;
  decidedAt: string | null;
  /** fls_ session — written on approval, returned ONCE on first poll */
  sessionToken: string | null;
  sessionExpiresAt: string | null;
  /** set when the AI fetched the approved session token */
  consumedAt: string | null;
}

// ─── small helpers ───────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function newCode(): string {
  return `fac_${randomBytes(20).toString("hex")}`;
}

function hintOf(code: string): string {
  return code.length > 10 ? `fac_…${code.slice(-4)}` : "fac_…";
}

function newRequestId(): string {
  return `ar_${randomBytes(6).toString("hex")}`;
}

export function codeStatus(c: AccessCode): "active" | "expired" | "revoked" {
  if (c.revoked) return "revoked";
  if (new Date(c.expiresAt).getTime() < Date.now()) return "expired";
  return "active";
}

// ─── codes ───────────────────────────────────────────────────────────────────

export interface CreatedAccessCode {
  code: AccessCode;
  /** full plaintext temp password — returned EXACTLY ONCE */
  plaintext: string;
}

export async function createAccessCode(input: {
  label: string;
  scopes: AgentScope[];
  ttlMinutes: number;
}): Promise<{ ok: true; created: CreatedAccessCode } | { ok: false; error: string }> {
  const parent = await defaultAccessParent();
  if (!parent) {
    return {
      ok: false,
      error:
        "No live agent link or env key to derive sessions from — connect the vault or mint an agent link first.",
    };
  }
  const ttl = Math.min(Math.max(Math.round(input.ttlMinutes), 5), 1440);
  const plaintext = newCode();
  const code: AccessCode = {
    id: `ac_${randomBytes(6).toString("hex")}`,
    codeHash: sha256(plaintext),
    codeHint: hintOf(plaintext),
    label: input.label.trim().slice(0, 60) || "ai access",
    scopes: input.scopes.filter((s) => ALL_SCOPES.includes(s)),
    ph: parent.ph,
    parentHint: parent.hint,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 60_000).toISOString(),
    revoked: false,
    useCount: 0,
    lastUsedAt: null,
  };
  if (code.scopes.length === 0) {
    return { ok: false, error: "pick at least one scope for the access code" };
  }
  await mutateState<{ codes: AccessCode[] }>(CODES_KEY, (cur) => ({
    codes: [...(cur?.codes ?? []), code].slice(-MAX_CODES),
  }));
  return { ok: true, created: { code, plaintext } };
}

export async function listAccessCodes(): Promise<AccessCode[]> {
  return (await readState<{ codes: AccessCode[] }>(CODES_KEY))?.codes ?? [];
}

export async function revokeAccessCode(id: string): Promise<boolean> {
  await mutateState<{ codes: AccessCode[] }>(CODES_KEY, (cur) => ({
    codes: (cur?.codes ?? []).map((c) => (c.id === id ? { ...c, revoked: true } : c)),
  }));
  return (await listAccessCodes()).some((c) => c.id === id);
}

/** Resolve a presented temp password → the stored code record (or reason). */
export async function resolveAccessCode(
  plaintext: string,
): Promise<{ code: AccessCode } | { error: string }> {
  if (!plaintext || !plaintext.startsWith("fac_")) {
    return { error: "missing or malformed access code — paste the temp password (fac_…)" };
  }
  const hash = sha256(plaintext);
  const code = (await listAccessCodes()).find((c) => c.codeHash === hash);
  if (!code) return { error: "unknown access code — ask the owner for a fresh temp password" };
  if (code.revoked) return { error: "this access code was revoked by the owner" };
  if (new Date(code.expiresAt).getTime() < Date.now()) {
    return { error: "this access code expired — ask the owner for a fresh one" };
  }
  return { code };
}

/** Mark a code as used (request created or polled). */
async function touchCode(id: string): Promise<void> {
  await mutateState<{ codes: AccessCode[] }>(CODES_KEY, (cur) => ({
    codes: (cur?.codes ?? []).map((c) =>
      c.id === id ? { ...c, useCount: c.useCount + 1, lastUsedAt: new Date().toISOString() } : c,
    ),
  }));
}

// ─── requests ────────────────────────────────────────────────────────────────

/** Lazily expire pending requests past their decision window. */
async function sweepExpired(requests: AccessRequest[]): Promise<AccessRequest[]> {
  const now = Date.now();
  let dirty = false;
  const next = requests.map((r) => {
    if (r.status === "pending" && new Date(r.expiresAt).getTime() < now) {
      dirty = true;
      return { ...r, status: "expired" as const };
    }
    return r;
  });
  if (dirty) {
    await mutateState<{ requests: AccessRequest[] }>(REQUESTS_KEY, () => ({ requests: next }));
  }
  return next;
}

export async function listRequests(): Promise<AccessRequest[]> {
  const raw = (await readState<{ requests: AccessRequest[] }>(REQUESTS_KEY))?.requests ?? [];
  return sweepExpired(raw);
}

export interface NewRequestInput {
  code: AccessCode;
  clientName: string;
  task: string;
  userAgent: string;
  ip: string;
}

export async function createAccessRequest(input: NewRequestInput): Promise<AccessRequest> {
  const request: AccessRequest = {
    id: newRequestId(),
    codeId: input.code.id,
    codeHint: input.code.codeHint,
    clientName: input.clientName.trim().slice(0, 60) || "unnamed ai",
    userAgent: input.userAgent.slice(0, 180),
    ip: input.ip.slice(0, 60),
    task: input.task.trim().slice(0, 200),
    scopes: input.code.scopes,
    ph: input.code.ph,
    parentHint: input.code.parentHint,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + DECISION_WINDOW_MS).toISOString(),
    decidedAt: null,
    sessionToken: null,
    sessionExpiresAt: null,
    consumedAt: null,
  };
  await mutateState<{ requests: AccessRequest[] }>(REQUESTS_KEY, (cur) => ({
    requests: [...(cur?.requests ?? []), request].slice(-MAX_REQUESTS),
  }));
  await touchCode(input.code.id);
  return request;
}

/** Fetch a request for polling — bound to the presenting code (strict).
 * The request must belong to the code whose plaintext was presented; the id
 * alone is never trusted. */
export async function getPollableRequest(
  requestId: string,
  plaintextCode: string,
): Promise<AccessRequest | { error: string }> {
  const resolved = await resolveAccessCode(plaintextCode);
  if ("error" in resolved) return { error: resolved.error };
  const requests = await listRequests();
  const r = requests.find((x) => x.id === requestId && x.codeId === resolved.code.id);
  if (!r) return { error: "no such access request for this code" };
  return r;
}

/** Owner decision — approve mints the 1-hour derived session immediately. */
export async function decideRequest(
  id: string,
  approve: boolean,
): Promise<{ ok: true; request: AccessRequest } | { ok: false; error: string }> {
  const requests = await listRequests();
  const target = requests.find((r) => r.id === id);
  if (!target) return { ok: false, error: "no such access request" };
  if (target.status === "approved") return { ok: true, request: target };
  if (target.status !== "pending") {
    return { ok: false, error: `request already ${target.status}` };
  }
  if (new Date(target.expiresAt).getTime() < Date.now()) {
    await mutateState<{ requests: AccessRequest[] }>(REQUESTS_KEY, (cur) => ({
      requests: (cur?.requests ?? []).map((r) =>
        r.id === id ? { ...r, status: "expired" as const } : r,
      ),
    }));
    return { ok: false, error: "request decision window already passed" };
  }

  if (!approve) {
    const denied: AccessRequest = {
      ...target,
      status: "denied",
      decidedAt: new Date().toISOString(),
    };
    await mutateState<{ requests: AccessRequest[] }>(REQUESTS_KEY, (cur) => ({
      requests: (cur?.requests ?? []).map((r) => (r.id === id ? denied : r)),
    }));
    return { ok: true, request: denied };
  }

  // approve → mint the 1h derived session from the stored parent hash
  const minted = await mintDerivedFromPairHash(target.ph, target.scopes);
  if ("error" in minted) {
    return { ok: false, error: `could not mint session: ${minted.error}` };
  }
  const approved: AccessRequest = {
    ...target,
    status: "approved",
    decidedAt: new Date().toISOString(),
    sessionToken: minted.token,
    sessionExpiresAt: minted.expiresAt,
  };
  await mutateState<{ requests: AccessRequest[] }>(REQUESTS_KEY, (cur) => ({
    requests: (cur?.requests ?? []).map((r) => (r.id === id ? approved : r)),
  }));
  return { ok: true, request: approved };
}

/** First poll after approval hands over the session token, then it's gone
 * from storage. Returns nothing useful — the caller already holds the token. */
export async function consumeRequestSession(id: string): Promise<void> {
  await mutateState<{ requests: AccessRequest[] }>(REQUESTS_KEY, (cur) => ({
    requests: (cur?.requests ?? []).map((r) =>
      r.id === id
        ? { ...r, consumedAt: new Date().toISOString(), sessionToken: null }
        : r,
    ),
  }));
}
