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
import {
  logSecurityEvent,
  rateLimit,
} from "@/lib/security";

export const dynamic = "force-dynamic";
// serverless safety: fleet checks + upstream API calls can take a while
export const maxDuration = 60;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// mutation allow-lists (prefixes) — read scope has no path restrictions
// (beyond the secret-leak guardrails below)
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

// ─── secret-leak guardrails (2026-09-20 audit, finding C1) ───────────────────
// A read-scoped link could previously call GET /v10/projects/{p}/env/{id}
// ?decrypt=true and read DECRYPTED vault secrets (FLEET_ADMIN_PASSWORD,
// provider tokens, DB creds) straight through the proxy. Never again:
//   • Vercel env-var surfaces (project + deployment env, any method)
//   • an explicit decrypt/decryptable flag, for either provider
const SENSITIVE_READ_DENY: Array<{ re: RegExp; why: string }> = [
  { re: /^\/v(1|9|10)\/projects\/[^/?]+\/env([\/?]|$)/, why: "project env-var surface" },
  { re: /^\/v1\/deployments\/[^/?]+\/env([\/?]|$)/, why: "deployment env-var surface" },
  { re: /[?&](decrypt|decryptable)=true\b/i, why: "explicit decrypt flag" },
];

// ─── catastrophic-mutation guardrails (2026-09-20 audit, finding C6) ────────
// Prefix allow-lists alone let through: DELETE /repos/{owner}/{repo} (repo
// deletion!), PATCH /repos/{o}/{r} (rename), DELETE /v9/projects/{id}
// (project deletion), DELETE /v4/domains/{name} (domain removal). These exact
// shapes are denied even WITH write scope — an agent never needs them.
const CATASTROPHIC_MUTATION_DENY: Array<{ provider: "github" | "vercel"; re: RegExp; why: string }> = [
  { provider: "github", re: /^\/repos\/[^/]+\/[^/?]+\/?$/, why: "repo delete/rename (exact project root)" },
  { provider: "github", re: /^\/repos\/[^/]+\/[^/]+\/transfer\/?$/, why: "repo transfer" },
  { provider: "vercel", re: /^\/v(9|10)\/projects\/[^/?]+\/?$/, why: "project delete/update (exact project root)" },
  { provider: "vercel", re: /^\/v(3|4|9|10)\/(top-)?domains\/[^/?]+\/?$/, why: "domain delete (exact domain root)" },
  { provider: "vercel", re: /^\/v(1|9|10)\/projects\/[^/?]+\/env([\/?]|$)/, why: "env-var mutation" },
];

function bad(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Key extraction — HEADER FIRST. Capability links keep ?session= for humans
 * and AI chat flows, but programmatic callers should send x-agent-key so the
 * key stays out of access logs, CDN logs and browser history entirely.
 */
function getKey(request: Request): string | null {
  const header = request.headers.get("x-agent-key");
  if (header) return header.trim();
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("session");
  return fromQuery ? fromQuery.trim() : null;
}

// ─── ping ────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const key = getKey(request);
  const resolved = await resolveSession(key);
  if ("error" in resolved) {
    await logSecurityEvent({
      kind: "proxy-auth-failed",
      detail: `GET ping: ${resolved.error}`,
      request,
    });
    return bad(resolved.error, 401);
  }
  const { session } = resolved;
  const url = new URL(request.url);

  // per-key abuse cap (in-memory, per warm instance)
  const rl = rateLimit(`proxy:${session.id}`, 60, 60_000);
  if (!rl.ok) {
    await logSecurityEvent({
      kind: "proxy-rate-limited",
      detail: `key “${session.label}” exceeded 60 req/min`,
      request,
    });
    return bad(`rate limit — retry in ${rl.retryAfter}s.`, 429);
  }

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
      howTo: 'POST /api/agent/proxy { provider, method, path, body? } — send the key in the x-agent-key header (recommended, keeps it out of logs) or as ?session=<key>. Better: POST /api/agent/exchange with that key ONCE → work for 1h under the returned fls_ token (or paste a one-time pair_ code from the dashboard and the link never enters chat at all).',
    },
  }, { headers: { "cache-control": "no-store" } });
}

// ─── proxy ───────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const key = getKey(request);
  const resolved = await resolveSession(key);
  if ("error" in resolved) {
    // every failed capability attempt lands in the security log — a leak
    // shows up here (with IP) instead of being discovered via a rogue deploy
    await logSecurityEvent({
      kind: "proxy-auth-failed",
      detail: `POST proxy: ${resolved.error}`,
      request,
    });
    return bad(resolved.error, 401);
  }
  const { session } = resolved;

  // per-key abuse cap
  const rl = rateLimit(`proxy:${session.id}`, 60, 60_000);
  if (!rl.ok) {
    await logSecurityEvent({
      kind: "proxy-rate-limited",
      detail: `key “${session.label}” exceeded 60 req/min`,
      request,
    });
    return bad(`rate limit — retry in ${rl.retryAfter}s.`, 429);
  }

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
  // hard charset gate: upstream base is FIXED (api.github.com / api.vercel.com)
  // so classic SSRF is impossible; this blocks control chars / header injection
  // and anything outside the URL-safe set from ever reaching the upstream URL.
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%?\/-]*$/.test(path.slice(1))) {
    await logSecurityEvent({
      kind: "proxy-path-rejected",
      detail: `non-URL-safe path for ${provider}: ${path.slice(0, 80)}`,
      request,
    });
    return bad("path contains characters outside the URL-safe set.", 400);
  }

  // secret-leak guardrails apply to EVERY method (read AND write) — env-var
  // surfaces and decrypt flags must never round-trip through the proxy.
  const leak = SENSITIVE_READ_DENY.find((d) => d.re.test(path));
  if (leak) {
    await logSecurityEvent({
      kind: "proxy-secret-leak-blocked",
      detail: `blocked ${method} ${provider} ${path.slice(0, 80)} (${leak.why})`,
      request,
    });
    return bad(
      `blocked: ${leak.why} is not reachable through the agent proxy — secrets stay in the vault.`,
      403,
    );
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
      await logSecurityEvent({
        kind: "proxy-token-block",
        detail: `blocked token-endpoint mutation: ${method} ${path.slice(0, 80)}`,
        request,
      });
      return bad("mutating token endpoints is blocked.", 403);
    }
    // catastrophic shapes (exact project/domain/repo roots) are denied even
    // when the prefix allow-list matched — see CATASTROPHIC_MUTATION_DENY.
    const bare = path.split("?")[0];
    const catastrophic = CATASTROPHIC_MUTATION_DENY.find(
      (d) => d.provider === provider && d.re.test(bare),
    );
    if (catastrophic) {
      await logSecurityEvent({
        kind: "proxy-catastrophic-block",
        detail: `blocked ${method} ${provider} ${path.slice(0, 80)} (${catastrophic.why})`,
        request,
      });
      return bad(
        `blocked: ${catastrophic.why} — this operation is intentionally out of reach for agent links.`,
        403,
      );
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
    return NextResponse.json(
      { ok: false, error: result.errorText ?? "upstream network error" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: result.status < 300, status: result.status, data: result.data },
    { headers: { "cache-control": "no-store" } },
  );
}
