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
  type GscSitemapInfo,
} from "@/lib/gsc-types";

export type {
  GscCallResult,
  GscOutcome,
  GscSitemapInfo,
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

/** Low-level authed GET/PUT against the Search Console API. */
async function gscFetch(
  token: string,
  path: string,
  init?: { method?: "GET" | "PUT" },
): Promise<{ status: number; body: unknown; errorText?: string }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}` },
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
  await fs.writeFile(GSC_LOG_PATH, JSON.stringify(all, null, 2), "utf8");
}
