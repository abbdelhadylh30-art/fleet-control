import { readState, writeState } from "@/lib/pg-state";

const KEY = "score-history";
const MAX_POINTS = 720; // ~7 days of checks at 15-min cadence

export interface ScorePoint {
  t: number; // epoch ms of the fresh fleet check
  avg: number; // fleet-wide mean SEO score observed at check time
}

export async function readScoreHistory(): Promise<ScorePoint[]> {
  const parsed = await readState<ScorePoint[]>(KEY);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Persist one fleet-average score sample (fresh checks only).
 * Guarded by the caller: a check where every host failed (sandbox network
 * hiccup) must NOT poison the trend with a fake avg of 0.
 */
export async function recordScoreAvg(avg: number): Promise<void> {
  if (!Number.isFinite(avg) || avg <= 0) return;
  const list = await readScoreHistory();
  list.push({ t: Date.now(), avg });
  // Postgres (durable) with file fallback — the trend finally survives cold starts
  await writeState(KEY, list.slice(-MAX_POINTS));
}
