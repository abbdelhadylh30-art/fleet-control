// ─── Vercel API ops — one-time token, scripted domain re-attachment ─────────
// The user pastes a Vercel API token ONCE (dashboard → vercel.com/account/
// tokens). We store it server-side (db/vercel-auth.json, chmod 600) and use it
// to (a) audit which project serves each fleet domain and (b) re-attach stale
// assignments (leads./dev.) to the correct git-linked projects — the exact
// manual step that currently blocks 5 fleet sites.
//
// SECURITY: the token never reaches the client after save, is never logged,
// and every mutation is guarded to *.abdelhadygabriel.me domains only.

import { promises as fs } from "fs";
import path from "path";

const VERCEL_AUTH_PATH = path.join(process.cwd(), "db", "vercel-auth.json");
const API = "https://api.vercel.com";
const FLEET_DOMAIN_SUFFIX = ".abdelhadygabriel.me";
const APEX = "abdelhadygabriel.me";

export interface VercelAuthStore {
  token: string;
  savedAt: string; // ISO
  account: { uid: string; username: string; email: string | null };
}

export interface VercelStatus {
  connected: boolean;
  savedAt: string | null;
  account: { uid: string; username: string; email: string | null } | null;
}

async function readToken(): Promise<VercelAuthStore | null> {
  try {
    const raw = await fs.readFile(VERCEL_AUTH_PATH, "utf8");
    const parsed = JSON.parse(raw) as VercelAuthStore;
    if (parsed?.token) return parsed;
  } catch {
    /* fall through to env */
  }
  // Serverless fallback (Vercel deploy): env-provided token, fileless.
  const t = process.env.FLEET_VERCEL_TOKEN;
  if (t && t.length >= 20) {
    return {
      token: t,
      savedAt: "",
      account: { uid: "", username: "env-configured", email: null },
    };
  }
  return null;
}

/** Server-side-only accessor for the agent proxy (never leaves the server). */
export async function readVercelTokenForAgent(): Promise<string | null> {
  const store = await readToken();
  return store?.token ?? null;
}

async function writeToken(store: VercelAuthStore | null): Promise<void> {
  try {
    if (store === null) {
      await fs.rm(VERCEL_AUTH_PATH, { force: true });
      return;
    }
    await fs.writeFile(VERCEL_AUTH_PATH, JSON.stringify(store), { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

export async function vercelStatus(): Promise<VercelStatus> {
  const store = await readToken();
  return {
    connected: !!store,
    savedAt: store?.savedAt ?? null,
    account: store?.account ?? null,
  };
}

export async function disconnectVercel(): Promise<void> {
  await writeToken(null);
}

/** Validate a token against /v2/user and persist it. */
export async function connectVercel(
  rawToken: string,
): Promise<{ ok: boolean; error?: string; username?: string }> {
  const token = rawToken.trim();
  if (token.length < 20 || /\s/.test(token)) {
    return { ok: false, error: "That doesn't look like a Vercel token — create one at vercel.com/account/tokens." };
  }
  try {
    const res = await fetch(`${API}/v2/user`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 403 || res.status === 401
            ? "Vercel rejected the token (403) — check it's valid and has full scope."
            : `Vercel API returned ${res.status}.`,
      };
    }
    const body = (await res.json()) as {
      user?: { uid?: string; username?: string; email?: string };
    };
    const user = body.user ?? {};
    await writeToken({
      token,
      savedAt: new Date().toISOString(),
      account: {
        uid: String(user.uid ?? ""),
        username: String(user.username ?? "unknown"),
        email: user.email ?? null,
      },
    });
    return { ok: true, username: String(user.username ?? "unknown") };
  } catch (e) {
    return { ok: false, error: `Could not reach Vercel: ${e instanceof Error ? e.message : "network error"}` };
  }
}

async function vfetch(
  path: string,
  init?: { method?: "GET" | "POST" | "DELETE"; body?: unknown },
): Promise<{ status: number; body: Record<string, unknown> | null; errorText?: string }> {
  const store = await readToken();
  if (!store) return { status: 0, body: null, errorText: "no stored token" };
  try {
    const res = await fetch(`${API}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${store.token}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body, errorText: text.slice(0, 240) };
  } catch (e) {
    return {
      status: 0,
      body: null,
      errorText: e instanceof Error ? e.message : "network error",
    };
  }
}

export interface VercelFinding {
  domain: string;
  currentProject: string | null;
  expectedProject: string | null;
  ok: boolean | null; // null = informational (no expectation)
  note?: string;
}

export interface VercelAuditResult {
  ok: boolean;
  error?: string;
  projects: Array<{ name: string; domains: string[] }>;
  findings: VercelFinding[];
}

// domains that MUST live on a specific project (the two known-stale ones)
const EXPECTED: Array<{ domain: string; project: string }> = [
  { domain: `leads${FLEET_DOMAIN_SUFFIX}`, project: "lead-profiler-deploy" },
  { domain: `dev${FLEET_DOMAIN_SUFFIX}`, project: "abdelhady-gabriel" },
];

/** host → project it SHOULD be served by (the auto-pilot's re-attach map). */
export const EXPECTED_PROJECTS: Record<string, string> = Object.fromEntries(
  EXPECTED.map((e) => [e.domain, e.project]),
);

function isFleetDomain(domain: string): boolean {
  return domain === APEX || domain.endsWith(FLEET_DOMAIN_SUFFIX);
}

/** Map every fleet domain → the Vercel project currently serving it. */
export async function auditVercelDomains(): Promise<VercelAuditResult> {
  const projectsRes = await vfetch("/v9/projects?limit=100");
  if (projectsRes.status !== 200 || !projectsRes.body) {
    return {
      ok: false,
      error:
        projectsRes.status === 403
          ? "Token rejected while listing projects (403) — needs read scope."
          : `Vercel API returned ${projectsRes.status} — ${projectsRes.errorText ?? ""}`.trim(),
      projects: [],
      findings: [],
    };
  }
  const projects = (projectsRes.body.projects as Array<{ name?: string }> ?? [])
    .map((p) => String(p.name ?? ""))
    .filter(Boolean);

  const domainMap = new Map<string, string>(); // domain → project name
  await Promise.all(
    projects.map(async (name) => {
      const res = await vfetch(`/v9/projects/${encodeURIComponent(name)}/domains?limit=100`);
      if (res.status === 200 && res.body) {
        const list = (res.body.domains as Array<{ name?: string }> ?? [])
          .map((d) => String(d.name ?? ""))
          .filter(isFleetDomain);
        for (const d of list) domainMap.set(d, name);
      }
    }),
  );

  const findings: VercelFinding[] = EXPECTED.map(({ domain, project }) => {
    const current = domainMap.get(domain) ?? null;
    return {
      domain,
      currentProject: current,
      expectedProject: project,
      ok: current === project,
      note:
        current === project
          ? "already attached to the git-linked project"
          : current
            ? `currently served by “${current}” (stale project) — move it to “${project}”`
            : `not attached to any project — attach it to “${project}”`,
    };
  });

  return {
    ok: true,
    projects: projects.map((name) => ({
      name,
      domains: [...domainMap.entries()]
        .filter(([, p]) => p === name)
        .map(([d]) => d),
    })),
    findings,
  };
}

/**
 * Move a fleet domain from its current project to `toProject` (guarded).
 * Idempotent: if the domain is already on the target, returns ok without
 * touching anything — and a 409 during ADD is re-probed, because "already
 * attached to the expected project" is success, not failure.
 */
export async function reattachVercelDomain(
  domain: string,
  toProject: string,
): Promise<{ ok: boolean; error?: string; moved?: { from: string | null; to: string }; alreadyCorrect?: boolean }> {
  if (!isFleetDomain(domain)) {
    return { ok: false, error: "Blocked — only *.abdelhadygabriel.me domains can be managed here." };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(toProject)) {
    return { ok: false, error: "Bad project name." };
  }
  const store = await readToken();
  if (!store) return { ok: false, error: "Connect a Vercel token first." };

  // DIRECT probe: is the domain already on the target project? (a flaky
  // parallel audit must never trigger a pointless domain move)
  const probe = await vfetch(
    `/v9/projects/${encodeURIComponent(toProject)}/domains/${encodeURIComponent(domain)}`,
  );
  if (probe.status === 200) {
    return { ok: true, alreadyCorrect: true, moved: { from: toProject, to: toProject } };
  }

  // find current holder among the user's projects
  const audit = await auditVercelDomains();
  if (!audit.ok) return { ok: false, error: audit.error ?? "audit failed" };
  const from = audit.findings.find((f) => f.domain === domain)?.currentProject ?? null;

  // detach from the old project (ignore 404 — maybe unattached)
  if (from && from !== toProject) {
    const del = await vfetch(
      `/v9/projects/${encodeURIComponent(from)}/domains/${encodeURIComponent(domain)}`,
      { method: "DELETE" },
    );
    if (del.status !== 200 && del.status !== 404) {
      return {
        ok: false,
        error: `Could not detach from “${from}” (HTTP ${del.status}) — ${del.errorText ?? ""}`.trim(),
      };
    }
  }

  // attach to the target project
  const add = await vfetch(`/v9/projects/${encodeURIComponent(toProject)}/domains`, {
    method: "POST",
    body: { name: domain },
  });
  if (add.status !== 200) {
    // 409 re-probe: if the domain is on the target NOW, we're done — the
    // earlier detach+attach race released late, but the end state is correct.
    const confirm = await vfetch(
      `/v9/projects/${encodeURIComponent(toProject)}/domains/${encodeURIComponent(domain)}`,
    );
    if (confirm.status === 200) {
      return { ok: true, moved: { from, to: toProject } };
    }
    const err = add.body as { error?: { code?: string; message?: string } } | null;
    const code = err?.error?.code;
    const msg = err?.error?.message ?? add.errorText ?? "";
    return {
      ok: false,
      error:
        code === "domain_already_in_use" || /already.*in use|assigned/i.test(msg)
          ? `Vercel says the domain is still bound (HTTP ${add.status}) — detach fully then retry. ${msg.slice(0, 140)}`
          : `Attach failed (HTTP ${add.status}) — ${msg.slice(0, 180)}`,
    };
  }
  return { ok: true, moved: { from, to: toProject } };
}
