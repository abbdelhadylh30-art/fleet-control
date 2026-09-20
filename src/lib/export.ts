// ─── Fleet report export helpers (client-side downloads) ─────────────────────

import type { FleetSiteStatus, FleetResponse } from "@/lib/fleet";

const CSV_COLUMNS: { key: string; get: (s: FleetSiteStatus) => string }[] = [
  { key: "id", get: (s) => s.id },
  { key: "label", get: (s) => s.label },
  { key: "host", get: (s) => s.host },
  { key: "group", get: (s) => s.group },
  { key: "status", get: (s) => (s.health.httpStatus === 200 ? (s.health.robotsOk && s.health.sitemapOk && s.health.keyOk ? "SEO Ready" : "Live") : "Down") },
  { key: "seoScore", get: (s) => String(s.health.audit?.seoScore ?? "") },
  { key: "title", get: (s) => s.health.audit?.title ?? "" },
  { key: "titleLength", get: (s) => String(s.health.audit?.titleLength ?? "") },
  { key: "description", get: (s) => s.health.audit?.description ?? "" },
  { key: "descriptionLength", get: (s) => String(s.health.audit?.descriptionLength ?? "") },
  { key: "canonical", get: (s) => (s.health.audit?.canonicalOk ? "yes" : "no") },
  { key: "ogTitle", get: (s) => (s.health.audit?.ogTitleOk ? "yes" : "no") },
  { key: "ogImage", get: (s) => (s.health.audit?.ogImageOk ? "yes" : "no") },
  { key: "twitterCard", get: (s) => (s.health.audit?.twitterOk ? "yes" : "no") },
  { key: "viewport", get: (s) => (s.health.audit?.viewportOk ? "yes" : "no") },
  { key: "favicon", get: (s) => (s.health.audit?.faviconOk ? "yes" : "no") },
  { key: "lang", get: (s) => s.health.audit?.lang ?? "" },
  { key: "h1Count", get: (s) => String(s.health.audit?.h1Count ?? "") },
  { key: "robots", get: (s) => (s.health.robotsOk ? "yes" : "no") },
  { key: "sitemap", get: (s) => (s.health.sitemapOk ? "yes" : "no") },
  { key: "sitemapUrls", get: (s) => String(s.health.sitemapUrls) },
  { key: "indexNowKey", get: (s) => (s.health.keyOk ? "yes" : "no") },
  { key: "uptimePct", get: (s) => (s.uptime?.checked ? String(s.uptime.pct) : "") },
  { key: "uptimeChecks", get: (s) => String(s.uptime?.checked ?? 0) },
  { key: "blocker", get: (s) => s.blocker ?? "" },
  { key: "repo", get: (s) => s.repo },
  { key: "repoPushedAt", get: (s) => s.repoInfo?.pushedAt ?? "" },
];

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function fleetToCsv(sites: FleetSiteStatus[]): string {
  const header = CSV_COLUMNS.map((c) => c.key).join(",");
  const rows = sites.map((s) =>
    CSV_COLUMNS.map((c) => csvCell(c.get(s))).join(","),
  );
  return [header, ...rows].join("\r\n");
}

export function fleetMarkdownSummary(data: FleetResponse): string {
  const lines: string[] = [
    `# Fleet Control report`,
    ``,
    `Checked: ${data.checkedAt}`,
    `Sites: ${data.summary.total} · Live: ${data.summary.live} · SEO-armed: ${data.summary.seoArmed} · Avg score: ${data.summary.avgScore}/100 · URLs submitted: ${data.summary.urlsSubmitted} · Uptime: ${data.summary.uptimePct}%`,
    `GSC: ${data.gsc?.verified ? `verified (${data.gsc.record})` : "TXT not detected"} · Bing: ${data.bing?.verified ? "verified" : "not verified"}`,
    ``,
    `| Site | Host | Status | Score | Uptime | Notes |`,
    `|---|---|---|---|---|---|`,
  ];
  for (const s of data.sites) {
    const status =
      s.health.httpStatus === 200
        ? s.health.robotsOk && s.health.sitemapOk && s.health.keyOk
          ? "SEO Ready"
          : "Live"
        : "Down";
    lines.push(
      `| ${s.label} | ${s.host} | ${status} | ${s.health.audit?.seoScore ?? "–"} | ${s.uptime?.checked ? `${s.uptime.pct}%` : "–"} | ${s.blocker ?? ""} |`,
    );
  }
  return lines.join("\n");
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function fleetTimestamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}
