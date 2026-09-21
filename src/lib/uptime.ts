import { mutateState, readState } from "@/lib/pg-state";

const KEY = "uptime-log";
const MAX_PER_HOST = 60;
export const UPTIME_WINDOW = 12; // bars shown per site card

export interface UptimeSample {
  t: number; // epoch ms of the check
  ok: boolean; // homepage returned 200
  score: number; // SEO score observed at check time
}

export type UptimeStore = Record<string, UptimeSample[]>;

export interface SiteUptime {
  checked: number;
  up: number;
  pct: number; // 0–100 over stored history
  recent: boolean[]; // last UPTIME_WINDOW samples (oldest → newest)
  recentScores: number[]; // SEO score per sample, last UPTIME_WINDOW (oldest → newest)
  scoreTrend: {
    first: number | null; // SEO score at the oldest stored sample
    current: number | null; // SEO score at the latest sample
    delta: number; // current − first (0 when insufficient data)
  };
}

export async function readUptime(): Promise<UptimeStore> {
  const parsed = await readState<UptimeStore>(KEY);
  return parsed && typeof parsed === "object" ? parsed : {};
}

export async function recordUptime(
  samples: Array<{ host: string; ok: boolean; score: number }>,
): Promise<void> {
  if (samples.length === 0) return;
  // Atomic append under optimistic-CAS — concurrent checks (public GET +
  // heartbeat + force) can no longer drop each other's samples (H1).
  await mutateState<UptimeStore>(KEY, (cur) => {
    const store: UptimeStore = cur && typeof cur === "object" ? cur : {};
    const now = Date.now();
    for (const s of samples) {
      const list = store[s.host] ?? [];
      list.push({ t: now, ok: s.ok, score: s.score });
      store[s.host] = list.slice(-MAX_PER_HOST);
    }
    return store;
  });
}

export function uptimeStats(samples: UptimeSample[] | undefined): SiteUptime {
  const list = samples ?? [];
  const up = list.filter((s) => s.ok).length;
  const first = list.length > 0 ? list[0].score : null;
  const current = list.length > 0 ? list[list.length - 1].score : null;
  return {
    checked: list.length,
    up,
    pct: list.length ? Math.round((up / list.length) * 1000) / 10 : 100,
    recent: list.slice(-UPTIME_WINDOW).map((s) => s.ok),
    recentScores: list.slice(-UPTIME_WINDOW).map((s) => s.score),
    scoreTrend: {
      first,
      current,
      delta: first !== null && current !== null ? current - first : 0,
    },
  };
}
