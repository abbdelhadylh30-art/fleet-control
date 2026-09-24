// ─── Client-safe GSC types & validators (no node:fs — safe in browser) ───────

export const DOMAIN_PROPERTY = "abdelhadygabriel.me";

/**
 * The Google account that OWNS the Search Console Domain property.
 * User-confirmed 2026-09-21: the property lives under this account —
 * NOT under any other Gmail. Every connect / sign-in flow must name it.
 */
export const GSC_OWNER_EMAIL = "abbdelhadylh30@gmail.com";
export const GSC_OWNER_EMAIL_WRONG = "abbdelhadylh31@gmail.com";

export interface GscSitemapInfo {
  path: string; // sitemap URL
  lastSubmitted: string | null; // ISO
  lastDownloaded: string | null; // ISO
  isPending: boolean;
  warnings: number;
  errors: number;
}

export interface GscOutcome {
  host: string;
  sitemap: string;
  http: number | null;
  ok: boolean;
  reason?: string;
}

export interface GscCallResult {
  ok: boolean; // token + API reachable
  status: number; // HTTP status (or 0 on network failure)
  error?: string; // human-readable hint for the user
  sitemaps?: GscSitemapInfo[]; // for "status" action
  results?: GscOutcome[]; // for "submit" action
}

/** One Search Analytics row (a page or a query) — 28-day window. */
export interface GscPerfRow {
  key: string; // page URL or search query
  clicks: number;
  impressions: number;
  ctr: number; // 0..1 (Google's ratio)
  position: number; // avg position
}

export interface GscPerfResult {
  ok: boolean;
  status: number;
  error?: string;
  range: { start: string; end: string };
  totals?: { clicks: number; impressions: number; ctr: number; position: number };
  pages?: GscPerfRow[];
  queries?: GscPerfRow[];
}

/** Client-side mirror of the server-side fleet-sitemap guard. */
export function isFleetSitemapClient(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === DOMAIN_PROPERTY ||
        u.hostname.endsWith(`.${DOMAIN_PROPERTY}`)) &&
      u.pathname === "/sitemap.xml"
    );
  } catch {
    return false;
  }
}
