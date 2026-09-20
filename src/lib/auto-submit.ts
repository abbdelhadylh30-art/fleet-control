// ─── Self-driving IndexNow — auto-submit hosts whose SEO just got armed ──────
// Hooked into every fresh fleet check: any host that is LIVE + robotsOk +
// sitemapOk + keyOk but hasn't had a successful submission in the last 6h
// gets re-submitted automatically (capped per run so a fresh check never
// times out). Entries land in the same IndexNow log flagged `auto: true`.

import { INDEXNOW_KEY } from "@/lib/fleet";
import { appendLog, type LogEntry } from "@/lib/activity-log";

const COOLDOWN_MS = 6 * 3600_000;
const MAX_PER_RUN = 5;

/** Log is newest-first — find when `host` last had a successful submission. */
export function lastOkSubmitAt(log: LogEntry[], host: string): number | null {
  for (const e of log) {
    if (e.host === host && e.ok) return new Date(e.ts).getTime();
  }
  return null;
}

async function collectUrls(host: string): Promise<string[]> {
  const base = `https://${host}`;
  const urls = new Set<string>([`${base}/`]);
  try {
    const res = await fetch(`${base}/sitemap.xml`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.ok) {
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const u = m[1];
        try {
          if (new URL(u).host === host) urls.add(u);
        } catch {
          // skip malformed loc
        }
      }
    }
  } catch {
    // sitemap unavailable — submit homepage only
  }
  return [...urls].slice(0, 50);
}

/**
 * Submit every armed host that is past its cooldown. Returns the new log
 * entries (already persisted). Never throws — a failed auto-submit is just
 * a failed log entry; the next fresh check retries after cooldown.
 */
export async function autoSubmitArmed(
  armedHosts: string[],
  log: LogEntry[],
): Promise<LogEntry[]> {
  const due = armedHosts
    .filter((h) => {
      const last = lastOkSubmitAt(log, h);
      return last === null || Date.now() - last > COOLDOWN_MS;
    })
    .slice(0, MAX_PER_RUN);
  if (due.length === 0) return [];

  const results: LogEntry[] = [];
  for (const host of due) {
    try {
      const urlList = await collectUrls(host);
      const res = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
        body: JSON.stringify({
          host,
          key: INDEXNOW_KEY,
          keyLocation: `https://${host}/${INDEXNOW_KEY}.txt`,
          urlList,
        }),
      });
      const ok = res.status === 200 || res.status === 202;
      results.push({
        ts: new Date().toISOString(),
        host,
        http: res.status,
        urls: urlList.length,
        ok,
        auto: true,
        reason: ok ? "auto: armed + cooldown elapsed" : `IndexNow responded ${res.status}`,
      });
    } catch (e) {
      results.push({
        ts: new Date().toISOString(),
        host,
        http: null,
        urls: 0,
        ok: false,
        auto: true,
        reason: e instanceof Error ? e.message : "auto-submit failed",
      });
    }
    // be polite to the shared IndexNow endpoint
    await new Promise((r) => setTimeout(r, 300));
  }

  await appendLog(results);
  return results;
}
