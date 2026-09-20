import { NextResponse } from "next/server";

import {
  auditVercelDomains,
  connectVercel,
  disconnectVercel,
  reattachVercelDomain,
  vercelStatus,
} from "@/lib/vercel-ops";

export const dynamic = "force-dynamic";

// GET → connect status (no token material, safe to poll)
export async function GET() {
  const status = await vercelStatus();
  return NextResponse.json(status);
}

// POST actions:
//   { action: "connect", token }                    → validate + store once
//   { action: "disconnect" }                        → forget token
//   { action: "audit" }                             → domain → project map + findings
//   { action: "reattach", domain, toProject }       → guarded domain move
export async function POST(req: Request) {
  let body: {
    action?: string;
    token?: string;
    domain?: string;
    toProject?: string;
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
    await disconnectVercel();
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
    const result = await reattachVercelDomain(domain, toProject);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json(
    { error: "Unknown action — expected \"connect\", \"disconnect\", \"audit\" or \"reattach\"." },
    { status: 400 },
  );
}
