import { NextRequest, NextResponse } from "next/server";
import { FLEET, INDEXNOW_KEY } from "@/lib/fleet";
import { appendLog, readLog, type LogEntry } from "@/lib/activity-log";

export const dynamic = "force-dynamic";
// serverless safety: fleet checks + upstream API calls can take a while
export const maxDuration = 60;

export async function GET() {
  const entries = await readLog();
  return NextResponse.json({ entries: entries.slice(0, 100) });
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

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { host?: string };
  const hostParam =
    typeof body.host === "string" && body.host ? body.host : "all";

  const targets =
    hostParam === "all"
      ? FLEET.map((s) => s.host)
      : FLEET.filter((s) => s.host === hostParam).map((s) => s.host);

  if (!targets.length) {
    return NextResponse.json(
      { error: `unknown host: ${hostParam}` },
      { status: 400 },
    );
  }

  const results: LogEntry[] = [];
  for (const host of targets) {
    try {
      // 1. key file must be live on the host (IndexNow requirement)
      const keyRes = await fetch(`https://${host}/${INDEXNOW_KEY}.txt`, {
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      const keyValid =
        keyRes.ok && (await keyRes.text()).trim() === INDEXNOW_KEY;
      if (!keyValid) {
        results.push({
          ts: new Date().toISOString(),
          host,
          http: keyRes.status,
          urls: 0,
          ok: false,
          reason: "IndexNow key file not live on this host",
        });
        continue;
      }

      // 2. collect URLs: homepage + same-host sitemap entries
      const urlList = await collectUrls(host);

      // 3. submit
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
      results.push({
        ts: new Date().toISOString(),
        host,
        http: res.status,
        urls: urlList.length,
        ok: res.status === 200 || res.status === 202,
        reason: res.ok ? undefined : `IndexNow responded ${res.status}`,
      });
    } catch (e) {
      results.push({
        ts: new Date().toISOString(),
        host,
        http: null,
        urls: 0,
        ok: false,
        reason: e instanceof Error ? e.message : "submission failed",
      });
    }
    // be polite to the shared IndexNow endpoint
    await new Promise((r) => setTimeout(r, 300));
  }

  await appendLog(results);
  return NextResponse.json({ results });
}
