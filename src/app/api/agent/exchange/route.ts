// ─── /api/agent/exchange — the session handoff ───────────────────────────────
// POST { code?: "pair_…", scopes?: string[] }   (pairing-code flow)
//      header x-agent-key: flk_… + body { scopes? }   (direct link flow)
//   → { ok, session: "fls_…", expiresAt, scopes, parentHint }
//
// The long-lived agent link becomes a BOOTSTRAP secret: present it ONCE (or
// present a one-time pairing code and keep the link out of chat entirely) and
// work for the next hour under a short-lived derived session. Rate-limited,
// audited, never echoes the parent key.

import { NextResponse } from "next/server";

import {
  logActivity,
  mintDerivedFromPairHash,
  mintDerivedSession,
  verifyPairCode,
} from "@/lib/agent-vault";
import { logSecurityEvent, rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function bad(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body.", 400);
  }

  const headerKey = request.headers.get("x-agent-key")?.trim() || null;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const parentKey = headerKey ?? (typeof body.key === "string" ? body.key.trim() : "");
  const requestedScopes = Array.isArray(body.scopes)
    ? body.scopes.map(String).slice(0, 8)
    : undefined;

  // abuse cap on the exchange endpoint itself
  const limiterId = code ? `pair:${code.slice(5, 29)}` : `key:${parentKey.slice(0, 40)}`;
  const rl = rateLimit(`exchange:${limiterId}`, 15, 10 * 60_000);
  if (!rl.ok) {
    await logSecurityEvent({
      kind: "exchange-rate-limited",
      detail: "exchange endpoint flooded — throttled",
      request,
    });
    return bad(`too many exchanges — retry in ${rl.retryAfter}s.`, 429);
  }

  let result;
  let via: string;
  if (code) {
    const verified = await verifyPairCode(code);
    if ("error" in verified) {
      await logSecurityEvent({
        kind: "exchange-auth-failed",
        detail: `pair-code exchange rejected: ${verified.error}`,
        request,
      });
      return bad(verified.error, 401);
    }
    result = await mintDerivedFromPairHash(verified.ph, requestedScopes);
    via = "pairing code";
  } else if (parentKey) {
    result = await mintDerivedSession(parentKey, requestedScopes);
    via = "agent link";
  } else {
    return bad("send a pairing code (code) or the agent link (x-agent-key header).", 400);
  }

  if ("error" in result) {
    await logSecurityEvent({
      kind: "exchange-auth-failed",
      detail: `${via} exchange rejected: ${result.error}`,
      request,
    });
    return bad(result.error, 401);
  }

  await logActivity({
    t: new Date().toISOString(),
    label: `derived session (1h) via ${via}`,
    provider: "-",
    op: `session handoff — parent ${result.parentHint}`,
    ok: true,
    status: 200,
  });

  return NextResponse.json(
    {
      ok: true,
      session: result.token,
      tokenType: "fls",
      expiresAt: result.expiresAt,
      scopes: result.scopes,
      parentHint: result.parentHint,
      howTo:
        "send this token as the x-agent-key header (or ?session=) to /api/agent/proxy for the next hour. The parent link never needs to appear in URLs or chat again — re-exchange when this expires.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
