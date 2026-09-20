import { promises as fs } from "fs";
import path from "path";

const LOG_PATH = path.join(process.cwd(), "db", "indexnow-log.json");

export interface LogEntry {
  ts: string;
  host: string;
  http: number | null;
  urls: number;
  ok: boolean;
  reason?: string;
}

export async function readLog(): Promise<LogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function appendLog(entries: LogEntry[]): Promise<void> {
  const all = [...entries, ...(await readLog())].slice(0, 300);
  try {
    await fs.writeFile(LOG_PATH, JSON.stringify(all, null, 2), "utf8");
  } catch {
    /* read-only FS (serverless) — log is best-effort */
  }
}

export function totalSubmitted(entries: LogEntry[]): number {
  return entries
    .filter((e) => e.ok)
    .reduce((sum, e) => sum + (e.urls || 0), 0);
}
