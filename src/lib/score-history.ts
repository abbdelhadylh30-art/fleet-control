import { promises as fs } from "fs";
import path from "path";

const HISTORY_PATH = path.join(process.cwd(), "db", "score-history.json");
const MAX_POINTS = 240; // ~4h of checks at 60s cadence; plenty for the trend line

export interface ScorePoint {
  t: number; // epoch ms of the fresh fleet check
  avg: number; // fleet-wide mean SEO score observed at check time
}

export async function readScoreHistory(): Promise<ScorePoint[]> {
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScorePoint[]) : [];
  } catch {
    return [];
  }
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
  const trimmed = list.slice(-MAX_POINTS);
  try {
    await fs.writeFile(HISTORY_PATH, JSON.stringify(trimmed), "utf8");
  } catch {
    /* non-fatal — trend is best-effort */
  }
}
