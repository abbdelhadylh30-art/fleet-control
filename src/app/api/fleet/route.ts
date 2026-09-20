import { NextRequest, NextResponse } from "next/server";
import {
  FLEET,
  GITHUB_OWNER,
  GITHUB_TOKEN,
  INDEXNOW_KEY,
  auditScore,
  type FleetResponse,
  type RepoInfo,
  type SiteAudit,
  type SiteHealth,
} from "@/lib/fleet";
import { readLog, totalSubmitted } from "@/lib/activity-log";
import { autoSubmitArmed } from "@/lib/auto-submit";
import { recordUptime, readUptime, uptimeStats } from "@/lib/uptime";
import { buildPrevStates, updateIncidents } from "@/lib/incidents";
import { readScoreHistory, recordScoreAvg } from "@/lib/score-history";
import type { VerifyStatus } from "@/lib/fleet";

export const dynamic = "force-dynamic";
// serverless safety: fleet checks + upstream API calls can take a while
export const maxDuration = 60;

const CACHE_TTL_MS = 30_000;
const REPOS_TTL_MS = 5 * 60_000;
const VERIFY_TTL_MS = 5 * 60_000;

let cache: { at: number; payload: FleetResponse } | null = null;
let reposCache: { at: number; data: Record<string, RepoInfo> } | null = null;
let verifyCache: { at: number; gsc: VerifyStatus; bing: VerifyStatus } | null = null;

async function fetchText(url: string, timeoutMs = 8000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "FleetControl/1.0 (+abdelhadygabriel.me)" },
    cache: "no-store",
    redirect: "follow",
  });
  const text = res.ok ? await res.text() : "";
  return { status: res.status, text };
}

// Extract the content attribute of a <meta> tag matched by name= or property=
// (works with attributes in any order since [^>]* spans the whole open tag)
function metaContent(html: string, attr: "name" | "property", key: string): string | null {
  const tag = html.match(new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*>`, "i"))?.[0];
  if (!tag) return null;
  return tag.match(/content=["']([^"']*)["']/i)?.[1] ?? null;
}

function tagPresent(html: string, pattern: string): boolean {
  return new RegExp(pattern, "i").test(html);
}

function parseAudit(html: string): SiteAudit {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const description = metaContent(html, "name", "description");
  const lang = html.match(/<html[^>]*\slang=["']([^"']*)["']/i)?.[1]?.trim() ?? null;
  const titleLength = title?.length ?? 0;
  const descriptionLength = description?.trim().length ?? 0;
  const ogTitleOk = tagPresent(html, `<meta[^>]*property=["']og:title["']`);
  const ogImageOk = tagPresent(html, `<meta[^>]*property=["']og:image["']`);
  return {
    title,
    titleLength,
    titleOk: !!title && titleLength >= 15 && titleLength <= 60,
    description: description?.trim() || null,
    descriptionLength,
    descriptionOk: !!description && descriptionLength >= 50 && descriptionLength <= 160,
    canonicalOk:
      /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html) ||
      /<link[^>]+href=["'][^"']+["'][^>]*rel=["']canonical["']/i.test(html),
    ogTitleOk,
    ogImageOk,
    twitterOk: tagPresent(html, `<meta[^>]*name=["']twitter:card["']`),
    viewportOk: tagPresent(html, `<meta[^>]*name=["']viewport["']`),
    faviconOk:
      tagPresent(html, `<link[^>]+rel=["'][^"']*icon[^"']*["']`) ||
      /<link[^>]+href=["'][^"']*favicon[^"']*["']/i.test(html),
    lang,
    langOk: !!lang,
    h1Count: (html.match(/<h1[\s>]/gi) ?? []).length,
    ogTitleText: metaContent(html, "property", "og:title"),
    ogDescText: metaContent(html, "property", "og:description"),
    ogImageUrl: metaContent(html, "property", "og:image")?.trim() ?? null,
    seoScore: 0, // filled by auditScore() after health checks
  };
}

async function checkHost(host: string): Promise<SiteHealth> {
  const base = `https://${host}`;
  const health: SiteHealth = {
    httpStatus: null,
    title: null,
    robotsOk: false,
    robotsHasSitemap: false,
    sitemapOk: false,
    sitemapUrls: 0,
    keyOk: false,
    canonicalOk: false,
    ogOk: false,
    audit: null,
  };
  try {
    const [home, robots, sitemap, key] = await Promise.all([
      fetchText(`${base}/`),
      fetchText(`${base}/robots.txt`),
      fetchText(`${base}/sitemap.xml`),
      fetchText(`${base}/${INDEXNOW_KEY}.txt`),
    ]);
    health.httpStatus = home.status;
    health.title = home.text.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? null;
    health.robotsOk = robots.status === 200;
    health.robotsHasSitemap = /sitemap:\s*\S+/i.test(robots.text);
    health.sitemapOk = sitemap.status === 200 && sitemap.text.includes("<urlset");
    health.sitemapUrls = (sitemap.text.match(/<loc>/g) ?? []).length;
    health.keyOk = key.status === 200 && key.text.trim() === INDEXNOW_KEY;
    const audit = home.text ? parseAudit(home.text) : null;
    if (audit?.ogImageUrl && !/^https?:\/\//i.test(audit.ogImageUrl)) {
      try {
        audit.ogImageUrl = new URL(audit.ogImageUrl, base).toString();
      } catch {
        /* keep raw relative URL */
      }
    }
    health.canonicalOk = audit?.canonicalOk ?? false;
    health.ogOk = !!(audit?.ogTitleOk || audit?.ogImageOk);
    if (audit) audit.seoScore = auditScore({ robotsOk: health.robotsOk, sitemapOk: health.sitemapOk, keyOk: health.keyOk, audit });
    health.audit = audit;
  } catch (e) {
    health.error = e instanceof Error ? e.message : "unknown error";
  }
  return health;
}

async function fetchRepos(): Promise<Record<string, RepoInfo>> {
  if (reposCache && Date.now() - reposCache.at < REPOS_TTL_MS) {
    return reposCache.data;
  }
  if (!GITHUB_TOKEN) return {};
  try {
    const res = await fetch(
      `https://api.github.com/users/${GITHUB_OWNER}/repos?per_page=100`,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: `Bearer ${GITHUB_TOKEN}`,
          accept: "application/vnd.github+json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return {};
    const list = (await res.json()) as Array<Record<string, unknown>>;
    const data: Record<string, RepoInfo> = {};
    for (const r of list) {
      data[String(r.name)] = {
        name: String(r.name),
        isPrivate: Boolean(r.private),
        pushedAt: (r.pushed_at as string) ?? null,
        language: (r.language as string) ?? null,
        homepage: (r.homepage as string) || null,
      };
    }
    reposCache = { at: Date.now(), data };
    return data;
  } catch {
    return {};
  }
}

// Google Search Console domain verification = TXT record on the apex domain.
// Bing = conventional BingSiteAuth.xml file at the www root.
async function checkVerification(): Promise<{ gsc: VerifyStatus; bing: VerifyStatus }> {
  if (verifyCache && Date.now() - verifyCache.at < VERIFY_TTL_MS) {
    return { gsc: verifyCache.gsc, bing: verifyCache.bing };
  }
  const gsc: VerifyStatus = { checked: false, verified: false, record: null };
  const bing: VerifyStatus = { checked: false, verified: false, record: null };
  const [dns, bingFile] = await Promise.allSettled([
    fetch("https://dns.google/resolve?name=abdelhadygabriel.me&type=TXT", {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    }),
    fetchText("https://www.abdelhadygabriel.me/BingSiteAuth.xml", 5000),
  ]);
  if (dns.status === "fulfilled" && dns.value.ok) {
    try {
      const json = (await dns.value.json()) as {
        Answer?: Array<{ data: string }>;
      };
      const txt = (json.Answer ?? [])
        .map((a) => a.data.replace(/^"|"$/g, ""))
        .find((d) => d.startsWith("google-site-verification="));
      gsc.checked = true;
      gsc.verified = !!txt;
      gsc.record = txt ?? null;
    } catch {
      /* DNS probe failed — report as unchecked */
    }
  }
  if (bingFile.status === "fulfilled") {
    bing.checked = true;
    bing.verified = bingFile.value.status === 200 && /<users>/i.test(bingFile.value.text);
    bing.record = bing.verified ? "BingSiteAuth.xml" : null;
  }
  verifyCache = { at: Date.now(), gsc, bing };
  return { gsc, bing };
}

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";

  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cache.payload, cached: true });
  }

  const [repos] = await Promise.all([fetchRepos()]);

  const sites = await Promise.all(
    FLEET.map(async (def) => ({
      ...def,
      repoUrl: `https://github.com/${GITHUB_OWNER}/${def.repo}`,
      health: await checkHost(def.host),
      repoInfo: repos[def.repo],
    })),
  );

  const log = await readLog();
  const liveSites = sites.filter((s) => s.health.httpStatus === 200);

  // self-driving indexing: armed hosts past their 6h cooldown get re-submitted
  const armedHosts = sites
    .filter(
      (s) =>
        s.health.httpStatus === 200 &&
        s.health.robotsOk &&
        s.health.sitemapOk &&
        s.health.keyOk,
    )
    .map((s) => s.host);
  const autoResults = await autoSubmitArmed(armedHosts, log);
  const logForCount = [...autoResults, ...log];
  const scores = liveSites.map((s) => s.health.audit?.seoScore ?? 0);
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  // persist uptime samples + reconcile incidents (fresh checks only)
  const prevStates = await buildPrevStates();
  await recordUptime(
    sites.map((s) => ({
      host: s.host,
      ok: s.health.httpStatus === 200 && !s.health.error,
      score: s.health.audit?.seoScore ?? 0,
    })),
  );
  const incidentView = await updateIncidents(
    prevStates,
    sites.map((s) => ({
      host: s.host,
      ok: s.health.httpStatus === 200 && !s.health.error,
    })),
  );
  const uptimeStore = await readUptime();
  const sitesWithUptime = sites.map((s) => ({
    ...s,
    uptime: uptimeStats(uptimeStore[s.host]),
  }));
  const uptimeSamples = Object.values(uptimeStore).flat();
  const fleetUptimePct = uptimeSamples.length
    ? Math.round(
        (uptimeSamples.filter((u) => u.ok).length / uptimeSamples.length) * 1000,
      ) / 10
    : 100;

  const { gsc, bing } = await checkVerification();

  // fleet score trend — record one avg per fresh check (guarded: never record
  // when every host failed, that would be a sandbox/network artifact not truth)
  if (liveSites.length > 0) await recordScoreAvg(avgScore);
  const scoreHistory = await readScoreHistory();
  const trend = scoreHistory.slice(-60);

  const payload: FleetResponse = {
    checkedAt: new Date().toISOString(),
    cached: false,
    sites: sitesWithUptime,
    summary: {
      total: sites.length,
      live: liveSites.length,
      seoArmed: sites.filter(
        (s) =>
          s.health.httpStatus === 200 &&
          s.health.robotsOk &&
          s.health.sitemapOk &&
          s.health.keyOk,
      ).length,
      urlsSubmitted: totalSubmitted(logForCount),
      avgScore,
      uptimePct: fleetUptimePct,
      downHosts: incidentView.active.map((i) => i.host),
      attention: sites
        .filter(
          (s) =>
            s.blocker ||
            s.health.httpStatus !== 200 ||
            s.health.error ||
            !(s.health.robotsOk && s.health.sitemapOk && s.health.keyOk),
        )
        .map((s) => s.id),
    },
    gsc,
    bing,
    incidents: incidentView,
    trend,
  };

  cache = { at: Date.now(), payload };
  return NextResponse.json(payload);
}
