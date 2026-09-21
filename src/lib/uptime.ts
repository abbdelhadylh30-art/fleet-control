import { mutateState, readState } from "@/lib/pg-state";

const KEY = "uptime-log";
const ROLLUP_KEY = "uptime-rollups";
const MAX_PER_HOST = 60;
const ROLLUP_DAYS = 30;
export const UPTIME_WINDOW = 12; // bars shown per site card

export interface UptimeSample {
  t: number; // epoch ms of the check
  ok: boolean; // homepage returned 200
  score: number; // SEO score observed at check time
}

export type UptimeStore = Record<string, UptimeSample[]>;

// ─── daily rollups (2026-09-21 H3 fix) ────────────────────────────────────────
// Fresh checks fire every ~15–60s, so the raw sample list only ever covers the
// last 15–60 minutes — "100% uptime" computed over it was a marketing number,
// not an SLA metric. Every sample now ALSO increments a per-host daily bucket
// (kept for ROLLUP_DAYS), and uptime percentages are computed over those
// rollups. The raw list stays for the per-site "recent checks" strip and
// incident reconciliation; the rollups are the honest metric.

export interface UptimeDayRollup {
  d: string; // YYYY-MM-DD (UTC) the samples belong to
  n: number; // checks that day
  up: number; // checks that passed that day
}

export type UptimeRollups = Record<string, UptimeDayRollup[]>;

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function rollupIsRecent(r: UptimeDayRollup, now: number): boolean {
  const ageDays = (now - Date.parse(`${r.d}T00:00:00Z`)) / 86_400_000;
  return ageDays <= ROLLUP_DAYS;
}

/** Derive daily buckets from raw samples (one-time migration backfill). */
function backfillRollups(samples: UptimeSample[] | undefined, now: number): UptimeDayRollup[] {
  const out: UptimeDayRollup[] = [];
  for (const s of samples ?? []) {
    if (!Number.isFinite(s.t) || s.t > now) continue;
    const d = dayKey(s.t);
    const last = out[out.length - 1];
    if (last && last.d === d) {
      last.n += 1;
      if (s.ok) last.up += 1;
    } else {
      out.push({ d, n: 1, up: s.ok ? 1 : 0 });
    }
  }
  return out.filter((r) => rollupIsRecent(r, now));
}

export async function readUptime(): Promise<UptimeStore> {
  const parsed = await readState<UptimeStore>(KEY);
  return parsed && typeof parsed === "object" ? parsed : {};
}

export async function readUptimeRollups(): Promise<UptimeRollups> {
  const parsed = await readState<UptimeRollups>(ROLLUP_KEY);
  return parsed && typeof parsed === "object" ? parsed : {};
}

export async function recordUptime(
  samples: Array<{ host: string; ok: boolean; score: number }>,
): Promise<void> {
  if (samples.length === 0) return;
  // Atomic append under optimistic-CAS — concurrent checks (public GET +
  // heartbeat + force) can no longer drop each other's samples (H1).
  const raw = await mutateState<UptimeStore>(KEY, (cur) => {
    const store: UptimeStore = cur && typeof cur === "object" ? cur : {};
    const now = Date.now();
    for (const s of samples) {
      const list = store[s.host] ?? [];
      list.push({ t: now, ok: s.ok, score: s.score });
      store[s.host] = list.slice(-MAX_PER_HOST);
    }
    return store;
  });
  // Same-check rollup increment (own row, own CAS). Hosts with no rollup
  // history yet get backfilled from their raw samples first (once).
  await mutateState<UptimeRollups>(ROLLUP_KEY, (cur) => {
    const store: UptimeRollups = cur && typeof cur === "object" ? cur : {};
    const now = Date.now();
    for (const s of samples) {
      let list = store[s.host];
      if (!list || list.length === 0) {
        list = backfillRollups(raw?.[s.host], now);
      }
      const d = dayKey(now);
      const last = list[list.length - 1];
      if (last && last.d === d) {
        last.n += 1;
        if (s.ok) last.up += 1;
      } else {
        list.push({ d, n: 1, up: s.ok ? 1 : 0 });
      }
      store[s.host] = list.filter((r) => rollupIsRecent(r, now));
    }
    return store;
  });
}

/** Honest percentage over the retained rollup window; null when only raw
 * samples exist (fresh install) so callers can fall back. */
export function rollupPct(
  list: UptimeDayRollup[] | undefined,
): { pct: number; checked: number; up: number; windowDays: number } | null {
  if (!list || list.length === 0) return null;
  const checked = list.reduce((a, r) => a + r.n, 0);
  const up = list.reduce((a, r) => a + r.up, 0);
  if (checked === 0) return null;
  const first = Date.parse(`${list[0].d}T00:00:00Z`);
  const last = Date.parse(`${list[list.length - 1].d}T00:00:00Z`);
  const windowDays = Math.max(1, Math.round((last - first) / 86_400_000) + 1);
  return {
    pct: Math.round((up / checked) * 1000) / 10,
    checked,
    up,
    windowDays,
  };
}

export interface SiteUptime {
  checked: number;
  up: number;
  pct: number; // 0–100 over stored history
  windowDays?: number; // days the pct actually covers (rollups only)
  recent: boolean[]; // last UPTIME_WINDOW samples (oldest → newest)
  recentScores: number[]; // SEO score per sample, last UPTIME_WINDOW (oldest → newest)
  scoreTrend: {
    first: number | null; // SEO score at the oldest stored sample
    current: number | null; // SEO score at the latest sample
    delta: number; // current − first (0 when insufficient data)
  };
}

export function uptimeStats(
  samples: UptimeSample[] | undefined,
  rollups?: UptimeDayRollup[],
): SiteUptime {
  const list = samples ?? [];
  const up = list.filter((s) => s.ok).length;
  const first = list.length > 0 ? list[0].score : null;
  const current = list.length > 0 ? list[list.length - 1].score : null;
  // H3: when rollups exist, checked/up/pct cover the full retained window
  // (up to 30 days); raw samples only cover the last 15–60 minutes.
  const rolled = rollupPct(rollups);
  return {
    checked: rolled ? rolled.checked : list.length,
    up: rolled ? rolled.up : up,
    pct: rolled ? rolled.pct : list.length ? Math.round((up / list.length) * 1000) / 10 : 100,
    windowDays: rolled ? rolled.windowDays : undefined,
    recent: list.slice(-UPTIME_WINDOW).map((s) => s.ok),
    recentScores: list.slice(-UPTIME_WINDOW).map((s) => s.score),
    scoreTrend: {
      first,
      current,
      delta: first !== null && current !== null ? current - first : 0,
    },
  };
}
