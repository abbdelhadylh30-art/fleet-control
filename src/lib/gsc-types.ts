// ─── Client-safe GSC types & validators (no node:fs — safe in browser) ───────

export const DOMAIN_PROPERTY = "abdelhadygabriel.me";

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
