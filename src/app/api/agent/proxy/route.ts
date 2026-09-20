// ─── /api/agent/proxy — the capability endpoint behind an agent link ────────
// This is what the AI calls after the user pastes the generated link in chat.
//
// GET  ?session=flk_… [&ping=1]
//        → ping: who am I, what scopes/providers does this link have? No secrets.
// POST ?session=flk_…   body: { provider: "github"|"vercel", method?, path, body? }
//        → scoped, logged proxy call to the stored vault token.
//
// SECURITY MODEL:
//   • the session key authorizes — real tokens stay in db/ (chmod 600)
//   • GET needs <provider>:read, mutations need <provider>:write
//   • mutation paths are allow-listed (repos/contents/issues, projects, …)
//   • every call lands in db/agent-activity.json → visible in the dashboard UI

import { NextResponse } from "next/server";

import {
  AgentScope,
  githubFetch,
  logActivity,
  resolveSession,
  touchSession,
  vercelFetch,
} from "@/lib/agent-vault";

export const dynamic = "force-dynamic";
// serverless safety: fleet checks + upstream API calls can take a while
export const maxDuration = 60;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// mutation allow-lists (prefixes) — read scope has no path restrictions
const GITHUB_WRITE_PREFIXES = ["/repos/", "/user/repos", "/gists"];
const VERCEL_WRITE_PREFIXES = [
  "/v9/projects",
  "/v10/projects",
  "/v13/deployments",
  "/v12/deployments",
  "/v6/deployments",
  "/v2/deployments",
  "/v4/domains",
  "/v3/domains",
  "/v9/top-domains",
];

function bad(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function getKey(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("session");
  if (fromQuery) return fromQuery.trim();
  const header = request.headers.get("x-agent-key");
  return header ? header.trim() : null;
}

// ─── ping ────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const key = getKey(request);
  const resolved = await resolveSession(key);
  if ("error" in resolved) return bad(resolved.error, 401);
  const { session } = resolved;
  const url = new URL(request.url);

  const { githubStatus } = await import("@/lib/agent-vault");
  const { vercelStatus } = await import("@/lib/vercel-ops");
  const [gh, vc] = await Promise.all([githubStatus(), vercelStatus()]);

  await touchSession(session.id);
  if (url.searchParams.get("ping") === "1") {
    await logActivity({
      t: new Date().toISOString(),
      label: session.label,
      provider: "-",
      op: "agent link ping (handshake)",
      ok: true,
      status: 200,
    });
  }

  return NextResponse.json({
    ok: true,
    label: session.label,
    scopes: session.scopes,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    providers: { github: gh.connected, vercel: vc.connected },
    usage: {
      callCount: session.callCount,
      howTo: 'POST /api/agent/proxy?session=<key> { provider, method, path, body? }',
    },
  });
}

// ─── proxy ───────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const key = getKey(request);
  const resolved = await resolveSession(key);
  if ("error" in resolved) return bad(resolved.error, 401);
  const { session } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body.", 400);
  }

  const provider = String(body.provider ?? "");
  if (provider !== "github" && provider !== "vercel") {
    return bad('provider must be "github" or "vercel".', 400);
  }
  const method = String(body.method ?? "GET").toUpperCase() as Method;
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return bad(`method ${method} not allowed.`, 405);
  }
  const path = String(body.path ?? "");
  if (!path.startsWith("/") || path.includes("..") || path.length > 600) {
    return bad("path must start with / and be sane.", 400);
  }

  // scope enforcement
  const readScope: AgentScope = provider === "github" ? "github:read" : "vercel:read";
  const writeScope: AgentScope = provider === "github" ? "github:write" : "vercel:write";
  const isMutation = method !== "GET";
  if (isMutation ? !session.scopes.includes(writeScope) : !session.scopes.includes(readScope)) {
    return bad(
      `agent link “${session.label}” lacks the ${isMutation ? writeScope : readScope} scope — mint a new link with it in the dashboard.`,
      403,
    );
  }

  // mutation path allow-list
  if (isMutation) {
    const prefixes = provider === "github" ? GITHUB_WRITE_PREFIXES : VERCEL_WRITE_PREFIXES;
    if (!prefixes.some((p) => path.startsWith(p))) {
      return bad(
        `mutation path not allow-listed for ${provider} — allowed prefixes: ${prefixes.join(", ")}`,
        403,
      );
    }
    if (/token/i.test(path)) {
      return bad("mutating token endpoints is blocked.", 403);
    }
  }

  const payload = body.body !== undefined ? body.body : undefined;
  const result =
    provider === "github"
      ? await githubFetch(path, method, payload)
      : await vercelFetch(path, method, payload);

  await touchSession(session.id);
  await logActivity({
    t: new Date().toISOString(),
    label: session.label,
    provider,
    op: `${method} ${path}`,
    ok: result.status >= 200 && result.status < 300,
    status: result.status || "network",
  });

  if (result.status === 0) {
    return NextResponse.json({ ok: false, error: result.errorText ?? "upstream network error" }, { status: 502 });
  }
  return NextResponse.json({ ok: result.status < 300, status: result.status, data: result.data });
}
