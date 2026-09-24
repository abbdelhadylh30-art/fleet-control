// ─── Google Search Console API client — bulk sitemap submission ──────────────
// Answers the "do I have to index them one by one?" question: NO.
// One Domain property covers all subdomains; sitemaps can be bulk-submitted
// through the Search Console API with a short-lived OAuth access token.
//
// Token flow: user generates a token in Google OAuth Playground (60 sec),
// pastes it into the dashboard → backend proxies to Google. The token is
// NEVER logged or persisted server-side.

import { promises as fs } from "fs";
import path from "path";

import {
  DOMAIN_PROPERTY,
  type GscCallResult,
  type GscOutcome,
  type GscPerfResult,
  type GscPerfRow,
  type GscSitemapInfo,
} from "@/lib/gsc-types";

export type {
  GscCallResult,
  GscOutcome,
  GscSitemapInfo,
  GscPerfResult,
  GscPerfRow,
} from "@/lib/gsc-types";
export { DOMAIN_PROPERTY } from "@/lib/gsc-types";

const API_BASE = "https://www.googleapis.com/webmasters/v3";
const GSC_LOG_PATH = path.join(process.cwd(), "db", "gsc-log.json");

/** Encode `sc-domain:example.com` for use in the API path. */
function siteUrl(): string {
  return encodeURIComponent(`sc-domain:${DOMAIN_PROPERTY}`);
}

/** Only sitemaps on the fleet's own domain are allowed through. */
export function isFleetSitemap(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === DOMAIN_PROPERTY || u.hostname.endsWith(`.${DOMAIN_PROPERTY}`)) &&
      u.pathname === "/sitemap.xml"
    );
  } catch {
    return false;
  }
}

// (GscSitemapInfo / GscOutcome / GscCallResult live in @/lib/gsc-types —
//  imported above and re-exported for server-side consumers.)

const AUTH_HINTS: Record<number, string> = {
  400: "Google rejected the request (bad token format?) — generate a fresh token.",
  401: "Token invalid or expired — OAuth Playground tokens last ~1 hour; generate a new one.",
  403:
    "Token works but lacks permission — make sure you authorized the “Search Console API” scope (webmasters) AND the account owns the abdelhadygabriel.me property.",
  404: "Property not found — verify the Domain property in Search Console first.",
};

/** Low-level authed GET/PUT/POST against the Search Console API. */
async function gscFetch(
  token: string,
  path: string,
  init?: { method?: "GET" | "PUT" | "POST"; body?: unknown },
): Promise<{ status: number; body: unknown; errorText?: string }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    // GSC API can be slow — give it room
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body, errorText: text.slice(0, 300) };
}

/** List every sitemap already registered under the Domain property. */
export async function gscListSitemaps(
  token: string,
): Promise<GscCallResult> {
  try {
    const { status, body } = await gscFetch(
      token,
      `/sites/${siteUrl()}/sitemaps`,
    );
    if (status !== 200) {
      return {
        ok: false,
        status,
        error:
          AUTH_HINTS[status] ??
          `Search Console API returned ${status}.`,
      };
    }
    const parsed = body as { sitemap?: GscSitemapInfo[] };
    return { ok: true, status: 200, sitemaps: parsed.sitemap ?? [] };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: `Could not reach Google: ${e instanceof Error ? e.message : "network error"}`,
    };
  }
}

/** PUT each fleet sitemap into the Domain property (the bulk one-click path). */
export async function gscSubmitSitemaps(
  token: string,
  sitemapUrls: string[],
): Promise<GscCallResult> {
  const results: GscOutcome[] = [];
  let firstBadStatus = 0;
  let firstBadError: string | undefined;

  for (const url of sitemapUrls.slice(0, 20)) {
    if (!isFleetSitemap(url)) {
      results.push({
        host: hostOf(url),
        sitemap: url,
        http: null,
        ok: false,
        reason: "blocked — not a fleet sitemap URL",
      });
      continue;
    }
    try {
      const { status, errorText } = await gscFetch(
        token,
        `/sites/${siteUrl()}/sitemaps/${encodeURIComponent(url)}`,
        { method: "PUT" },
      );
      const ok = status >= 200 && status < 300;
      if (!ok && !firstBadStatus) {
        firstBadStatus = status;
        firstBadError = AUTH_HINTS[status] ?? errorText;
      }
      results.push({
        host: hostOf(url),
        sitemap: url,
        http: status,
        ok,
        reason: ok ? undefined : (`HTTP ${status}` + (AUTH_HINTS[status] ? "" : ` — ${errorText?.slice(0, 120)}`)),
      });
    } catch (e) {
      results.push({
        host: hostOf(url),
        sitemap: url,
        http: null,
        ok: false,
        reason: e instanceof Error ? e.message : "network error",
      });
    }
    // polite pacing — GSC quota is friendly but let's not hammer
    await new Promise((r) => setTimeout(r, 250));
  }

  const allBlockedByAuth = results.length > 0 && results.every((r) => !r.ok && firstBadStatus && (firstBadStatus === 401 || firstBadStatus === 403));
  return {
    ok: !allBlockedByAuth,
    status: firstBadStatus || 200,
    error: allBlockedByAuth ? (AUTH_HINTS[firstBadStatus] ?? firstBadError) : undefined,
    results,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ─── Search performance (Search Analytics API — clicks / impressions) ──────

const PERF_CACHE_TTL = 10 * 60 * 1000; // 10 min — Search Analytics is quota'd
let perfCache: { at: number; data: GscPerfResult } | null = null;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface AnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

function mapRows(rows: AnalyticsRow[] | undefined, pick: (k: string[]) => string): GscPerfRow[] {
  return (rows ?? []).map((r) => ({
    key: pick(r.keys ?? []),
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));
}

/**
 * Pull the last 28 days of Search performance for the Domain property:
 * aggregate totals + top pages + top search queries. One Search Analytics
 * query each — cached 10 min to stay far under Google's quota.
 */
export async function gscSearchPerformance(token: string): Promise<GscPerfResult> {
  if (perfCache && Date.now() - perfCache.at < PERF_CACHE_TTL) {
    return perfCache.data;
  }

  const end = new Date();
  const start = new Date(end.getTime() - 27 * 24 * 60 * 60 * 1000);
  const range = { start: isoDay(start), end: isoDay(end) };
  const query = (dimensions?: string[], rowLimit = 8) =>
    gscFetch(token, `/sites/${siteUrl()}/searchAnalytics/query`, {
      method: "POST",
      body: {
        startDate: range.start,
        endDate: range.end,
        ...(dimensions ? { dimensions } : {}),
        rowLimit,
        dataState: "all", // include the freshest (unfinalized) days
      },
    });

  try {
    const [totalsRes, pagesRes, queriesRes] = await Promise.all([
      query(undefined, 1),
      query(["page"], 8),
      query(["query"], 8),
    ]);

    if (totalsRes.status === 403 || totalsRes.status === 401) {
      const result: GscPerfResult = {
        ok: false,
        status: totalsRes.status,
        error: AUTH_HINTS[totalsRes.status] ?? "Google refused the performance request.",
        range,
      };
      return result;
    }
    if (totalsRes.status !== 200) {
      return {
        ok: false,
        status: totalsRes.status,
        error: AUTH_HINTS[totalsRes.status] ?? `Search Analytics returned ${totalsRes.status}.`,
        range,
      };
    }

    const totalsRows = (totalsRes.body as { rows?: AnalyticsRow[] }).rows ?? [];
    const t = totalsRows[0] ?? {};
    const result: GscPerfResult = {
      ok: true,
      status: 200,
      range,
      totals: {
        clicks: t.clicks ?? 0,
        impressions: t.impressions ?? 0,
        ctr: t.ctr ?? 0,
        position: t.position ?? 0,
      },
      pages: mapRows((pagesRes.body as { rows?: AnalyticsRow[] }).rows, (k) => k[0] ?? ""),
      queries: mapRows((queriesRes.body as { rows?: AnalyticsRow[] }).rows, (k) => k[0] ?? ""),
    };
    perfCache = { at: Date.now(), data: result };
    return result;
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: `Could not reach Google: ${e instanceof Error ? e.message : "network error"}`,
      range,
    };
  }
}

// ─── Local submission history (tokens never stored) ─────────────────────────

export interface GscLogEntry {
  ts: string;
  action: "submit" | "status";
  host: string;
  http: number | null;
  ok: boolean;
  reason?: string;
}

export async function readGscLog(): Promise<GscLogEntry[]> {
  try {
    const raw = await fs.readFile(GSC_LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GscLogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function appendGscLog(entries: GscLogEntry[]): Promise<void> {
  const all = [...entries, ...(await readGscLog())].slice(0, 200);
  try {
    await fs.writeFile(GSC_LOG_PATH, JSON.stringify(all, null, 2), "utf8");
  } catch {
    /* read-only FS (serverless) — log is best-effort */
  }
}
