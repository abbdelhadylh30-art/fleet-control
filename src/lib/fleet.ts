// ─── Fleet configuration — abdelhadygabriel.me network ───────────────────────
// Source of truth: GitHub repos + Vercel deployments (audited — worklog Task 1)

import type { SiteUptime } from "@/lib/uptime";
import type { IncidentView } from "@/lib/incidents";
import type { ScorePoint } from "@/lib/score-history";
import type { AutoPilotAction } from "@/lib/autopilot";
export type { SiteUptime, ScorePoint };

// IndexNow key — env first (H5 hygiene). The compiled fallback is the
// LEGACY value that predates the env var; it is public-by-design anyway
// (IndexNow keys are served at <host>/<key>.txt on every fleet site for
// verification), but new deployments should set INDEXNOW_KEY and rely on
// env only. indexnowKeyFromEnv lets the dashboard surface which one is live.
const INDEXNOW_FALLBACK_KEY = "11e700733a1106ad3bbf2bfc6709c49b";
export const INDEXNOW_KEY = process.env.INDEXNOW_KEY || INDEXNOW_FALLBACK_KEY;
export const indexnowKeyFromEnv = Boolean(process.env.INDEXNOW_KEY);

export const GITHUB_OWNER = "abbdelhadylh30-art";
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

export type SiteGroup = "Client Sites" | "Tools & Apps" | "Portfolio";

export interface FleetSiteDef {
  id: string;
  host: string;
  label: string;
  description: string;
  repo: string;
  group: SiteGroup;
  note?: string;
  blocker?: string;
  self?: boolean; // this dashboard itself — the radar watching the radar
}

export const FLEET: FleetSiteDef[] = [
  {
    id: "fleet",
    host: "fleet.abdelhadygabriel.me",
    label: "Fleet Control",
    description: "This dashboard — the radar watches itself",
    repo: "fleet-control",
    group: "Tools & Apps",
    self: true,
  },
  {
    id: "apex",
    host: "www.abdelhadygabriel.me",
    label: "Abdelhady Gabriel",
    description: "Apex — personal portfolio & business site",
    repo: "dev-portfolio",
    group: "Portfolio",
    note: "apex abdelhadygabriel.me → www",
  },
  {
    id: "menu",
    host: "menu.abdelhadygabriel.me",
    label: "Qaimati · قائمتي",
    description: "QR digital menu platform — 2Shot",
    repo: "qaimati",
    group: "Client Sites",
  },
  {
    id: "glamchain",
    host: "glamchain.abdelhadygabriel.me",
    label: "GlamChain",
    description: "Multi-tenant salon SaaS — West Bay, Doha",
    repo: "glamchain",
    group: "Client Sites",
  },
  {
    id: "fitness",
    host: "fitness.abdelhadygabriel.me",
    label: "Fitness House",
    description: "Boutique fitness studio — Re-life Your Body",
    repo: "fitness-house",
    group: "Client Sites",
  },
  {
    id: "portfolio",
    host: "portfolio.abdelhadygabriel.me",
    label: "Mohamed Medhat",
    description: "Marketing specialist portfolio + admin",
    repo: "portfolio",
    group: "Client Sites",
  },
  {
    id: "athar",
    host: "athar.abdelhadygabriel.me",
    label: "Athar · أثر",
    description: "Habit & identity tracker",
    repo: "Athar",
    group: "Tools & Apps",
  },
  {
    id: "forge",
    host: "forge.abdelhadygabriel.me",
    label: "Forge Studio",
    description: "Landing page builder + 5-category auditor",
    repo: "forge-studio",
    group: "Tools & Apps",
  },
  {
    id: "landing",
    host: "landing.abdelhadygabriel.me",
    label: "Landing Forge",
    description: "Visual landing page builder",
    repo: "landing-forge",
    group: "Tools & Apps",
  },
  {
    id: "ledger",
    host: "ledger.abdelhadygabriel.me",
    label: "Build Ledger",
    description: "Projects & campaigns tracker",
    repo: "build-ledger",
    group: "Tools & Apps",
  },
  {
    id: "profile",
    host: "profile.abdelhadygabriel.me",
    label: "ProfileForge",
    description: "GitHub profile README generator",
    repo: "profileforge",
    group: "Tools & Apps",
  },
  {
    id: "leads",
    host: "leads.abdelhadygabriel.me",
    label: "Lead Profiler",
    description: "Cold-outreach research compressor",
    repo: "lead-profiler",
    group: "Tools & Apps",
  },
  {
    id: "pixelforge",
    host: "pixelforge.abdelhadygabriel.me",
    label: "PixelForge",
    description: "Landing page audit & optimization tool",
    repo: "Pixelforge",
    group: "Tools & Apps",
  },
  {
    id: "dev",
    host: "dev.abdelhadygabriel.me",
    label: "Dev Portfolio",
    description: "Developer portfolio — Vercel-style dark",
    repo: "dev-portfolio",
    group: "Portfolio",
  },
];

export const repoUrl = (repo: string) =>
  `https://github.com/${GITHUB_OWNER}/${repo}`;

// ─── Types shared between API routes and the dashboard ──────────────────────

export interface RepoInfo {
  name: string;
  isPrivate: boolean;
  pushedAt: string | null;
  language: string | null;
  homepage: string | null;
}

export interface SiteAudit {
  title: string | null;
  titleLength: number;
  titleOk: boolean; // exists AND 15–60 chars
  description: string | null;
  descriptionLength: number;
  descriptionOk: boolean; // exists AND 50–160 chars
  canonicalOk: boolean;
  ogTitleOk: boolean;
  ogImageOk: boolean;
  twitterOk: boolean;
  viewportOk: boolean;
  faviconOk: boolean;
  lang: string | null;
  langOk: boolean;
  h1Count: number;
  ogTitleText: string | null; // og:title content — social share preview
  ogDescText: string | null; // og:description content
  ogImageUrl: string | null; // resolved absolute og:image URL
  seoScore: number; // 0–100 weighted
}

export interface SiteHealth {
  httpStatus: number | null;
  title: string | null;
  robotsOk: boolean;
  robotsHasSitemap: boolean;
  sitemapOk: boolean;
  sitemapUrls: number;
  keyOk: boolean;
  canonicalOk: boolean;
  ogOk: boolean;
  audit: SiteAudit | null;
  error?: string;
}

export interface FleetSiteStatus extends FleetSiteDef {
  health: SiteHealth;
  repoInfo?: RepoInfo;
  uptime: SiteUptime;
}

export interface VerifyStatus {
  checked: boolean; // whether the probe succeeded
  verified: boolean; // verification artifact found
  record: string | null; // e.g. the google-site-verification=… TXT value
}

export interface FleetSummary {
  total: number;
  live: number;
  seoArmed: number;
  urlsSubmitted: number;
  attention: string[];
  avgScore: number; // fleet-wide mean SEO score (live sites)
  uptimePct: number; // fleet-wide uptime over stored history (rollups → up to 30d)
  uptimeWindowDays?: number; // days the uptimePct actually covers (H3 honest label)
  downHosts: string[]; // hosts with an OPEN (unrecovered) incident
}

export interface FleetResponse {
  checkedAt: string;
  cached: boolean;
  sites: FleetSiteStatus[];
  summary: FleetSummary;
  gsc: VerifyStatus; // Google Search Console TXT verification on the apex domain
  bing: VerifyStatus; // BingSiteAuth.xml on www
  incidents: IncidentView; // open + recently resolved downtime incidents
  trend: ScorePoint[]; // fleet avg score trend — hourly rollups, up to 7d (H3)
  autoPilot: { enabled: boolean; actions: AutoPilotAction[] }; // self-heal moves fired on this check
  stateLayer?: {
    // durable state health (L4) — admin payload only
    mode: "postgres" | "file";
    version: number | null; // CAS version of the watched state key
    updatedAt: string | null; // last durable write
  };
}

// Scoring weights (sum = 100): robots 5 · sitemap 10 · key 5 · title 15 ·
// description 15 · canonical 10 · og 15 · twitter 5 · viewport 10 · favicon 5 · lang 5
export function auditScore(h: {
  robotsOk: boolean;
  sitemapOk: boolean;
  keyOk: boolean;
  audit: SiteAudit | null;
}): number {
  let s = 0;
  if (h.robotsOk) s += 5;
  if (h.sitemapOk) s += 10;
  if (h.keyOk) s += 5;
  const a = h.audit;
  if (a) {
    if (a.titleOk) s += 15;
    else if (a.title) s += 8;
    if (a.descriptionOk) s += 15;
    else if (a.description) s += 8;
    if (a.canonicalOk) s += 10;
    if (a.ogTitleOk && a.ogImageOk) s += 15;
    else if (a.ogTitleOk || a.ogImageOk) s += 8;
    if (a.twitterOk) s += 5;
    if (a.viewportOk) s += 10;
    if (a.faviconOk) s += 5;
    if (a.langOk) s += 5;
  }
  return s;
}

export const scoreTone = (
  score: number,
): "emerald" | "amber" | "rose" => (score >= 80 ? "emerald" : score >= 50 ? "amber" : "rose");
