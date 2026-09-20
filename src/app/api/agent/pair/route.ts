// ─── /api/agent/pair — admin-gated one-time pairing codes ────────────────────
// POST {} | { key?: "flk_…" }   (admin cookie required on deployed instances)
//   → { ok, code: "pair_…", expiresAt, parentHint }
//
// The dashboard shows the code for 10 minutes; the user pastes ONLY the code
// into chat and the AI exchanges it for a 1-hour derived session. The agent
// link itself never enters the chat transcript — this closes the
// "pasted-link-is-a-live-credential" gap from the external reviews.

import { NextResponse } from "next/server";

import { mintPairCode } from "@/lib/agent-vault";
import { logSecurityEvent, requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const gate = requireAdmin(request);
  if (gate) return gate;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine — default parent applies
  }
  const key = typeof body.key === "string" ? body.key.trim() : undefined;

  const result = await mintPairCode(key);
  if ("error" in result) {
    await logSecurityEvent({
      kind: "pair-rejected",
      detail: `pairing code refused: ${result.error}`,
      request,
    });
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  await logSecurityEvent({
    kind: "pair-issued",
    detail: `one-time pairing code issued for ${result.parentHint} (10 min)`,
    request,
  });

  return NextResponse.json(
    { ok: true, code: result.code, expiresAt: result.expiresAt, parentHint: result.parentHint },
    { headers: { "cache-control": "no-store" } },
  );
}
