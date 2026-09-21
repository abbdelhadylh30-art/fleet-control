"use client";

// Priority actions — auto-generated fix plan for sites under 70 and blocked
// sites (L4 split out of the old monolith page.tsx).

import {
  ArrowUpRight,
  CheckCircle2,
  Copy,
  ListChecks,
  Timer,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { copyText } from "@/lib/copy";
import type { FleetSiteStatus } from "@/lib/fleet";

function topGaps(s: FleetSiteStatus): string[] {
  const h = s.health;
  const a = h.audit;
  const gaps: string[] = [];
  if (!h.keyOk) gaps.push("IndexNow key file");
  if (!h.sitemapOk) gaps.push("sitemap.xml");
  if (a) {
    if (!a.ogImageOk) gaps.push("og:image");
    if (!a.descriptionOk)
      gaps.push(a.description ? "description length" : "meta description");
    if (!a.titleOk) gaps.push(a.title ? "title length" : "title tag");
    if (!a.twitterOk) gaps.push("twitter:card");
    if (!a.canonicalOk) gaps.push("canonical");
    if (!a.faviconOk) gaps.push("favicon");
    if (!a.langOk) gaps.push("lang attribute");
    if (a.h1Count !== 1) gaps.push(a.h1Count === 0 ? "H1 heading" : `${a.h1Count}× H1`);
  }
  return gaps.slice(0, 3);
}

// Markdown checklist of everything that still needs fixing — paste-ready
function fixListMarkdown(sites: FleetSiteStatus[]): string {
  const needsWork = sites
    .filter(
      (s) =>
        s.health.httpStatus === 200 && (s.health.audit?.seoScore ?? 0) < 70,
    )
    .sort(
      (a, b) => (a.health.audit?.seoScore ?? 0) - (b.health.audit?.seoScore ?? 0),
    );
  const blocked = sites.filter((s) => s.blocker);
  const lines = [
    `# Fleet fix list — ${new Date().toLocaleDateString("en", { month: "short", day: "numeric" })}`,
  ];
  for (const s of needsWork) {
    lines.push(
      `- [ ] ${s.label} (${s.health.audit?.seoScore ?? 0}/100) — ${
        topGaps(s).join(" · ") || "score below 70"
      } — https://${s.host}`,
    );
  }
  for (const s of blocked) {
    lines.push(`- [ ] Vercel dashboard: ${s.label} — ${s.blocker}`);
  }
  return lines.join("\n");
}

export function PriorityActions({
  sites,
  onAudit,
}: {
  sites: FleetSiteStatus[];
  onAudit: (id: string) => void;
}) {
  const needsWork = sites
    .filter(
      (s) => s.health.httpStatus === 200 && (s.health.audit?.seoScore ?? 0) < 70,
    )
    .sort((a, b) => (a.health.audit?.seoScore ?? 0) - (b.health.audit?.seoScore ?? 0));
  const missingOgImage = sites.filter(
    (s) => s.health.audit && !s.health.audit.ogImageOk,
  ).length;
  const offRangeTitles = sites.filter(
    (s) => s.health.audit && !s.health.audit.titleOk,
  ).length;
  const offRangeDescs = sites.filter(
    (s) => s.health.audit && !s.health.audit.descriptionOk,
  ).length;
  const blocked = sites.filter((s) => s.blocker);

  return (
    <Card className="fade-up-item border-white/5 bg-zinc-900/60 backdrop-blur transition-colors hover:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <ListChecks className="h-4 w-4 text-emerald-400" />
          Priority actions
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { n: missingOgImage, t: "missing og:image" },
            { n: offRangeTitles, t: "off-range titles" },
            { n: offRangeDescs, t: "off-range descriptions" },
          ].map(({ n, t }) => (
            <Badge
              key={t}
              variant="outline"
              className={`px-2 py-0.5 text-[10px] tabular-nums ring-1 ${
                n > 0
                  ? "border-amber-500/20 bg-amber-500/5 text-amber-400 ring-amber-500/15"
                  : "border-emerald-500/20 bg-emerald-500/5 text-emerald-400 ring-emerald-500/15"
              }`}
            >
              {n} {t}
            </Badge>
          ))}
          {needsWork.length > 0 || blocked.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void copyText(
                  fixListMarkdown(sites),
                  "Fix list copied — paste it into your notes",
                )
              }
              className="h-6 gap-1 rounded-md px-2 text-[10px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            >
              <Copy className="h-3 w-3" /> copy fixes
            </Button>
          ) : null}
        </div>
      </div>
      <CardContent className="p-5 pt-4">
        {needsWork.length === 0 && blocked.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            All clear — every live site scores 70+ and has no blockers.
          </p>
        ) : (
          <ul className="space-y-2">
            {needsWork.map((s) => {
              const score = s.health.audit?.seoScore ?? 0;
              const critical = score < 50;
              const gaps = topGaps(s);
              return (
                <li
                  key={s.id}
                  className="group/row flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.02] px-3 py-2.5 ring-1 ring-white/5 transition-all duration-200 hover:bg-white/[0.04] hover:pl-4 hover:ring-white/10 sm:flex-nowrap"
                >
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ${
                      critical
                        ? "bg-rose-500/10 text-rose-400 ring-rose-500/25"
                        : "bg-amber-500/10 text-amber-400 ring-amber-500/25"
                    }`}
                  >
                    {score}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {s.label}
                    <span className="ml-2 text-xs text-zinc-500">
                      fix: {gaps.join(" · ") || "score below 70"}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onAudit(s.id)}
                    className="h-7 shrink-0 gap-1 px-2 text-[11px] text-emerald-400 opacity-100 hover:bg-emerald-500/10 sm:opacity-0 sm:transition-opacity sm:group-hover/row:opacity-100"
                  >
                    Audit <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
            {blocked.length > 0 ? (
              <li className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/[0.05] px-3 py-2.5 ring-1 ring-amber-500/15">
                <Timer className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span className="min-w-0 flex-1 text-xs leading-relaxed text-amber-300/90">
                  <span className="font-semibold tabular-nums">
                    {blocked.length} sites
                  </span>{" "}
                  wait on Vercel dashboard fixes (domain re-attach / repo link)
                  — {blocked.map((s) => s.id).join(", ")}
                </span>
              </li>
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
