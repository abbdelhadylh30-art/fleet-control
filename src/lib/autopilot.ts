// ─── Auto-pilot — the fleet repairs itself ───────────────────────────────────
// Two self-healing moves fire automatically on every fresh /api/fleet check:
//
//   1. AUTO-REATTACH — a fleet domain served by a STALE project (leads./dev.)
//      is moved to the correct git-linked project (guarded to the known map).
//   2. AUTO-REDEPLOY — a DOWN site whose domain assignment is correct gets a
//      fresh production deployment from its GitHub repo (main).
//
// STATELESS COOLDOWN GUARD (works across serverless instances): never redeploy
// while the project's latest deployment is still building, or when that
// deployment is younger than 3h — so even a fleet of cold lambdas can never
// loop-redeploy a site. Config + action log persist best-effort at
// db/autopilot*.json (local) — on serverless the defaults apply (auto-heal ON)
// and the guard above keeps behaviour safe regardless.

import { GITHUB_OWNER } from "@/lib/fleet";
import { readState, writeState } from "@/lib/pg-state";

const MAX_LOG = 80;
const COOLDOWN_MS = 3 * 60 * 60 * 1000; // one heal attempt per project per 3h
const FLEET_SUFFIX = ".abdelhadygabriel.me";
const APEX = "abdelhadygabriel.me";

export interface AutoPilotConfig {
  autoHeal: boolean; // master switch — auto-reattach + auto-redeploy
}

const DEFAULT_CONFIG: AutoPilotConfig = { autoHeal: true };

export interface AutoPilotAction {
  ts?: string; // stamped when written to the log
  host: string;
  project: string | null;
  status: "reattached" | "redeployed" | "skipped" | "error";
  detail: string;
  uid?: string;
}

export async function readAutoPilotConfig(): Promise<AutoPilotConfig> {
  try {
    const parsed = await readState<Partial<AutoPilotConfig>>("autopilot");
    return { autoHeal: parsed?.autoHeal !== false };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeAutoPilotConfig(cfg: AutoPilotConfig): Promise<void> {
  // Postgres (durable) with file fallback — the switch now survives cold starts
  await writeState("autopilot", cfg);
}

export async function readAutoPilotLog(): Promise<AutoPilotAction[]> {
  const parsed = await readState<AutoPilotAction[]>("autopilot-log");
  return Array.isArray(parsed) ? parsed : [];
}

async function appendAutoPilotLog(entries: AutoPilotAction[]): Promise<void> {
  if (entries.length === 0) return;
  const stamped = entries.map((e) => ({ ...e, ts: new Date().toISOString() }));
  const all = [...stamped, ...(await readAutoPilotLog())].slice(0, MAX_LOG);
  await writeState("autopilot-log", all);
}

// ─── host → serving Vercel project (5-min module cache) ─────────────────────

let projMapCache: { at: number; map: Record<string, string> } | null = null;
const PROJ_MAP_TTL = 5 * 60_000;

function isFleetDomain(d: string): boolean {
  return d === APEX || d.endsWith(FLEET_SUFFIX);
}

export async function hostProjectMap(): Promise<Record<string, string>> {
  if (projMapCache && Date.now() - projMapCache.at < PROJ_MAP_TTL) {
    return projMapCache.map;
  }
  const { vercelFetch } = await import("./agent-vault");
  const res = await vercelFetch("/v9/projects?limit=100", "GET", undefined);
  if (res.status !== 200 || !res.data) return {};
  const projects = ((res.data as { projects?: Array<{ name?: string }> }).projects ?? [])
    .map((p) => String(p.name ?? ""))
    .filter(Boolean);
  const map: Record<string, string> = {};
  await Promise.all(
    projects.map(async (name) => {
      const dres = await vercelFetch(
        `/v9/projects/${encodeURIComponent(name)}/domains?limit=100`,
        "GET",
        undefined,
      );
      if (dres.status === 200 && dres.data) {
        const list = ((dres.data as { domains?: Array<{ name?: string }> }).domains ?? [])
          .map((d) => String(d.name ?? ""))
          .filter(isFleetDomain);
        for (const d of list) map[d] = name;
      }
    }),
  );
  projMapCache = { at: Date.now(), map };
  return map;
}

// ─── the heal loop ───────────────────────────────────────────────────────────

const BUILDING_STATES = new Set(["BUILDING", "QUEUED", "INITIALIZING"]);

interface LatestDeploy {
  uid?: string;
  readyState?: string;
  createdAt?: number;
}

async function latestDeployment(project: string): Promise<LatestDeploy | null> {
  const { vercelFetch } = await import("./agent-vault");
  const res = await vercelFetch(
    `/v6/deployments?app=${encodeURIComponent(project)}&limit=1`,
    "GET",
    undefined,
  );
  if (res.status !== 200 || !res.data) return null;
  const d = (res.data as { deployments?: LatestDeploy[] }).deployments?.[0];
  return d ?? null;
}

export interface AutoHealResult {
  enabled: boolean;
  actions: AutoPilotAction[];
}

/**
 * Fire the self-healing moves for the fleet. Called from the fresh
 * /api/fleet check — every guard is designed so repeated calls (many warm
 * lambdas, the 15-min operator cron) converge instead of amplifying.
 *
 * Per site:
 *   - healthy + correctly assigned  → nothing to do (no log noise)
 *   - stale domain assignment       → auto-reattach to the expected project
 *                                     (fires even while UP — the known
 *                                     blockers serve the WRONG content, not 5xx)
 *   - down                          → guarded auto-redeploy from git
 */
export async function runAutoHeal(
  sites: Array<{ host: string; repo: string; blocker?: string; ok: boolean }>,
): Promise<AutoHealResult> {
  const cfg = await readAutoPilotConfig();
  if (!cfg.autoHeal) return { enabled: false, actions: [] };

  const { vercelFetch, githubFetch } = await import("./agent-vault");
  const { reattachVercelDomain, vercelStatus, EXPECTED_PROJECTS } = await import(
    "./vercel-ops"
  );

  const status = await vercelStatus();
  if (!status.connected) return { enabled: true, actions: [] };

  const map = await hostProjectMap();
  const actions: AutoPilotAction[] = [];

  for (const site of sites) {
    const serving = map[site.host] ?? null;
    const expected = EXPECTED_PROJECTS[site.host];
    const stale = !!expected && !!serving && serving !== expected;
    if (site.ok && !stale) continue; // healthy and correctly assigned
    try {
      // 1) stale domain assignment → auto-reattach to the expected project
      //    (runs whether the site is up or down — wrong content is a defect)
      if (stale) {
        const moved = await reattachVercelDomain(site.host, expected);
        // alreadyCorrect = the direct probe found the domain on the expected
        // project — the fleet-wide map was flaky, nothing actually moved
        actions.push({
          host: site.host,
          project: expected,
          status: moved.ok ? (moved.alreadyCorrect ? "skipped" : "reattached") : "error",
          detail: moved.ok
            ? moved.alreadyCorrect
              ? `verified already attached to “${expected}” (fleet map was stale)`
              : `domain moved from “${serving}” to “${expected}”`
            : (moved.error ?? "reattach failed"),
        });
        continue;
      }

      // 2) down site with a correct/known project → auto-redeploy from git
      const project = serving ?? expected ?? null;
      if (!project) {
        actions.push({
          host: site.host,
          project: null,
          status: "skipped",
          detail: "no Vercel project serves this domain — connect repo/domain first",
        });
        continue;
      }
      if (site.blocker?.includes("not git-linked")) {
        actions.push({
          host: site.host,
          project,
          status: "skipped",
          detail: "repo is not git-linked to the project — needs a manual connect",
        });
        continue;
      }

      const dep = await latestDeployment(project);
      if (dep?.readyState && BUILDING_STATES.has(dep.readyState)) {
        actions.push({
          host: site.host,
          project,
          status: "skipped",
          detail: `deployment ${dep.uid?.slice(0, 8) ?? ""} is already ${dep.readyState.toLowerCase()} — giving it time`,
        });
        continue;
      }
      if (dep?.createdAt && Date.now() - dep.createdAt < COOLDOWN_MS) {
        const mins = Math.round((Date.now() - dep.createdAt) / 60000);
        actions.push({
          host: site.host,
          project,
          status: "skipped",
          detail: `last deployment ${mins}m ago — inside the 3h cooldown`,
        });
        continue;
      }

      const repoRes = await githubFetch(
        `/repos/${GITHUB_OWNER}/${site.repo}`,
        "GET",
        undefined,
      );
      const repoId =
        repoRes.status === 200 && repoRes.data && typeof repoRes.data === "object"
          ? (repoRes.data as { id?: number }).id
          : undefined;
      if (!repoId) {
        actions.push({
          host: site.host,
          project,
          status: "error",
          detail: "could not resolve repoId — is GitHub connected in the vault?",
        });
        continue;
      }

      const created = await vercelFetch("/v13/deployments", "POST", {
        name: project,
        target: "production",
        gitSource: { type: "github", repoId, ref: "main" },
      });
      const uid =
        created.status === 200 && created.data && typeof created.data === "object"
          ? (String(
              (created.data as { uid?: string }).uid ??
                (created.data as { id?: string }).id ??
                "",
            ) || undefined)
          : undefined;
      actions.push({
        host: site.host,
        project,
        status: created.status === 200 ? "redeployed" : "error",
        detail:
          created.status === 200
            ? `production redeploy triggered from ${site.repo}@main`
            : `Vercel API ${created.status} — ${(created.errorText ?? "").slice(0, 120)}`,
        ...(uid ? { uid } : {}),
      });
    } catch (e) {
      actions.push({
        host: site.host,
        project: serving,
        status: "error",
        detail: e instanceof Error ? e.message : "unknown auto-heal error",
      });
    }
  }

  // only notable outcomes enter the durable log (skips are recomputed live)
  const notable = actions.filter((a) => a.status !== "skipped");
  await appendAutoPilotLog(notable);
  return { enabled: true, actions };
}
