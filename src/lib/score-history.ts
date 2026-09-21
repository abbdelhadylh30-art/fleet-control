import { mutateState, readState } from "@/lib/pg-state";

const KEY = "score-history";
const ROLLUP_KEY = "score-rollups";
// H3 fix (2026-09-21): the old comment claimed "720 pts ≈ 7 days at 15-min
// cadence", but fresh checks fire every ~15–60s, so 720 raw points really
// covered 3–12 hours. Raw points are now bounded to a LIVE window (~6h) and
// the real history lives in hourly rollups kept for 30 days — the trend chart
// finally shows weeks, not one afternoon.
const MAX_RAW_POINTS = 700; // ~6h at a 30s cadence
const MAX_ROLLUP_HOURS = 24 * 30; // 30 days of hourly averages

export interface ScorePoint {
  t: number; // epoch ms of the fresh fleet check
  avg: number; // fleet-wide mean SEO score observed at check time
}

export interface ScoreHourRollup {
  h: number; // epoch ms of the hour bucket start (floor(t / 1h))
  avg: number; // running mean of the avg values observed in that hour
  n: number; // fresh checks in that hour
}

export async function readScoreHistory(): Promise<ScorePoint[]> {
  const parsed = await readState<ScorePoint[]>(KEY);
  return Array.isArray(parsed) ? parsed : [];
}

/** Hourly rollups — the real, week+ spanning trend behind the chart. */
export async function readScoreRollups(): Promise<ScoreHourRollup[]> {
  const parsed = await readState<ScoreHourRollup[]>(ROLLUP_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

function backfillRollups(points: ScorePoint[], now: number): ScoreHourRollup[] {
  const out: ScoreHourRollup[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.avg) || p.avg <= 0 || p.t > now) continue;
    const h = Math.floor(p.t / 3_600_000) * 3_600_000;
    const last = out[out.length - 1];
    if (last && last.h === h) {
      last.avg = (last.avg * last.n + p.avg) / (last.n + 1);
      last.n += 1;
    } else {
      out.push({ h, avg: p.avg, n: 1 });
    }
  }
  const cutoff = Math.floor(now / 3_600_000) * 3_600_000 - (MAX_ROLLUP_HOURS - 1) * 3_600_000;
  return out.filter((r) => r.h >= cutoff);
}

/**
 * Persist one fleet-average score sample (fresh checks only).
 * Guarded by the caller: a check where every host failed (sandbox network
 * hiccup) must NOT poison the trend with a fake avg of 0.
 */
export async function recordScoreAvg(avg: number): Promise<void> {
  if (!Number.isFinite(avg) || avg <= 0) return;
  // Atomic append under optimistic-CAS — concurrent checks can no longer drop
  // each other's samples (H1, 2026-09-21).
  // Postgres (durable) with file fallback — the trend finally survives cold starts
  const raw = await mutateState<ScorePoint[]>(KEY, (cur) => {
    const list = Array.isArray(cur) ? [...cur] : [];
    list.push({ t: Date.now(), avg });
    return list.slice(-MAX_RAW_POINTS);
  });
  // Same-sample hourly rollup (own row, own CAS). Empty rollup store gets
  // backfilled from the raw history first (one-time migration).
  await mutateState<ScoreHourRollup[]>(ROLLUP_KEY, (cur) => {
    const now = Date.now();
    let list = Array.isArray(cur) ? [...cur] : [];
    if (list.length === 0 && raw && raw.length > 0) {
      list = backfillRollups(raw, now);
    }
    const h = Math.floor(now / 3_600_000) * 3_600_000;
    const last = list[list.length - 1];
    if (last && last.h === h) {
      last.avg = (last.avg * last.n + avg) / (last.n + 1);
      last.n += 1;
    } else {
      list.push({ h, avg, n: 1 });
    }
    const cutoff = h - (MAX_ROLLUP_HOURS - 1) * 3_600_000;
    return list.filter((r) => r.h >= cutoff);
  });
}
