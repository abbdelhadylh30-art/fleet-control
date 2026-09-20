import { NextResponse } from "next/server";

import {
  auditVercelDomains,
  connectVercel,
  disconnectVercel,
  reattachVercelDomain,
  vercelStatus,
} from "@/lib/vercel-ops";
import { logSecurityEvent, requireAdmin, requireChallenge } from "@/lib/security";

export const dynamic = "force-dynamic";

// GET → connect status (no token material, safe to poll)
export async function GET() {
  const status = await vercelStatus();
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}

// POST actions (admin-gated; disconnect/reattach are destructive → challenge):
//   { action: "connect", token }                    → validate + store once
//   { action: "disconnect", confirmToken }          → forget token
//   { action: "audit" }                             → domain → project map + findings
//   { action: "reattach", domain, toProject, confirmToken } → guarded domain move
export async function POST(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  let body: {
    action?: string;
    token?: string;
    domain?: string;
    toProject?: string;
    confirmToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "connect") {
    const token = (body.token ?? "").trim();
    if (!token)
      return NextResponse.json(
        { error: "Missing token — create one at vercel.com/account/tokens." },
        { status: 400 },
      );
    const result = await connectVercel(token);
    if (!result.ok)
      return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, username: result.username });
  }

  if (body.action === "disconnect") {
    const ch = requireChallenge(body as Record<string, unknown>, "vercel-disconnect");
    if (ch) return ch;
    await disconnectVercel();
    await logSecurityEvent({
      kind: "vercel-disconnect",
      detail: "vault token removed (challenge-confirmed)",
      request: req,
    });
    return NextResponse.json({ ok: true, connected: false });
  }

  if (body.action === "audit") {
    const status = await vercelStatus();
    if (!status.connected)
      return NextResponse.json(
        { error: "Connect a Vercel token first." },
        { status: 401 },
      );
    const result = await auditVercelDomains();
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (body.action === "reattach") {
    const domain = (body.domain ?? "").trim();
    const toProject = (body.toProject ?? "").trim();
    if (!domain || !toProject)
      return NextResponse.json(
        { error: "Missing domain or toProject." },
        { status: 400 },
      );
    const ch = requireChallenge(body as Record<string, unknown>, "vercel-reattach");
    if (ch) return ch;
    const result = await reattachVercelDomain(domain, toProject);
    if (result.ok) {
      await logSecurityEvent({
        kind: "vercel-reattach",
        detail: `${domain} → ${toProject} (challenge-confirmed)`,
        request: req,
      });
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json(
    { error: "Unknown action — expected \"connect\", \"disconnect\", \"audit\" or \"reattach\"." },
    { status: 400 },
  );
}
