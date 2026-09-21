import { mutateState, readState } from "@/lib/pg-state";

export interface LogEntry {
  ts: string;
  host: string;
  http: number | null;
  urls: number;
  ok: boolean;
  reason?: string;
  auto?: boolean; // fired by the self-driving pipeline (not a manual submit)
}

const KEY = "indexnow-log";
const MAX_KEPT = 300;

export async function readLog(): Promise<LogEntry[]> {
  const parsed = await readState<LogEntry[]>(KEY);
  return Array.isArray(parsed) ? parsed : [];
}

export async function appendLog(entries: LogEntry[]): Promise<void> {
  // Atomic prepend under optimistic-CAS — concurrent submissions can no longer
  // drop each other's log entries (H1, 2026-09-21).
  // Postgres (durable) with file fallback — submissions history survives cold starts
  await mutateState<LogEntry[]>(KEY, (cur) =>
    [...entries, ...(Array.isArray(cur) ? cur : [])].slice(0, MAX_KEPT),
  );
}

export function totalSubmitted(entries: LogEntry[]): number {
  return entries
    .filter((e) => e.ok)
    .reduce((sum, e) => sum + (e.urls || 0), 0);
}
