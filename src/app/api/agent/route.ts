// ─── /api/agent — management plane for the Agent Link system ────────────────
// GET  → vault status (masked), sessions, recent activity. No secrets.
// POST → { action }:
//   connect-github    { token }
//   disconnect-github
//   connect-vercel    { token }   (shares the store with /api/vercel)
//   disconnect-vercel
//   create-session    { label, scopes[], ttlHours } → { key, url } (shown ONCE)
//   revoke-session    { id }

import { NextResponse } from "next/server";

import {
  ALL_SCOPES,
  AgentScope,
  connectGithub,
  createSession,
  disconnectGithub,
  githubStatus,
  logActivity,
  readActivity,
  readSessions,
  revokeSession,
} from "@/lib/agent-vault";
import {
  connectVercel,
  disconnectVercel,
  vercelStatus,
} from "@/lib/vercel-ops";
import {
  logSecurityEvent,
  requireAdmin,
} from "@/lib/security";

export const dynamic = "force-dynamic";

function keyHint(key: string): string {
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export async function GET(request: Request) {
  // sessions metadata (key hints, labels) is admin-only material
  const gate = requireAdmin(request);
  if (gate) return gate;
  const [github, vercel, sessions, activity] = await Promise.all([
    githubStatus(),
    vercelStatus(),
    readSessions(),
    readActivity(),
  ]);
  return NextResponse.json({
    github,
    vercel,
    scopes: ALL_SCOPES,
    sessions: sessions.map((s) => ({
      id: s.id,
      keyHint: keyHint(s.key),
      label: s.label,
      scopes: s.scopes,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      lastUsedAt: s.lastUsedAt,
      callCount: s.callCount,
      revoked: s.revoked,
    })),
    activity,
  });
}

export async function POST(request: Request) {
  // management plane: mint/revoke/connect require a signed-in admin
  const gate = requireAdmin(request);
  if (gate) return gate;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const action = String(body.action ?? "");

  // vault-token removal is one-click (reversible — paste the token back);
  // the challenge flow is reserved for ops that reshape production
  if (action === "disconnect-github") {
    await disconnectGithub();
    await logActivity({
      t: new Date().toISOString(),
      label: "dashboard (admin)",
      provider: "github",
      op: "disconnect vault token (one-click)",
      ok: true,
      status: 200,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "disconnect-vercel") {
    await disconnectVercel();
    await logActivity({
      t: new Date().toISOString(),
      label: "dashboard (admin)",
      provider: "vercel",
      op: "disconnect vault token (one-click)",
      ok: true,
      status: 200,
    });
    return NextResponse.json({ ok: true });
  }

  try {
    switch (action) {
      case "connect-github": {
        const token = String(body.token ?? "");
        if (!token) {
          return NextResponse.json(
            { ok: false, error: "Paste a GitHub token (PAT) first." },
            { status: 400 },
          );
        }
        const res = await connectGithub(token);
        if (res.ok) {
          await logActivity({
            t: new Date().toISOString(),
            label: "dashboard (admin)",
            provider: "github",
            op: "connect vault token",
            ok: true,
            status: 200,
          });
        } else {
          await logSecurityEvent({
            kind: "vault-connect-rejected",
            detail: `github connect failed: ${res.error ?? "unknown"}`,
            request,
          });
        }
        return res.ok
          ? NextResponse.json({ ok: true, login: res.login })
          : NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      }

      case "disconnect-github":
      case "disconnect-vercel": {
        // handled above (one-click) — this branch only satisfies exhaustive checks
        return NextResponse.json({ ok: true });
      }

      case "connect-vercel": {
        const token = String(body.token ?? "");
        if (!token) {
          return NextResponse.json(
            { ok: false, error: "Paste a Vercel token first." },
            { status: 400 },
          );
        }
        const res = await connectVercel(token);
        return res.ok
          ? NextResponse.json({ ok: true, username: res.username })
          : NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      }

      case "create-session": {
        const scopes = Array.isArray(body.scopes)
          ? (body.scopes.map(String) as AgentScope[]).filter((s) =>
              ALL_SCOPES.includes(s),
            )
          : [];
        if (scopes.length === 0) {
          return NextResponse.json(
            { ok: false, error: "Pick at least one scope for the agent link." },
            { status: 400 },
          );
        }
        const ttlHours = Number(body.ttlHours ?? 168); // default 7 days
        const { session, url } = await createSession({
          label: String(body.label ?? "agent session"),
          scopes,
          ttlHours: Number.isFinite(ttlHours) ? ttlHours : 168,
        });
        await logActivity({
          t: new Date().toISOString(),
          label: "dashboard (admin)",
          provider: "-",
          op: `minted agent link “${session.label}” (${scopes.join(", ")})`,
          ok: true,
          status: 200,
        });
        return NextResponse.json({
          ok: true,
          id: session.id,
          key: session.key, // full key — shown once in the UI
          url,
          expiresAt: session.expiresAt,
          scopes: session.scopes,
        });
      }

      case "revoke-session": {
        const id = String(body.id ?? "");
        const done = await revokeSession(id);
        if (!done) {
          return NextResponse.json({ ok: false, error: "Unknown session id." }, { status: 404 });
        }
        await logActivity({
          t: new Date().toISOString(),
          label: "dashboard (admin)",
          provider: "-",
          op: "revoked an agent link",
          ok: true,
          status: 200,
        });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action “${action}”.` },
          { status: 400 },
        );
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unexpected error." },
      { status: 500 },
    );
  }
}
