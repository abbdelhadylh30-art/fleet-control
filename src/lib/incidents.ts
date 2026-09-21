import { mutateState, readState } from "@/lib/pg-state";
import { readUptime } from "@/lib/uptime";
import { alertWebhook } from "@/lib/security";

const KEY = "incidents";
const MAX_KEPT = 50;

// M3 (2026-09-21) hysteresis: a single failed check no longer opens an
// incident and a single OK check no longer closes one — flapping hosts used
// to churn the incident history and spam recovery toasts.
const OPEN_THRESHOLD = 2; // consecutive failed samples before an incident is CONFIRMED
const CLOSE_THRESHOLD = 2; // consecutive OK samples before recovery is CONFIRMED

export interface Incident {
  host: string;
  startedAt: string; // ISO — first failed check (may predate confirmation)
  recoveredAt: string | null; // ISO — set only after CLOSE_THRESHOLD OK samples
  checks: number; // failed samples observed since startedAt (every fail counts)
  consecutiveFails: number; // consecutive failures right now
  consecutiveOks: number; // consecutive OK samples while open (for CLOSE_THRESHOLD)
  confirmed: boolean; // crossed OPEN_THRESHOLD — visible as an incident
  severity: "minor" | "major" | "extended" | null; // set at close; null while open
}

export interface IncidentView {
  active: Incident[]; // confirmed, still open
  recent: Incident[]; // confirmed + resolved, newest first (cap 10)
}

/** Severity from downtime duration: <15m minor · <2h major · ≥2h extended. */
export function severityFor(startedAt: string, endedAt: string): "minor" | "major" | "extended" {
  const mins = Math.max(0, (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000);
  if (mins < 15) return "minor";
  if (mins < 120) return "major";
  return "extended";
}

/** Normalize a stored record — pre-M3 rows lack the new counters. */
function normalizeIncident(i: Partial<Incident> & { host: string }): Incident {
  return {
    host: i.host,
    startedAt: i.startedAt ?? new Date().toISOString(),
    recoveredAt: i.recoveredAt ?? null,
    checks: typeof i.checks === "number" ? i.checks : 1,
    consecutiveFails:
      typeof i.consecutiveFails === "number"
        ? i.consecutiveFails
        : i.recoveredAt === null
          ? 1
          : 0,
    consecutiveOks: typeof i.consecutiveOks === "number" ? i.consecutiveOks : 0,
    // legacy active incidents were always visible → treat as confirmed
    confirmed: i.confirmed ?? true,
    severity: i.severity ?? null,
  };
}

export async function readIncidents(): Promise<Incident[]> {
  const parsed = await readState<Incident[]>(KEY);
  return Array.isArray(parsed) ? parsed.map(normalizeIncident) : [];
}

/**
 * Reconcile incidents against a fresh round of health results.
 * prevStates: {host: ok} snapshot from BEFORE the new samples were recorded.
 * Rules (M3, with hysteresis):
 *  - failed sample → create pending record (or extend: checks++, consecutiveFails++)
 *    · pending crosses OPEN_THRESHOLD → confirmed (alert fires)
 *  - OK sample on a PENDING (unconfirmed) record → drop it entirely (flap noise)
 *  - OK sample on a CONFIRMED open record → consecutiveOks++; recovers only
 *    after CLOSE_THRESHOLD consecutive OKs (severity stamped at close, alert)
 *  - a fail resets consecutiveOks — one blip doesn't close an ongoing incident
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
  const newlyConfirmed: string[] = [];
  const newlyRecovered: Array<{ host: string; severity: Incident["severity"] }> = [];

  const all = (await mutateState<Incident[]>(KEY, (cur) => {
    const list = (Array.isArray(cur) ? cur : []).map(normalizeIncident);
    for (const { host, ok } of results) {
      const prev = prevStates[host];
      if (prev === undefined) continue; // first sample — nothing to compare
      const idx = list.findIndex((i) => i.host === host && i.recoveredAt === null);
      const rec = idx >= 0 ? list[idx] : null;

      if (!ok) {
        if (rec) {
          // still failing — every failed sample counts (M3 bug: it used to
          // only increment on the true→false edge)
          rec.checks += 1;
          rec.consecutiveFails += 1;
          rec.consecutiveOks = 0;
          if (!rec.confirmed && rec.consecutiveFails >= OPEN_THRESHOLD) {
            rec.confirmed = true;
            newlyConfirmed.push(host);
          }
        } else {
          // first failure — pending until OPEN_THRESHOLD consecutive fails
          list.push({
            host,
            startedAt: now,
            recoveredAt: null,
            checks: 1,
            consecutiveFails: 1,
            consecutiveOks: 0,
            confirmed: false,
            severity: null,
          });
        }
      } else if (rec) {
        if (!rec.confirmed) {
          // flapped back before ever being confirmed — never a real incident
          list.splice(idx, 1);
        } else {
          rec.consecutiveOks += 1;
          rec.consecutiveFails = 0;
          if (rec.consecutiveOks >= CLOSE_THRESHOLD) {
            rec.recoveredAt = now;
            rec.severity = severityFor(rec.startedAt, now);
            newlyRecovered.push({ host, severity: rec.severity });
          }
        }
      }
      // prev ok + ok → nothing to do
    }
    return list.slice(-MAX_KEPT);
  })) ?? [];

  // M7 alerting (env-gated, fire-and-forget, deduped in security.ts)
  for (const host of newlyConfirmed) {
    void alertWebhook(`🔴 ${host} is DOWN — incident confirmed after ${OPEN_THRESHOLD} failed checks`);
  }
  for (const r of newlyRecovered) {
    void alertWebhook(`🟢 ${r.host} recovered (incident closed as ${r.severity ?? "minor"})`);
  }

  return {
    active: all.filter((i) => i.confirmed && i.recoveredAt === null),
    recent: all
      .filter((i) => i.confirmed && i.recoveredAt !== null)
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
