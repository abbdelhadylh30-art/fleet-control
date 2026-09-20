import { readState, writeState } from "@/lib/pg-state";
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
 */
export async function updateIncidents(
  prevStates: Record<string, boolean | undefined>,
  results: Array<{ host: string; ok: boolean }>,
): Promise<IncidentView> {
  const all = await readIncidents();
  const now = new Date().toISOString();

  for (const { host, ok } of results) {
    const prev = prevStates[host];
    const openIdx = all.findIndex((i) => i.host === host && i.recoveredAt === null);
    if (prev === undefined) continue; // first sample — nothing to compare
    if (prev && !ok) {
      if (openIdx >= 0) all[openIdx].checks += 1;
      else all.push({ host, startedAt: now, recoveredAt: null, checks: 1 });
    } else if (!prev && ok && openIdx >= 0) {
      all[openIdx].recoveredAt = now;
    }
  }

  // Postgres (durable) with file fallback — incident history survives cold starts
  await writeState(KEY, all.slice(-MAX_KEPT));

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
