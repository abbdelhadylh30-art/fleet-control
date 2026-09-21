// ─── Self-ops — the dashboard monitors & operates its own deployment ─────────
// Fleet Control is itself deployed on Vercel (fleet.abdelhadygabriel.me).
// These helpers let ANY instance (local or deployed) inspect that production
// deployment, list the permanent env agent keys, trigger a production
// redeploy, and "promote" a UI-minted agent link into FLEET_AGENT_KEYS so it
// survives serverless cold starts — the exact gap hit when a link minted in
// the deployed UI returned 401 "unknown session" after its FS page was recycled.
//
// Token source: the shared Vercel vault (db/vercel-auth.json locally,
// FLEET_VERCEL_TOKEN env on the deployed instance) via vercel-ops.
// All calls are Vercel API — no mutation allow-list here because this module
// is only reachable from the dashboard routes (never via /api/agent/proxy).

import { promises as fs } from "fs";
import path from "path";

const VERCEL_API = "https://api.vercel.com";
const WRITE_PROBE = path.join(process.cwd(), "db", ".write-probe");

export interface SelfOpsStatus {
  fsWritable: boolean; // false on serverless → minted links don't persist
  project: string; // Vercel project name backing the deployed dashboard
  envKeys: { hint: string; scopes: string[] }[]; // masked FLEET_AGENT_KEYS entries + effective scopes
  latest: {
    uid: string;
    readyState: string;
    createdAt: number | null;
    url: string | null;
    sha: string | null;
    target: string | null;
  } | null;
  latestError?: string;
}

function maskKey(key: string): string {
  return key.length > 12 ? `flk_…${key.slice(-4)}` : "flk_…";
}

/** Parse a FLEET_AGENT_KEYS entry → masked hint + effective scope list. */
function describeKeyEntry(entry: string): { hint: string; scopes: string[] } {
  const idx = entry.indexOf(":");
  const key = idx === -1 ? entry : entry.slice(0, idx);
  const spec =
    idx === -1
      ? process.env.FLEET_AGENT_SCOPES ??
        "github:read,github:write,vercel:read,vercel:write"
      : entry.slice(idx + 1);
  const ALL = ["github:read", "github:write", "vercel:read", "vercel:write"];
  const scopes = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => (ALL as string[]).includes(s));
  return { hint: maskKey(key), scopes };
}

async function vercelApi<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ status: number; data: T | null; error?: string }> {
  const { readVercelTokenForAgent } = await import("./vercel-ops");
  const token = await readVercelTokenForAgent();
  if (!token) return { status: 0, data: null, error: "Vercel not connected in the vault" };
  try {
    const res = await fetch(`${VERCEL_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data, error: res.ok ? undefined : text.slice(0, 240) };
  } catch (e) {
    return { status: 0, data: null, error: e instanceof Error ? e.message : "network error" };
  }
}

function project(): string {
  return (process.env.FLEET_VERCEL_PROJECT ?? "fleet-control").trim();
}

/** Probe whether the FS actually persists (local: yes · Vercel lambda: no). */
async function probeFsWritable(): Promise<boolean> {
  try {
    await fs.writeFile(WRITE_PROBE, String(Date.now()), { mode: 0o600 });
    await fs.rm(WRITE_PROBE, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function selfOpsStatus(): Promise<SelfOpsStatus> {
  const fsWritable = await probeFsWritable();
  const { splitKeyEntries } = await import("./agent-vault");
  const envKeys = splitKeyEntries(process.env.FLEET_AGENT_KEYS ?? "").map(describeKeyEntry);

  interface DeploysShape {
    deployments?: {
      uid?: string;
      readyState?: string;
      createdAt?: number;
      url?: string;
      target?: string;
      meta?: { githubCommitSha?: string };
    }[];
  }
  let latest: SelfOpsStatus["latest"] = null;
  let latestError: string | undefined;
  try {
    const res = await vercelApi<DeploysShape>(
      `/v6/deployments?app=${encodeURIComponent(project())}&target=production&limit=1`,
      "GET",
    );
    if (res.status === 200 && res.data?.deployments?.length) {
      const d = res.data.deployments[0];
      latest = {
        uid: d.uid ?? "",
        readyState: d.readyState ?? "UNKNOWN",
        createdAt: d.createdAt ?? null,
        url: d.url ?? null,
        sha: d.meta?.githubCommitSha?.slice(0, 7) ?? null,
        target: d.target ?? "production",
      };
    } else if (res.error) {
      latestError = res.error;
    }
  } catch (e) {
    latestError = e instanceof Error ? e.message : "deploy lookup failed";
  }

  return { fsWritable, project: project(), envKeys, latest, latestError };
}

/** Trigger a fresh production deployment from the connected GitHub repo. */
export async function redeployProduction(): Promise<{
  ok: boolean;
  uid?: string;
  error?: string;
}> {
  const repoSlug = (process.env.FLEET_GITHUB_REPO ?? "abbdelhadylh30-art/fleet-control").trim();

  // numeric repoId — Vercel's gitSource API rejects slugs
  const { githubFetch } = await import("./agent-vault");
  const repoRes = await githubFetch(`/repos/${repoSlug}`, "GET", undefined);
  const repoId =
    repoRes.status === 200 && repoRes.data && typeof repoRes.data === "object"
      ? (repoRes.data as { id?: number }).id
      : undefined;
  if (!repoId) {
    return { ok: false, error: `could not resolve repoId for ${repoSlug} (is GitHub connected?)` };
  }

  const res = await vercelApi<{ id?: string; uid?: string }>("/v13/deployments", "POST", {
    name: project(),
    target: "production",
    gitSource: { type: "github", repoId, ref: "main" },
  });
  if (res.status === 200 && res.data) {
    return { ok: true, uid: res.data.uid ?? res.data.id };
  }
  return { ok: false, error: res.error ?? `Vercel API returned ${res.status}` };
}

/**
 * Copy a UI-minted agent key into FLEET_AGENT_KEYS on the Vercel project and
 * redeploy production so it takes effect. Only keys minted by THIS instance
 * (present in db/agent-sessions.json) can be promoted.
 */
export async function promoteSessionToEnv(
  key: string,
): Promise<{ ok: boolean; updated?: boolean; redeployUid?: string; error?: string }> {
  if (!key.startsWith("flk_")) return { ok: false, error: "not an agent key" };

  const { readSessions, sessionMatchesKey } = await import("./agent-vault");
  const sessions = await readSessions();
  // H5: the vault stores only key hashes — match by hash, never plaintext
  const minted = sessions.find((s) => !s.revoked && sessionMatchesKey(s, key));
  if (!minted) {
    return { ok: false, error: "key is not an active minted link on this instance" };
  }

  const { splitKeyEntries } = await import("./agent-vault");
  const current = splitKeyEntries(process.env.FLEET_AGENT_KEYS ?? "");
  if (current.length === 0) {
    // Only the DEPLOYED instance can see the real FLEET_AGENT_KEYS value.
    // A local instance reading "" must NOT upsert — it would wipe the
    // production env keys down to just the new key.
    return {
      ok: false,
      error:
        "this instance can't see the deployment's env keys — open fleet.abdelhadygabriel.me and promote from there",
    };
  }
  // entries may carry a scope suffix (`flk_…:github:read,…`) — compare on the
  // key part only so an already-promoted scoped entry is detected either way
  const existingKeyParts = current.map((e) => (e.indexOf(":") === -1 ? e : e.slice(0, e.indexOf(":"))));
  if (existingKeyParts.includes(key)) {
    return { ok: true, updated: false, error: "key is already permanent" };
  }

  // Fine-grained by default: the promoted entry carries the scopes the link
  // was minted with, instead of silently becoming all-powerful.
  const entry =
    minted.scopes.length > 0 ? `${key}:${minted.scopes.join(",")}` : key;
  // "|" separates entries — a scoped entry's scope spec uses "," internally,
  // so the merged value must not be comma-joined
  const merged = [...current, entry].join("|");

  const envRes = await vercelApi<{ created?: unknown }>(
    `/v10/projects/${encodeURIComponent(project())}/env?upsert=true`,
    "POST",
    {
      key: "FLEET_AGENT_KEYS",
      value: merged,
      type: "encrypted",
      target: ["production", "preview", "development"],
    },
  );
  if (envRes.status !== 200 && envRes.status !== 201) {
    return { ok: false, error: envRes.error ?? `env upsert failed (${envRes.status})` };
  }

  const dep = await redeployProduction();
  if (!dep.ok) return { ok: false, error: `env updated but redeploy failed: ${dep.error}` };
  return { ok: true, updated: true, redeployUid: dep.uid };
}
