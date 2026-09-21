// ─── Fleet analytics — aggregate everything the fleet already records ────────
// Sources (all server-side): uptime-log.json, score-history.json,
// indexnow-log.json, incidents.json, autopilot log, live Vercel deployments
// and GitHub repo metadata via the vault. No secrets in the response.

import { FLEET, GITHUB_OWNER } from "@/lib/fleet";
import { readUptime, readUptimeRollups, rollupPct } from "@/lib/uptime";
import { readScoreHistory, type ScorePoint } from "@/lib/score-history";
import { readLog } from "@/lib/activity-log";
import { readIncidents } from "@/lib/incidents";
import {
  hostProjectMap,
  readAutoPilotConfig,
  readAutoPilotLog,
  type AutoPilotAction,
} from "@/lib/autopilot";
import { vercelStatus } from "@/lib/vercel-ops";

export interface HostUptimeStats {
  checked: number;
  up: number;
  pct: number; // 0–100 over the retained window
  windowDays?: number; // days the pct covers (rollups, H3)
  lastAt: number | null; // epoch ms of newest sample
  avgScore: number; // mean SEO score across samples
}

export interface DayBucket {
  date: string; // ISO day (UTC)
  label: string; // "Sep 20"
  urls: number; // URLs submitted that day (ok entries only)
  runs: number; // submission attempts that day
}

export interface ProjectDeployStats {
  project: string;
  count30d: number;
  last: { state: string; createdAt: number; sha: string | null } | null;
}

export interface DeploymentFeedItem {
  uid: string;
  project: string;
  state: string;
  createdAt: number;
  sha: string | null;
}

export interface RepoStats {
  language: string | null;
  pushedAt: string | null;
  isPrivate: boolean;
}

export interface IncidentStats {
  total: number;
  events7d: number;
  downtimeMin: number; // summed duration (resolved + ongoing)
  activeNow: number;
}

export interface AnalyticsResponse {
  generatedAt: string;
  vercelConnected: boolean;
  fleetUptimePct: number;
  scoreHistory: ScorePoint[];
  uptimeByHost: Record<string, HostUptimeStats>;
  submissions: {
    total: number;
    successRate: number; // 0–100
    autoCount: number;
    perDay: DayBucket[];
    byHost: Record<string, number>;
  };
  incidents: IncidentStats;
  deployments: {
    count7d: number;
    count30d: number;
    byProject: ProjectDeployStats[];
    recent: DeploymentFeedItem[];
  };
  repos: Record<string, RepoStats>;
  hostProject: Record<string, string>;
  autopilot: { config: { autoHeal: boolean }; log: AutoPilotAction[] };
}

const DAY = 24 * 60 * 60 * 1000;

function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

async function fetchRepoStats(): Promise<Record<string, RepoStats>> {
  const { githubFetch } = await import("./agent-vault");
  const res = await githubFetch(`/users/${GITHUB_OWNER}/repos?per_page=100`, "GET", undefined);
  if (res.status !== 200 || !res.data || !Array.isArray(res.data)) return {};
  const out: Record<string, RepoStats> = {};
  for (const r of res.data as Array<Record<string, unknown>>) {
    const name = String(r.name ?? "");
    if (!name) continue;
    out[name] = {
      language: (r.language as string) || null,
      pushedAt: (r.pushed_at as string) || null,
      isPrivate: Boolean(r.private),
    };
  }
  return out;
}

interface DeployShape {
  uid?: string;
  name?: string;
  readyState?: string;
  createdAt?: number;
  meta?: { githubCommitSha?: string };
}

async function fetchDeployments(): Promise<DeployShape[]> {
  const { vercelFetch } = await import("./agent-vault");
  const res = await vercelFetch("/v6/deployments?limit=100&target=production", "GET", undefined);
  if (res.status !== 200 || !res.data) return [];
  return (res.data as { deployments?: DeployShape[] }).deployments ?? [];
}

export async function buildAnalytics(): Promise<AnalyticsResponse> {
  const now = Date.now();
  const [uptimeStore, uptimeRollups, scoreHistory, log, incidentsAll, autopilotConfig, autopilotLog, vercel] =
    await Promise.all([
      readUptime(),
      readUptimeRollups(),
      readScoreHistory(),
      readLog(),
      readIncidents(),
      readAutoPilotConfig(),
      readAutoPilotLog(),
      vercelStatus(),
    ]);

  // ── uptime per host ──────────────────────────────────────────────────────
  // H3: checked/up/pct come from the daily rollups (up to 30d) when present;
  // raw samples (~1h) only act as the fallback and feed lastAt/avgScore.
  const uptimeByHost: Record<string, HostUptimeStats> = {};
  let totalSamples = 0;
  let totalUp = 0;
  const hosts = new Set([...Object.keys(uptimeStore), ...Object.keys(uptimeRollups)]);
  for (const host of hosts) {
    const samples = uptimeStore[host] ?? [];
    const rolled = rollupPct(uptimeRollups[host]);
    const checked = rolled ? rolled.checked : samples.length;
    const up = rolled ? rolled.up : samples.filter((s) => s.ok).length;
    totalSamples += checked;
    totalUp += up;
    uptimeByHost[host] = {
      checked,
      up,
      pct: checked ? Math.round((up / checked) * 1000) / 10 : 100,
      windowDays: rolled ? rolled.windowDays : undefined,
      lastAt: samples.length ? samples[samples.length - 1].t : null,
      avgScore: samples.length
        ? Math.round(samples.reduce((a, s) => a + s.score, 0) / samples.length)
        : 0,
    };
  }
  const fleetUptimePct = totalSamples
    ? Math.round((totalUp / totalSamples) * 1000) / 10
    : 100;

  // ── submissions ──────────────────────────────────────────────────────────
  const perDay: DayBucket[] = [];
  const byHost: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const dayStartMs = Date.parse(dayKey(now - i * DAY)); // midnight UTC of that day
    const dayEntries = log.filter((e) => {
      const t = new Date(e.ts).getTime();
      return t >= dayStartMs && t < dayStartMs + DAY;
    });
    const dayStart = new Date(dayStartMs);
    perDay.push({
      date: dayKey(dayStartMs),
      label: dayStart.toLocaleDateString("en", { month: "short", day: "numeric" }),
      urls: dayEntries.filter((e) => e.ok).reduce((s, e) => s + e.urls, 0),
      runs: dayEntries.length,
    });
  }
  for (const e of log) {
    if (!e.ok) continue;
    byHost[e.host] = (byHost[e.host] ?? 0) + e.urls;
  }
  const okEntries = log.filter((e) => e.ok).length;

  // ── incidents ────────────────────────────────────────────────────────────
  const downtimeMin = incidentsAll.reduce((sum, i) => {
    const start = new Date(i.startedAt).getTime();
    const end = i.recoveredAt ? new Date(i.recoveredAt).getTime() : now;
    return sum + Math.max(0, end - start);
  }, 0);
  const incidentStats: IncidentStats = {
    total: incidentsAll.length,
    events7d: incidentsAll.filter(
      (i) => now - new Date(i.startedAt).getTime() < 7 * DAY,
    ).length,
    downtimeMin: Math.round(downtimeMin / 60000),
    activeNow: incidentsAll.filter((i) => !i.recoveredAt).length,
  };

  // ── deployments + repos (live, only when connected) ─────────────────────
  let deployList: DeployShape[] = [];
  let repos: Record<string, RepoStats> = {};
  if (vercel.connected) {
    [deployList, repos] = await Promise.all([fetchDeployments(), fetchRepoStats()]);
  }

  const recent7 = deployList.filter((d) => (d.createdAt ?? 0) > now - 7 * DAY);
  const recent30 = deployList.filter((d) => (d.createdAt ?? 0) > now - 30 * DAY);

  const perProject = new Map<string, DeployShape[]>();
  for (const d of deployList) {
    const p = String(d.name ?? "unknown");
    const list = perProject.get(p) ?? [];
    list.push(d);
    perProject.set(p, list);
  }
  const byProject: ProjectDeployStats[] = [...perProject.entries()]
    .map(([project, list]) => ({
      project,
      count30d: list.filter((d) => (d.createdAt ?? 0) > now - 30 * DAY).length,
      last: list[0]
        ? {
            state: String(list[0].readyState ?? "UNKNOWN"),
            createdAt: list[0].createdAt ?? 0,
            sha: list[0].meta?.githubCommitSha?.slice(0, 7) ?? null,
          }
        : null,
    }))
    .sort((a, b) => (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0));

  const recent: DeploymentFeedItem[] = deployList.slice(0, 8).map((d) => ({
    uid: String(d.uid ?? ""),
    project: String(d.name ?? "unknown"),
    state: String(d.readyState ?? "UNKNOWN"),
    createdAt: d.createdAt ?? 0,
    sha: d.meta?.githubCommitSha?.slice(0, 7) ?? null,
  }));

  // ── host → project join ──────────────────────────────────────────────────
  const hostProject = vercel.connected ? await hostProjectMap() : {};

  return {
    generatedAt: new Date().toISOString(),
    vercelConnected: vercel.connected,
    fleetUptimePct,
    scoreHistory,
    uptimeByHost,
    submissions: {
      total: log.filter((e) => e.ok).reduce((s, e) => s + e.urls, 0),
      successRate: log.length ? Math.round((okEntries / log.length) * 1000) / 10 : 100,
      autoCount: log.filter((e) => e.auto && e.ok).length,
      perDay,
      byHost,
    },
    incidents: incidentStats,
    deployments: {
      count7d: recent7.length,
      count30d: recent30.length,
      byProject,
      recent,
    },
    repos,
    hostProject,
    autopilot: {
      config: { autoHeal: autopilotConfig.autoHeal },
      log: autopilotLog.slice(0, 10),
    },
  };
}
