// ─── /api/agent/access — approval-based entry point for AI agents ───────────
// The human-friendly alternative to pasting long-lived agent links into chat:
//
//   POST { action: "request", code: "fac_…", client?: { name, task } }
//     → creates a PENDING request the owner must approve in the dashboard
//       → { ok, requestId, status: "pending", expiresAt, next }
//   POST { action: "poll", requestId, code: "fac_…", client? }
//     → pending  → { status: "pending" } (keep polling)
//     → approved → { status: "approved", session: "fls_…", expiresAt, scopes }
//                  (session token is handed over EXACTLY ONCE)
//     → denied / expired → terminal status
//
//   GET (admin only) → { codes, requests } for the dashboard approval queue
//
// Security: codes are hashed at rest; requests bind to the presenting code;
// both in-memory and durable rate limits; every rejection lands in the
// security event log. The derived session inherits the parent link's scopes
// and dies with it — revoking the parent kills live sessions instantly.

import { NextResponse } from "next/server";

import {
  consumeRequestSession,
  createAccessRequest,
  getPollableRequest,
  listAccessCodes,
  listRequests,
  resolveAccessCode,
} from "@/lib/agent-access";
import { logActivity } from "@/lib/agent-vault";
import {
  clientIp,
  durableRateLimit,
  logSecurityEvent,
  rateLimit,
  requireAdmin,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const gate = requireAdmin(request);
  if (gate) return gate;
  const [codes, requests] = await Promise.all([listAccessCodes(), listRequests()]);
  return json({
    codes: codes.map((c) => ({
      id: c.id,
      codeHint: c.codeHint,
      label: c.label,
      scopes: c.scopes,
      parentHint: c.parentHint,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      revoked: c.revoked,
      useCount: c.useCount,
      lastUsedAt: c.lastUsedAt,
    })),
    // sessionToken is NEVER included in listings — it travels to the AI only
    requests: requests.map((r) => ({
      id: r.id,
      codeHint: r.codeHint,
      clientName: r.clientName,
      userAgent: r.userAgent,
      ip: r.ip,
      task: r.task,
      scopes: r.scopes,
      parentHint: r.parentHint,
      status: r.status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      decidedAt: r.decidedAt,
      sessionExpiresAt: r.sessionExpiresAt,
      consumedAt: r.consumedAt,
    })),
  });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const action = String(body.action ?? "");

  if (action !== "request" && action !== "poll") {
    return json({ ok: false, error: "action must be \"request\" or \"poll\"" }, 400);
  }

  // abuse cap per IP (durable so N warm instances don't multiply the budget)
  const rlKey = `access:${clientIp(request)}`;
  const rl = rateLimit(rlKey, 20, 10 * 60_000);
  let over = !rl.ok;
  let retryAfter = rl.retryAfter;
  if (!over) {
    const durable = await durableRateLimit(rlKey, 20, 10 * 60_000);
    if (durable && !durable.ok) {
      over = true;
      retryAfter = durable.retryAfter;
    }
  }
  if (over) {
    await logSecurityEvent({
      kind: "access-rate-limited",
      detail: "access endpoint flooded — throttled",
      request,
    });
    return json({ ok: false, error: `too many requests — retry in ${retryAfter}s.` }, 429);
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const clientObj =
    typeof body.client === "object" && body.client !== null
      ? (body.client as Record<string, unknown>)
      : {};
  const clientName = typeof clientObj.name === "string" ? clientObj.name : "";
  const task = typeof clientObj.task === "string" ? clientObj.task : "";

  // ── step 1: present a temp password → create a pending request ───────────
  if (action === "request") {
    const resolved = await resolveAccessCode(code);
    if ("error" in resolved) {
      await logSecurityEvent({
        kind: "access-code-rejected",
        detail: `request rejected: ${resolved.error}`,
        request,
      });
      return json({ ok: false, error: resolved.error }, 401);
    }
    const req = await createAccessRequest({
      code: resolved.code,
      clientName,
      task,
      userAgent: request.headers.get("user-agent") ?? "unknown",
      ip: clientIp(request),
    });
    await logSecurityEvent({
      kind: "access-request-created",
      detail: `“${req.clientName}” requested access via ${req.codeHint}${req.task ? ` — ${req.task}` : ""}`,
      request,
    });
    return json({
      ok: true,
      requestId: req.id,
      status: "pending",
      expiresAt: req.expiresAt,
      next: "the owner must approve this request in the Fleet Control dashboard, then poll with { action: \"poll\", requestId, code }",
    });
  }

  // ── step 2: poll for the decision → session handover on approval ─────────
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!requestId) {
    return json({ ok: false, error: "poll requires requestId" }, 400);
  }
  const found = await getPollableRequest(requestId, code);
  if ("error" in found) {
    await logSecurityEvent({
      kind: "access-code-rejected",
      detail: `poll rejected: ${found.error}`,
      request,
    });
    return json({ ok: false, error: found.error }, 401);
  }
  const req = found;

  if (req.status === "pending") {
    return json({
      ok: true,
      requestId: req.id,
      status: "pending",
      expiresAt: req.expiresAt,
    });
  }
  if (req.status === "denied") {
    return json({ ok: true, requestId: req.id, status: "denied" });
  }
  if (req.status === "expired") {
    return json({ ok: true, requestId: req.id, status: "expired" });
  }

  // approved: hand over the session token exactly once
  if (req.consumedAt || !req.sessionToken) {
    return json({
      ok: true,
      requestId: req.id,
      status: "approved",
      alreadyConsumed: true,
      sessionExpiresAt: req.sessionExpiresAt,
      next: "session token was already collected — create a new access request if you lost it",
    });
  }
  const token = req.sessionToken;
  await consumeRequestSession(req.id);
  await logActivity({
    t: new Date().toISOString(),
    label: `access · ${req.clientName}`,
    provider: "-",
    op: `session issued via ${req.codeHint}`,
    ok: true,
    status: 200,
  });
  await logSecurityEvent({
    kind: "access-session-issued",
    detail: `“${req.clientName}” collected a 1-hour session via ${req.codeHint}`,
    request,
  });
  return json({
    ok: true,
    requestId: req.id,
    status: "approved",
    session: token,
    expiresAt: req.sessionExpiresAt,
    scopes: req.scopes,
    next: "use the session token as the x-agent-key header on /api/agent/proxy (or ?session= for one-off calls)",
  });
}
