// ─── Deploy-triggered auto-resubmission — the missing half of self-driving ────
//
// auto-submit.ts handles the TIME trigger (armed + 6h cooldown). This module
// handles the EVENT trigger: the moment a fleet site ships a NEW production
// deployment, its changed content goes right back into the indexing pipeline:
//   • IndexNow (Bing/Yandex/Seznam — instant)
//   • Google Search Console sitemap re-PUT (when the connect-once auth exists)
// Failed/canceled production deploys for fleet projects fire a "deploy-failed"
// alert through the new alert channels.
//
// State (pg-state):
//   deploy-watch       { lastRun, seen: Record<deploymentUid, createdAtMs> }
//   deploy-resubmit-log  newest-first, cap 40
//
// Anti-thrash guards:
//   • min 90s between runs (in-memory + durable lastRun)
//   • first ever run seeds `seen` WITHOUT submitting (no history replay burst)
//   • only deployments created in the last 6h are actionable
//   • max 3 sites per run (a burst of deploys degrades to the next run)

import { mutateState, readState } from "@/lib/pg-state";
import { FLEET, INDEXNOW_KEY } from "@/lib/fleet";
import { collectUrls } from "@/lib/auto-submit";
import { gscSubmitSitemaps } from "@/lib/gsc";
import { getStoredAccessToken } from "@/lib/gsc-auth";
import { sendAlert } from "@/lib/alerts";

const WATCH_KEY = "deploy-watch";
const LOG_KEY = "deploy-resubmit-log";
const MAX_LOG = 40;
const MAX_SEEN = 40;
const MIN_RUN_INTERVAL_MS = 90_000;
const DEPLOY_FRESH_MS = 6 * 3600_000;
const MAX_SITES_PER_RUN = 3;

export interface ResubmitEntry {
  t: string;
  host: string;
  project: string;
  deployment: string;
  commitSha: string | null;
  indexNow: { ok: boolean; status: number | null; urls: number; reason?: string };
  gsc: { ok: boolean; status: number | null; reason?: string } | null; // null = no GSC connection
}

interface WatchState {
  lastRun: string | null;
  seen: Record<string, number>;
}

interface DeployRow {
  uid?: string;
  name?: string;
  state?: string;
  readyState?: string;
  createdAt?: number;
  url?: string;
  meta?: { githubCommitSha?: string };
}

/** fleet project name → host. FLEET.repo is the primary map; vercel-ops has
 *  the two healed overrides (leads → lead-profiler-deploy, dev → abdelhady-gabriel). */
function projectToHost(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const def of FLEET) map[def.repo] = def.host;
  // domains re-attached to dedicated deploy projects (vercel-ops EXPECTED_PROJECTS)
  map["lead-profiler-deploy"] = "leads.abdelhadygabriel.me";
  map["abdelhady-gabriel"] = "dev.abdelhadygabriel.me";
  return map;
}

async function fetchProdDeployments(): Promise<DeployRow[]> {
  const { vercelFetch } = await import("./agent-vault");
  const res = await vercelFetch("/v6/deployments?limit=12&target=production", "GET", null);
  if (res.status !== 200 || !res.data) return [];
  return ((res.data as { deployments?: DeployRow[] }).deployments ?? []).filter(
    (d) => d.uid && d.name,
  );
}

async function indexNowSubmit(host: string): Promise<ResubmitEntry["indexNow"]> {
  try {
    const urlList = await collectUrls(host);
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `https://${host}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
    });
    const ok = res.status === 200 || res.status === 202;
    return {
      ok,
      status: res.status,
      urls: urlList.length,
      reason: ok ? "deploy trigger" : `IndexNow responded ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      urls: 0,
      reason: e instanceof Error ? e.message : "IndexNow submit failed",
    };
  }
}

async function gscResubmit(host: string): Promise<ResubmitEntry["gsc"]> {
  try {
    const token = await getStoredAccessToken();
    if (!token) return null;
    const result = await gscSubmitSitemaps(token, [`https://${host}/sitemap.xml`]);
    const first = result.results?.[0];
    return {
      ok: Boolean(first?.ok),
      status: first?.http ?? result.status ?? null,
      reason: first?.ok ? "sitemap re-PUT" : (first?.reason ?? result.error ?? "GSC submit failed"),
    };
  } catch (e) {
    return { ok: false, status: null, reason: e instanceof Error ? e.message : "GSC submit failed" };
  }
}

/** Run one watch pass. Returns the entries produced this run (may be empty).
 *  force=true skips the 90s throttle (manual "run now" button). */
export async function runDeployWatch(force = false): Promise<{
  ran: boolean;
  reason?: string;
  entries: ResubmitEntry[];
}> {
  const state = await readState<WatchState>(WATCH_KEY).then(
    (s) =>
      s && typeof s === "object" && s.seen && typeof s.seen === "object"
        ? { lastRun: (s as WatchState).lastRun ?? null, seen: { ...(s as WatchState).seen } }
        : { lastRun: null, seen: {} as Record<string, number> },
  );

  // throttle — the durable lastRun gates cross-cold-start bursts too
  if (!force && state.lastRun && Date.now() - new Date(state.lastRun).getTime() < MIN_RUN_INTERVAL_MS) {
    return { ran: false, reason: "throttled", entries: [] };
  }

  const deploys = await fetchProdDeployments();
  if (deploys.length === 0) {
    await mutateState<WatchState>(WATCH_KEY, () => ({ lastRun: new Date().toISOString(), seen: state.seen }));
    return { ran: false, reason: "no deployments visible (vault disconnected?)", entries: [] };
  }

  const p2h = projectToHost();
  const now = Date.now();
  const entries: ResubmitEntry[] = [];

  // first-ever run: seed the seen map, submit nothing
  if (Object.keys(state.seen).length === 0) {
    const seed: Record<string, number> = {};
    for (const d of deploys) if (d.uid) seed[d.uid] = d.createdAt ?? now;
    await mutateState<WatchState>(WATCH_KEY, () => ({ lastRun: new Date().toISOString(), seen: seed }));
    return { ran: true, reason: "seeded first run (no resubmission on history)", entries: [] };
  }

  const fresh = deploys
    .filter((d) => d.uid && !state.seen[d.uid] && (d.createdAt ?? 0) > now - DEPLOY_FRESH_MS)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  // track seen for ALL deployments (not just fleet ones) so the map stays truthful
  for (const d of deploys) {
    if (d.uid) state.seen[d.uid] = d.createdAt ?? now;
  }

  let sitesThisRun = 0;
  for (const d of fresh) {
    const host = p2h[d.name ?? ""] ?? null;
    if (!host) continue;

    // failed / canceled production deploys for fleet projects → alert
    if (d.readyState && d.readyState !== "READY") {
      if (d.readyState === "ERROR" || d.readyState === "CANCELED") {
        void sendAlert(
          "deploy-failed",
          `🚨 <b>Production deploy failed</b> — ${d.name} (${host}) ended as ${d.readyState}. Indexing pipeline skipped for this release.`,
        );
      }
      continue;
    }

    if (sitesThisRun >= MAX_SITES_PER_RUN) continue;
    sitesThisRun += 1;

    const [indexNow, gsc] = await Promise.all([indexNowSubmit(host), gscResubmit(host)]);
    entries.push({
      t: new Date().toISOString(),
      host,
      project: d.name ?? "?",
      deployment: d.uid ?? "?",
      commitSha: d.meta?.githubCommitSha?.slice(0, 7) ?? null,
      indexNow,
      gsc,
    });
  }

  // bound the seen map (newest wins)
  const seenEntries = Object.entries(state.seen)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SEEN);
  const boundedSeen = Object.fromEntries(seenEntries);

  await mutateState<WatchState>(WATCH_KEY, () => ({
    lastRun: new Date().toISOString(),
    seen: boundedSeen,
  }));
  if (entries.length > 0) {
    await mutateState<ResubmitEntry[]>(LOG_KEY, (cur) =>
      [...entries, ...(Array.isArray(cur) ? cur : [])].slice(0, MAX_LOG),
    );
  }

  return { ran: true, entries };
}

export async function readResubmitLog(limit = 15): Promise<ResubmitEntry[]> {
  const list = await readState<ResubmitEntry[]>(LOG_KEY);
  return (Array.isArray(list) ? list : []).slice(0, limit);
}

export async function readWatchState(): Promise<{ lastRun: string | null; seenCount: number }> {
  const s = await readState<WatchState>(WATCH_KEY);
  return {
    lastRun: s?.lastRun ?? null,
    seenCount: s?.seen && typeof s.seen === "object" ? Object.keys(s.seen).length : 0,
  };
}
