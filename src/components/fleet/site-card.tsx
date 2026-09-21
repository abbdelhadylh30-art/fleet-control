"use client";

// Per-site card + its ops strip micro-visualizations: uptime bars, score
// sparkline, score delta, 7-day IndexNow submissions (L4 split).

import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  FileCode2,
  Gauge,
  Github,
  Globe,
  HeartPulse,
  KeyRound,
  Link2,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScoreRing } from "@/components/audit-sheet";
import { SeoBadge } from "@/components/fleet/seo-badge";
import { relativeTime } from "@/components/fleet/relative-time";
import type { FleetSiteStatus, SiteUptime } from "@/lib/fleet";
import type { LogEntry } from "@/lib/activity-log";

export function SiteCard({
  site,
  onSubmit,
  onAudit,
  busy,
  log,
  index = 0,
}: {
  site: FleetSiteStatus;
  onSubmit: (host: string) => void;
  onAudit: (id: string) => void;
  busy: boolean;
  log: LogEntry[];
  index?: number;
}) {
  const h = site.health;
  const isLive = h.httpStatus === 200;
  const seoReady = isLive && h.robotsOk && h.sitemapOk && h.keyOk;
  const score = h.audit?.seoScore ?? 0;
  // hover ring + glow follow the score tone (emerald ≥80 · amber ≥50 · rose <50)
  const toneHover =
    score >= 80
      ? "hover:border-emerald-500/20 hover:shadow-emerald-950/40"
      : score >= 50
        ? "hover:border-amber-500/25 hover:shadow-amber-950/30"
        : "hover:border-rose-500/25 hover:shadow-rose-950/30";

  return (
    <Card
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={`fade-up-item group flex flex-col border-white/5 bg-zinc-900/60 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-zinc-900/80 hover:shadow-xl ${
        site.self ? "ring-1 ring-emerald-500/20" : ""
      } ${toneHover}`}
    >
      <CardHeader className="p-5 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold tracking-tight">
              {site.label}
            </h3>
            {site.self ? (
              <Badge
                variant="outline"
                className="shrink-0 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-300"
              >
                SELF
              </Badge>
            ) : null}
            <Badge
              variant="outline"
              className="shrink-0 border-white/10 px-1.5 text-[10px] text-zinc-400"
            >
              {site.group}
            </Badge>
          </div>
          <a
            href={`https://${site.host}`}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-0.5 font-mono text-xs text-zinc-500 transition-colors hover:text-emerald-400"
          >
            {site.host}
            <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        </div>
        <div data-slot="card-action" className="shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <ScoreRing
                score={score}
                size={48}
                stroke={4}
                asTrigger
                onOpen={() => onAudit(site.id)}
                label={`Open SEO audit for ${site.label} — score ${score}/100`}
              />
            </TooltipTrigger>
            <TooltipContent
              side="left"
              className="border border-white/10 bg-zinc-900 text-zinc-200"
            >
              <span className="font-semibold">SEO score {score}/100</span>
              <span className="text-zinc-500"> · click for full audit</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 p-5 pt-0">
        <p className="line-clamp-1 text-sm text-zinc-400">{site.description}</p>

        <div className="flex flex-wrap gap-1.5">
          <span
            title={seoReady ? "SEO Ready" : isLive ? "Live" : "Down"}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${
              seoReady
                ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25"
                : isLive
                  ? "bg-amber-500/10 text-amber-400 ring-amber-500/25"
                  : "bg-rose-500/10 text-rose-400 ring-rose-500/25"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                seoReady
                  ? "animate-pulse bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60"
                  : isLive
                    ? "bg-amber-400"
                    : "bg-rose-400"
              }`}
            />
            {seoReady ? "SEO Ready" : isLive ? "Live" : "Down"}
          </span>
          <SeoBadge
            ok={h.robotsOk && h.robotsHasSitemap}
            icon={ShieldCheck}
            label="robots"
            detail={h.robotsHasSitemap ? "+sitemap" : undefined}
          />
          <SeoBadge
            ok={h.sitemapOk}
            icon={FileCode2}
            label="sitemap"
            detail={h.sitemapOk ? `(${h.sitemapUrls})` : undefined}
          />
          <SeoBadge ok={h.keyOk} icon={KeyRound} label="key" />
          <SeoBadge ok={h.canonicalOk} icon={Link2} label="canonical" />
          <SeoBadge ok={h.ogOk} icon={ExternalLink} label="og" />
        </div>

        {site.blocker ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/5 px-2.5 py-2 text-xs leading-relaxed text-amber-400/90 ring-1 ring-amber-500/15">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {site.blocker}
          </p>
        ) : null}

        {h.error ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-rose-500/5 px-2.5 py-2 text-xs text-rose-400/90 ring-1 ring-rose-500/15">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {h.error}
          </p>
        ) : null}

        {site.repoInfo?.pushedAt ? (
          <p className="text-[11px] text-zinc-600">
            repo <span className="font-mono">{site.repo}</span> pushed{" "}
            {relativeTime(site.repoInfo.pushedAt)}
            {site.repoInfo.isPrivate ? " · private 🔒" : ""}
          </p>
        ) : null}

        {/* ops strip — uptime history + score trend + 7-day submissions */}
        <div className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1.5 ring-1 ring-white/5">
          <UptimeBars uptime={site.uptime} />
          <ScoreSpark scores={site.uptime.recentScores} />
          <ScoreDelta trend={site.uptime.scoreTrend} />
          <HostSpark log={log} host={site.host} />
        </div>
      </CardContent>

      <Separator className="bg-white/5" />

      <CardFooter className="flex items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-1">
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2.5 text-xs text-zinc-400 hover:text-emerald-400"
          >
            <a href={`https://${site.host}`} target="_blank" rel="noreferrer">
              <Globe className="h-3.5 w-3.5" /> Live
            </a>
          </Button>
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2.5 text-xs text-zinc-400 hover:text-emerald-400"
          >
            <a
              href={`https://github.com/abbdelhadylh30-art/${site.repo}`}
              target="_blank"
              rel="noreferrer"
            >
              <Github className="h-3.5 w-3.5" /> Repo
            </a>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onAudit(site.id)}
            aria-label={`Open SEO audit for ${site.label}`}
            className="h-8 gap-1.5 px-2.5 text-xs text-zinc-400 hover:bg-emerald-500/10 hover:text-emerald-400 focus-visible:ring-emerald-500/50"
          >
            <Gauge className="h-3.5 w-3.5" /> Audit
          </Button>
        </div>
        <Button
          size="sm"
          disabled={busy || !h.keyOk}
          onClick={() => onSubmit(site.host)}
          className="h-8 gap-1.5 rounded-lg bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-400 shadow-none ring-1 ring-emerald-500/25 transition-all hover:bg-emerald-500/25 hover:text-emerald-300 disabled:opacity-40"
        >
          {busy ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          IndexNow
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Per-site uptime bars (history from server-side checks) ────────────────

function UptimeBars({ uptime }: { uptime: SiteUptime }) {
  const bars = uptime.recent;
  // H3: honest label — the percentage covers the rollup window (up to 30d),
  // not just the raw samples behind the bars (last ~hour).
  const label =
    uptime.checked > 0
      ? `${uptime.pct}% uptime · ${uptime.windowDays ? `${uptime.windowDays}d · ` : ""}${uptime.checked} checks`
      : "No checks recorded yet";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center gap-1.5"
          role="img"
          aria-label={label}
        >
          <HeartPulse className="h-3 w-3 text-zinc-600" />
          <span className="flex items-center gap-[2px]">
            {bars.length > 0 ? (
              bars.map((ok, i) => (
                <span
                  key={i}
                  className={`w-[3px] rounded-[1px] transition-colors ${
                    ok
                      ? "bg-emerald-500/80"
                      : "h-3 bg-rose-500 shadow-[0_0_4px] shadow-rose-500/60"
                  }`}
                  style={{ height: ok ? 7 : undefined }}
                />
              ))
            ) : (
              <span className="h-[7px] w-[3px] rounded-[1px] bg-white/10" />
            )}
          </span>
          <span className="text-[10px] tabular-nums text-zinc-500">
            {uptime.checked > 0 ? `${uptime.pct}%` : "—"}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="border border-white/10 bg-zinc-900 text-zinc-200"
      >
        <span className="font-semibold">{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Per-host 7-day IndexNow sparkline ──────────────────────────────────────

function HostSpark({ log, host }: { log: LogEntry[]; host: string }) {
  const { days, total } = useMemo(() => {
    const entries = log ?? [];
    const buckets: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      buckets.push(
        entries
          .filter((e) => {
            const t = new Date(e.ts);
            return e.ok && e.host === host && t >= d && t < next;
          })
          .reduce((s, e) => s + e.urls, 0),
      );
    }
    return { days: buckets, total: buckets.reduce((a, b) => a + b, 0) };
  }, [log, host]);

  const max = Math.max(...days, 1);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center gap-1.5"
          role="img"
          aria-label={`${total} URLs submitted for ${host} in the last 7 days`}
        >
          <span className="text-[10px] tabular-nums text-zinc-500">
            {total}
          </span>
          <span className="flex items-end gap-[2px]">
            {days.map((urls, i) => (
              <span
                key={i}
                className={`w-[3px] rounded-[1px] ${
                  urls > 0 ? "bg-emerald-400" : "bg-white/10"
                }`}
                style={{ height: `${Math.max((urls / max) * 11, 3)}px` }}
              />
            ))}
          </span>
          <Send className="h-2.5 w-2.5 text-zinc-600" />
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="border border-white/10 bg-zinc-900 text-zinc-200"
      >
        <span className="font-semibold">
          {total} URL{total === 1 ? "" : "s"} submitted
        </span>
        <span className="text-zinc-500"> · this host · last 7 days</span>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Per-site score history sparkline (from stored uptime samples) ────────────

function ScoreSpark({ scores }: { scores: number[] }) {
  const pts = (scores ?? []).filter((n) => Number.isFinite(n));
  const enough = pts.length >= 2;
  const min = enough ? Math.min(...pts) : 0;
  const max = enough ? Math.max(...pts) : 0;
  const flat = enough && min === max;
  const up = enough && pts[pts.length - 1] > pts[0];
  const W = 54;
  const H = 14;
  const path = enough
    ? pts
        .map((v, i) => {
          const x = (i / (pts.length - 1)) * (W - 2) + 1;
          const y =
            min === max ? H / 2 : H - 2 - ((v - min) / (max - min)) * (H - 4);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ")
    : "";
  const color = !enough || flat ? "#71717a" : up ? "#34d399" : "#fb7185";
  const label = enough
    ? `Score history ${pts[0]} → ${pts[pts.length - 1]} over last ${pts.length} checks`
    : "Score history builds as rechecks accumulate";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="img"
          aria-label={label}
          className="hidden items-center gap-1 sm:flex"
        >
          <Gauge className="h-2.5 w-2.5 text-zinc-600" />
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="overflow-visible"
          >
            {enough ? (
              <polyline
                points={path}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.9}
              />
            ) : (
              <line
                x1={1}
                y1={H / 2}
                x2={W - 1}
                y2={H / 2}
                stroke="#3f3f46"
                strokeWidth={1.5}
                strokeDasharray="2 3"
                strokeLinecap="round"
              />
            )}
          </svg>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="border border-white/10 bg-zinc-900 text-zinc-200"
      >
        <span className="font-semibold">
          {enough ? `Score ${pts[0]} → ${pts[pts.length - 1]}` : "Collecting history"}
        </span>
        <span className="text-zinc-500"> · last {Math.max(pts.length, 1)} checks</span>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Per-site SEO score trend delta ─────────────────────────────────────────────

function ScoreDelta({ trend }: { trend: SiteUptime["scoreTrend"] }) {
  if (trend.first === null || trend.delta === 0) return null;
  const up = trend.delta > 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={`SEO score ${up ? "up" : "down"} ${Math.abs(trend.delta)} points since first check`}
          className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ${
            up
              ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
              : "bg-rose-500/10 text-rose-400 ring-rose-500/20"
          }`}
        >
          {up ? "▲" : "▼"}
          {Math.abs(trend.delta)}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="border border-white/10 bg-zinc-900 text-zinc-200"
      >
        <span className="font-semibold">
          SEO score {up ? "+" : ""}
          {trend.delta} since first check
        </span>
        <span className="text-zinc-500">
          {" "}
          ({trend.first} → {trend.current})
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
