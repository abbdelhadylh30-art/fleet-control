// ─── /api/selfops — the dashboard's own deployment control room ──────────────
// GET        → status: fs persistence probe, env agent keys, latest production deploy
// POST       → { action: "redeploy" }                          → fresh production deploy
//              { action: "promote", key: "flk_…" }             → minted link → permanent env key + redeploy
//
// Only reachable from the dashboard behind the admin gate (never exposed
// through /api/agent/proxy), so promotions are limited to keys actually
// minted by this instance — plus a one-time challenge on every action.

import { NextResponse } from "next/server";

import { promoteSessionToEnv, redeployProduction, selfOpsStatus } from "@/lib/selfops";
import { logSecurityEvent, requireAdmin, requireChallenge } from "@/lib/security";

const NEON_API = "https://api.neon.tech/v2";

interface NeonConnUri {
  connection_uri?: string;
}

async function neonFetch(
  path: string,
  apiKey: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: Record<string, unknown> | null; errorText?: string }> {
  try {
    const res = await fetch(`${NEON_API}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = (json?.message as string) ?? text.slice(0, 200);
      return { status: res.status, json, errorText: `Neon ${res.status}: ${msg}` };
    }
    return { status: res.status, json };
  } catch (e) {
    const cause =
      e instanceof Error && "cause" in e ? ` (cause: ${String((e as { cause?: unknown }).cause)})` : "";
    return { status: 0, json: null, errorText: (e instanceof Error ? e.message : "network error") + cause };
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // exposes env key hints + deployment internals → admin-only
  const gate = requireAdmin(request);
  if (gate) return gate;
  const status = await selfOpsStatus();
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const gate = requireAdmin(request);
  if (gate) return gate;

  let body: { action?: string; key?: string; apiKey?: string; confirmToken?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action === "redeploy") {
    // destructive (touches production) → one-time challenge required
    const ch = requireChallenge(body as Record<string, unknown>, "selfops-redeploy");
    if (ch) return ch;
    const res = await redeployProduction();
    if (res.ok) {
      await logSecurityEvent({
        kind: "selfops-redeploy",
        detail: `production redeploy uid=${res.uid ?? "?"} (challenge-confirmed)`,
        request,
      });
    }
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  }

  if (body.action === "promote" && typeof body.key === "string") {
    const ch = requireChallenge(body as Record<string, unknown>, "selfops-promote");
    if (ch) return ch;
    const res = await promoteSessionToEnv(body.key.trim());
    if (res.ok && res.updated) {
      await logSecurityEvent({
        kind: "selfops-promote",
        detail: `minted key promoted to FLEET_AGENT_KEYS + redeploy ${res.redeployUid ?? ""}`,
        request,
      });
    }
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  if (body.action === "neon-provision" && typeof body.apiKey === "string") {
    // creates a Neon project from THIS instance's network (the local sandbox
    // cannot reach api.neon.tech) — challenge-protected, key used per-request only
    const ch = requireChallenge(body as Record<string, unknown>, "selfops-neon");
    if (ch) return ch;
    const apiKey = body.apiKey.trim();

    const created = await neonFetch("/projects", apiKey, {
      method: "POST",
      body: { project: { name: "fleet-control", region_id: "aws-us-east-1" } },
    });
    if (created.status !== 201 || !created.json) {
      return NextResponse.json(
        { ok: false, error: created.errorText ?? "project creation failed" },
        { status: 502 },
      );
    }
    const project = created.json.project as { id?: string; region_id?: string } | undefined;
    const projectId = project?.id ?? "";
    if (!projectId) {
      return NextResponse.json({ ok: false, error: "missing project id in Neon response" }, { status: 502 });
    }

    // connection URIs: pooled (runtime) + direct (migrations)
    const conn = await neonFetch(`/projects/${projectId}/connection_uri?pooled=true`, apiKey);
    const connDirect = await neonFetch(`/projects/${projectId}/connection_uri?pooled=false`, apiKey);
    const fallback = (created.json.connection_uris as NeonConnUri[] | undefined)?.[0]?.connection_uri;
    const pooledUri = (conn.json as { uri?: string } | null)?.uri ?? fallback ?? null;
    const directUri = (connDirect.json as { uri?: string } | null)?.uri ?? pooledUri;

    await logSecurityEvent({
      kind: "selfops-neon-provision",
      detail: `neon project ${projectId} (${project?.region_id ?? "aws-us-east-1"}) provisioned via self-ops`,
      request,
    });
    return NextResponse.json({
      ok: true,
      projectId,
      region: project?.region_id ?? "aws-us-east-1",
      pooledUri,
      directUri,
    });
  }

  if (body.action === "neon-status" && typeof body.apiKey === "string") {
    const res = await neonFetch("/projects?limit=20", body.apiKey.trim());
    if (res.status !== 200 || !res.json) {
      return NextResponse.json({ ok: false, error: res.errorText ?? "listing failed" }, { status: 502 });
    }
    const projects = (res.json.projects as { id: string; name: string; region_id?: string }[]) ?? [];
    return NextResponse.json({
      ok: true,
      projects: projects.map((p) => ({ id: p.id, name: p.name, region: p.region_id ?? "" })),
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        'action must be "redeploy", "promote", "neon-provision" or "neon-status" (+ apiKey for neon).',
    },
    { status: 400 },
  );
}
