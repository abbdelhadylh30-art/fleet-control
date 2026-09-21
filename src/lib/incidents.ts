import { mutateState, readState } from "@/lib/pg-state";
import { readUptime } from "@/lib/uptime";

const KEY = "incidents";
const MAX_KEPT = 50;

export interface Incident {
  host: string;
  startedAt: string; // ISO — first failed check
  recoveredAt: string | null; // ISO — first OK check after the failure
  checks: number; // consecutive failed checks observed
}

export interface IncidentView {
  active: Incident[];
  recent: Incident[]; // resolved, newest first (cap 10)
}

export async function readIncidents(): Promise<Incident[]> {
  const parsed = await readState<Incident[]>(KEY);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Reconcile incidents against a fresh round of health results.
 * prevStates: {host: ok} snapshot from BEFORE the new samples were recorded.
 * Rules:
 *  - ok flip true→false  → open incident (or extend existing open one)
 *  - ok flip false→true  → close open incident (recoveredAt)
 *  - still down + open   → increment checks
 *
 * The whole reconcile runs inside mutateState's optimistic-CAS write, so
 * concurrent checks (public GET + heartbeat autopilot + force re-check)
 * can no longer clobber each other's incident updates (H1, 2026-09-21).
 */
export async function updateIncidents(
  prevStates: Record<string, boolean | undefined>,
  results: Array<{ host: string; ok: boolean }>,
): Promise<IncidentView> {
  const now = new Date().toISOString();

  const all = (await mutateState<Incident[]>(KEY, (cur) => {
    const list = Array.isArray(cur) ? cur.map((i) => ({ ...i })) : [];
    for (const { host, ok } of results) {
      const prev = prevStates[host];
      const openIdx = list.findIndex((i) => i.host === host && i.recoveredAt === null);
      if (prev === undefined) continue; // first sample — nothing to compare
      if (prev && !ok) {
        if (openIdx >= 0) list[openIdx] = { ...list[openIdx], checks: list[openIdx].checks + 1 };
        else list.push({ host, startedAt: now, recoveredAt: null, checks: 1 });
      } else if (!prev && ok && openIdx >= 0) {
        list[openIdx] = { ...list[openIdx], recoveredAt: now };
      }
    }
    return list.slice(-MAX_KEPT);
  })) ?? [];

  return {
    active: all.filter((i) => i.recoveredAt === null),
    recent: all
      .filter((i) => i.recoveredAt !== null)
      .slice(-10)
      .reverse(),
  };
}

export async function buildPrevStates(): Promise<Record<string, boolean | undefined>> {
  try {
    const store = await readUptime();
    const out: Record<string, boolean | undefined> = {};
    for (const [host, samples] of Object.entries(store)) {
      out[host] = samples.at(-1)?.ok;
    }
    return out;
  } catch {
    return {};
  }
}
