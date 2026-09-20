"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  Gauge,
  Github,
  Globe,
  HeartPulse,
  KeyRound,
  Link2,
  ListChecks,
  Radar,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Timer,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AuditSheet, ScoreRing } from "@/components/audit-sheet";
import { AppShell } from "@/components/app-shell";
import { copyText } from "@/lib/copy";
import {
  downloadFile,
  fleetMarkdownSummary,
  fleetTimestamp,
  fleetToCsv,
} from "@/lib/export";
import type {
  FleetResponse,
  FleetSiteStatus,
  SiteGroup,
  SiteUptime,
  VerifyStatus,
} from "@/lib/fleet";
import type { LogEntry } from "@/lib/activity-log";

const DOMAIN_PROPERTY = "abdelhadygabriel.me";
const GROUPS: Array<"all" | SiteGroup> = [
  "all",
  "Client Sites",
  "Tools & Apps",
  "Portfolio",
];

type FleetData = FleetResponse;

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Animated count-up number ───────────────────────────────────────────────────

function AnimatedNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = value;
    const start = performance.now();
    const dur = from === value ? 0 : 650;
    let raf = 0;
    const tick = (now: number) => {
      const p = dur === 0 ? 1 : Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className={className} aria-label={`${value}`}>
      {display}
    </span>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone: "emerald" | "amber" | "zinc" | "rose";
  loading?: boolean;
}) {
  const tones = {
    emerald: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 ring-amber-500/20",
    zinc: "text-zinc-300 bg-zinc-500/10 ring-zinc-500/20",
    rose: "text-rose-400 bg-rose-500/10 ring-rose-500/20",
  } as const;
  const values = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    zinc: "text-zinc-100",
    rose: "text-rose-300",
  } as const;
  return (
    <Card className="group border-white/5 bg-zinc-900/60 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-white/10 hover:shadow-lg hover:shadow-black/40 focus-within:ring-2 focus-within:ring-emerald-500/40">
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110 ${tones[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          {loading ? (
            <>
              <Skeleton className="mb-1.5 h-7 w-14 bg-white/10" />
              <Skeleton className="h-3.5 w-24 bg-white/5" />
            </>
          ) : (
            <>
              <div
                className={`text-2xl font-semibold tracking-tight tabular-nums transition-colors ${values[tone]}`}
              >
                {/^\d+$/.test(value) ? (
                  <AnimatedNumber value={parseInt(value, 10)} />
                ) : (
                  value
                )}
              </div>
              <div className="truncate text-xs text-zinc-400">
                {label} · <span className="text-zinc-500">{sub}</span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SEO badge ───────────────────────────────────────────────────────────────

function SeoBadge({
  ok,
  icon: Icon,
  label,
  detail,
}: {
  ok: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: string;
}) {
  return (
    <span
      title={ok ? `${label}: OK` : `${label}: missing`}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 transition-colors ${
        ok
          ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
          : "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20"
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
      {detail ? <span className="text-zinc-500">{detail}</span> : null}
    </span>
  );
}

// ─── Site card ───────────────────────────────────────────────────────────────

function SiteCard({
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
  const label =
    uptime.checked > 0
      ? `${uptime.pct}% uptime · last ${uptime.checked} checks`
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

// ─── Priority actions — auto-generated fix plan ─────────────────────────────

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

function PriorityActions({
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

// ─── Fleet avg score trend — area sparkline over stored fresh checks ────────

function FleetTrend({ trend }: { trend: FleetData["trend"] }) {
  const pts = (trend ?? []).filter((p) => Number.isFinite(p?.avg));
  const W = 160;
  const H = 30;

  // NOTE: computed BEFORE `tooltip`/early-return — `tooltip` closes over
  // `label`, and on fresh instances (empty history) the early-return path
  // runs first; a late declaration would be a TDZ crash in production.
  const avgs = pts.map((p) => p.avg);
  const min = Math.min(...avgs);
  const max = Math.max(...avgs);
  const hasTrend = pts.length >= 2;
  const label = hasTrend
    ? `Fleet avg ${avgs[0]} → ${avgs[avgs.length - 1]} · min ${min} · max ${max} · last ${pts.length} fresh checks`
    : "Fleet score trend — builds with each fresh check";

  const tooltip = (children: React.ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <div role="img" aria-label={label} className="cursor-default">
          {children}
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

  if (!hasTrend) {
    return tooltip(
      <div className="mt-1.5 flex items-center gap-2">
        <svg width={W} height={14} viewBox={`0 0 ${W} 14`}>
          <line
            x1={1}
            y1={7}
            x2={W - 1}
            y2={7}
            stroke="#3f3f46"
            strokeWidth={1.5}
            strokeDasharray="2 3"
            strokeLinecap="round"
          />
        </svg>
        <span className="whitespace-nowrap text-[9px] text-zinc-600">
          trend builds with each fresh check
        </span>
      </div>,
    );
  }

  const lo = Math.max(0, min - 4);
  const hi = Math.min(100, max + 4);
  const span = Math.max(hi - lo, 1);
  const coords = avgs.map((v, i) => ({
    x: (i / (pts.length - 1)) * (W - 2) + 1,
    y: H - 2 - ((v - lo) / span) * (H - 8),
  }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `1,${H - 1} ${line} ${W - 1},${H - 1}`;
  const up = avgs[avgs.length - 1] >= avgs[0];
  const stroke = up ? "#34d399" : "#fb7185";
  const last = coords[coords.length - 1];

  return tooltip(
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="mt-1.5 overflow-visible"
    >
      <defs>
        <linearGradient id="fleet-trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#fleet-trend-fill)" />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={2.2} fill={stroke}>
        <animate
          attributeName="opacity"
          values="1;0.35;1"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>,
  );
}

// ─── Active downtime incidents banner ───────────────────────────────────────────

function durationSince(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function IncidentBanner({ incidents }: { incidents: FleetResponse["incidents"] }) {
  if (!incidents || incidents.active.length === 0) return null;
  return (
    <section aria-label="Active incidents">
      <div className="fade-up-item relative overflow-hidden rounded-2xl border border-rose-500/25 bg-rose-500/[0.05] p-4 sm:p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(40rem 16rem at 10% 0%, rgba(244,63,94,0.10), transparent 60%)",
          }}
        />
        <div className="relative mb-2 flex items-center gap-2 text-sm font-semibold text-rose-400">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          </span>
          {incidents.active.length} site
          {incidents.active.length === 1 ? "" : "s"} down — incident in progress
        </div>
        <ul className="relative grid gap-1.5 text-xs text-rose-300/90 sm:grid-cols-2">
          {incidents.active.map((i) => (
            <li key={i.host} className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-rose-400" />
              <span className="font-mono text-rose-200">{i.host}</span>
              <span className="text-rose-400/70">
                down {durationSince(i.startedAt)} · {i.checks} failed check
                {i.checks === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── Recently resolved incidents strip ──────────────────────────────────────

function RecentIncidents({
  recent,
}: {
  recent: FleetResponse["incidents"]["recent"];
}) {
  if (!recent?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/70" />
      <span className="font-medium text-zinc-400">Resolved:</span>
      {recent.slice(0, 4).map((i) => (
        <span
          key={`${i.host}-${i.startedAt}`}
          className="rounded-md bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400 ring-1 ring-white/5 transition-colors hover:text-zinc-200"
        >
          {i.host} · back {i.recoveredAt ? relativeTime(i.recoveredAt) : "—"}
        </span>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec] = useState(60);
  const [submittingAll, setSubmittingAll] = useState(false);
  const [busyHost, setBusyHost] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const autoRef = useRef(autoRefresh);
  autoRef.current = autoRefresh;
  const searchRef = useRef<HTMLInputElement>(null);
  const incidentsRef = useRef<Map<string, string> | null>(null);
  const fleetErrorRef = useRef(false); // dedupe auto-refresh failure toasts

  // restore persisted refresh interval (after mount — avoids SSR mismatch)
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem("fleet-refresh-sec"));
      if (saved === 30 || saved === 60 || saved === 120 || saved === 300)
        setRefreshSec(saved);
    } catch {
      /* private mode — default stays */
    }
  }, []);

  const changeRefreshSec = useCallback((s: number) => {
    setRefreshSec(s);
    try {
      window.localStorage.setItem("fleet-refresh-sec", String(s));
    } catch {
      /* non-fatal */
    }
  }, []);

  // incident toasts — fire when a host goes down / recovers between checks
  useEffect(() => {
    const active = data?.incidents?.active ?? [];
    const cur = new Map(active.map((i) => [i.host, i.startedAt]));
    const prev = incidentsRef.current;
    if (prev) {
      for (const [host, startedAt] of cur) {
        if (!prev.has(host)) {
          toast.error(`${host} is down`, {
            description: `Incident started ${relativeTime(startedAt)} — watch the banner for updates.`,
            duration: 10000,
          });
        }
      }
      for (const host of prev.keys()) {
        if (!cur.has(host)) {
          toast.success(`${host} recovered`, {
            description: "Back online — uptime history updated.",
          });
        }
      }
    }
    incidentsRef.current = cur;
  }, [data?.incidents]);

  const loadFleet = useCallback(async (force = false, manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch(`/api/fleet${force ? "?force=1" : ""}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      setData((await res.json()) as FleetData);
      if (fleetErrorRef.current) {
        fleetErrorRef.current = false;
        toast.success("Fleet status back online");
      }
    } catch {
      // auto-refresh failures stay quiet after the first notice
      if (manual || !fleetErrorRef.current)
        toast.error("Failed to load fleet status");
      fleetErrorRef.current = true;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadLog = useCallback(async () => {
    try {
      const res = await fetch("/api/indexnow");
      if (res.ok) {
        const json = (await res.json()) as { entries: LogEntry[] };
        setLog(json.entries);
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void loadFleet();
    void loadLog();
  }, [loadFleet, loadLog]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      void loadFleet();
      void loadLog();
    }, refreshSec * 1000);
    return () => clearInterval(t);
  }, [autoRefresh, refreshSec, loadFleet, loadLog]);

  // keyboard shortcuts: "/" focus search · "r" force recheck
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key.toLowerCase() === "r") {
        void loadFleet(true, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadFleet]);

  const submitIndexNow = useCallback(
    async (host?: string) => {
      const all = !host;
      if (all) setSubmittingAll(true);
      else setBusyHost(host);
      const t = toast.loading(
        all ? "Submitting all hosts to IndexNow…" : `Submitting ${host}…`,
      );
      try {
        const res = await fetch("/api/indexnow", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ host: all ? "all" : host }),
        });
        const json = (await res.json()) as {
          results?: LogEntry[];
          error?: string;
        };
        if (!res.ok || json.error)
          throw new Error(json.error ?? `API ${res.status}`);
        const results = json.results ?? [];
        const okCount = results.filter((r) => r.ok).length;
        const urls = results.reduce((s, r) => s + r.urls, 0);
        if (okCount === results.length && results.length > 0) {
          toast.success(
            `IndexNow accepted ${okCount}/${results.length} hosts · ${urls} URLs`,
            { id: t },
          );
        } else if (okCount > 0) {
          toast.warning(
            `${okCount}/${results.length} hosts accepted — rest blocked (key file not live)`,
            {
              id: t,
              description: results
                .filter((r) => !r.ok)
                .map((r) => r.host)
                .join(", "),
            },
          );
        } else {
          toast.error("No host could be submitted", {
            id: t,
            description: results[0]?.reason,
          });
        }
        await Promise.all([loadFleet(true), loadLog()]);
      } catch (e) {
        toast.error("Submission failed", {
          id: t,
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        setSubmittingAll(false);
        setBusyHost(null);
      }
    },
    [loadFleet, loadLog],
  );

  const sites = data?.sites ?? [];
  const blockers = sites.filter((s) => s.blocker);
  const attention = data ? data.summary.attention.length : 0;
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [sort, setSort] = useState<string>("score");
  const [auditId, setAuditId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = sites.filter(
      (s) =>
        (group === "all" || s.group === group) &&
        (query.trim() === "" ||
          `${s.label} ${s.host} ${s.description} ${s.repo}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    );
    const statusRank = (s: FleetSiteStatus) =>
      s.health.httpStatus !== 200 ? 2 : s.health.robotsOk && s.health.sitemapOk && s.health.keyOk ? 0 : 1;
    switch (sort) {
      case "name":
        return [...list].sort((a, b) => a.label.localeCompare(b.label));
      case "status":
        return [...list].sort(
          (a, b) =>
            statusRank(a) - statusRank(b) ||
            (b.health.audit?.seoScore ?? 0) - (a.health.audit?.seoScore ?? 0),
        );
      default:
        return [...list].sort(
          (a, b) => (b.health.audit?.seoScore ?? 0) - (a.health.audit?.seoScore ?? 0),
        );
    }
  }, [sites, group, query, sort]);

  const auditSite = sites.find((s) => s.id === auditId) ?? null;

  const handleExport = useCallback(
    (format: "json" | "csv" | "md") => {
      if (!data) return;
      const ts = fleetTimestamp();
      try {
        if (format === "json") {
          downloadFile(
            `fleet-report-${ts}.json`,
            JSON.stringify(data, null, 2),
            "application/json",
          );
        } else if (format === "csv") {
          downloadFile(
            `fleet-report-${ts}.csv`,
            fleetToCsv(data.sites),
            "text/csv",
          );
        } else {
          downloadFile(
            `fleet-summary-${ts}.md`,
            fleetMarkdownSummary(data),
            "text/markdown",
          );
        }
        toast.success(`Fleet report exported (${format.toUpperCase()})`);
      } catch {
        toast.error("Export failed");
      }
    },
    [data],
  );

  const canonicalCount = sites.filter((s) => s.health.canonicalOk).length;
  const ogCount = sites.filter((s) => s.health.ogOk).length;

  return (
    <AppShell
      footerExtra={
        <span className="font-mono">
          uptime {data ? `${data.summary.uptimePct}%` : "—"} · auto-refresh{" "}
          {autoRefresh ? `every ${refreshSec}s` : "off"}
        </span>
      }
    >
      {/* ambient background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60rem 32rem at 15% -10%, rgba(16,185,129,0.09), transparent 60%), radial-gradient(50rem 30rem at 90% 0%, rgba(245,158,11,0.06), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 opacity-[0.35]"
      />

      <Toaster position="bottom-right" richColors closeButton theme="dark" />

      {/* header */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0a0c10]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/20">
              <Radar className="h-5 w-5 text-emerald-950" />
            </div>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 truncate text-base font-semibold leading-tight tracking-tight">
                Fleet Control
                <span className="hidden items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/20 sm:inline-flex">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-400" />
                  live
                </span>
                {data && data.summary.uptimePct === 100 ? (
                  <span className="hidden items-center gap-1 rounded-full bg-emerald-500/5 px-2 py-0.5 text-[10px] font-medium text-emerald-500/80 ring-1 ring-emerald-500/15 lg:inline-flex">
                    <HeartPulse className="h-3 w-3" />
                    100% uptime
                  </span>
                ) : data ? (
                  <span className="hidden items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 ring-1 ring-amber-500/20 lg:inline-flex">
                    <HeartPulse className="h-3 w-3" />
                    {data.summary.uptimePct}% uptime
                  </span>
                ) : null}
              </h1>
              <p className="truncate text-[11px] text-zinc-500">
                abdelhadygabriel.me · {data?.summary.total ?? 14} sites · IndexNow pipeline
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 md:flex">
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                Auto
                <Switch
                  checked={autoRefresh}
                  onCheckedChange={setAutoRefresh}
                  aria-label="Toggle auto refresh"
                />
              </label>
              <Select
                value={String(refreshSec)}
                onValueChange={(v) => changeRefreshSec(Number(v))}
                disabled={!autoRefresh}
              >
                <SelectTrigger
                  aria-label="Auto refresh interval"
                  className="h-8 w-[4.7rem] gap-1 border-white/10 bg-white/[0.03] px-2.5 text-[11px] text-zinc-300 focus-visible:ring-emerald-500/40 data-[disabled]:opacity-50"
                >
                  <Timer className="h-3 w-3 text-zinc-500" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-zinc-900 text-zinc-200">
                  <SelectItem value="30" className="text-xs">
                    30s
                  </SelectItem>
                  <SelectItem value="60" className="text-xs">
                    60s
                  </SelectItem>
                  <SelectItem value="120" className="text-xs">
                    2m
                  </SelectItem>
                  <SelectItem value="300" className="text-xs">
                    5m
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={() => void loadFleet(true, true)}
              className="h-9 gap-1.5 border-white/10 bg-transparent text-xs hover:bg-white/5 hover:text-zinc-100 focus-visible:ring-emerald-500/50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">Recheck</span>
            </Button>
            <Button
              size="sm"
              disabled={submittingAll}
              onClick={() => void submitIndexNow()}
              className="h-9 gap-1.5 bg-emerald-500 text-xs font-semibold text-emerald-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 focus-visible:ring-emerald-500/50"
            >
              {submittingAll ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Submit all</span>
              <span className="sm:hidden">All</span>
            </Button>
          </div>
        </div>
        {/* thin refresh progress line along the header's bottom edge */}
        {refreshing ? (
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
          >
            <div className="loading-bar h-full w-1/3 bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
          </div>
        ) : null}
      </header>

      <main className="relative mx-auto w-full max-w-7xl flex-1 space-y-8 px-4 py-8 sm:px-6">
        {/* stats */}
        <section
          aria-label="Fleet summary"
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          <StatCard
            icon={Globe}
            label="live"
            sub={`of ${data?.summary.total ?? 13} sites`}
            value={data ? `${data.summary.live}` : "—"}
            tone="emerald"
            loading={loading}
          />
          <StatCard
            icon={ShieldCheck}
            label="SEO-armed"
            sub="robots+sitemap+key"
            value={data ? `${data.summary.seoArmed}` : "—"}
            tone="emerald"
            loading={loading}
          />
          <StatCard
            icon={Send}
            label="URLs submitted"
            sub="via IndexNow"
            value={data ? `${data.summary.urlsSubmitted}` : "—"}
            tone="zinc"
            loading={loading}
          />
          <StatCard
            icon={AlertTriangle}
            label="need attention"
            sub="blockers / down"
            value={data ? `${attention}` : "—"}
            tone={attention > 0 ? "amber" : "emerald"}
            loading={loading}
          />
        </section>

        {/* SEO depth coverage */}
        {!loading && sites.length > 0 ? (
          <section aria-label="SEO depth">
            <Card className="border-white/5 bg-zinc-900/60 backdrop-blur transition-colors hover:border-white/10">
              <CardContent className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-zinc-300">
                      <Link2 className="h-3.5 w-3.5 text-emerald-400" />
                      Canonical tag coverage
                    </span>
                    <span className="tabular-nums text-zinc-500">
                      {canonicalCount}/{sites.length}
                    </span>
                  </div>
                  <Progress
                    value={(canonicalCount / sites.length) * 100}
                    className="h-2 bg-white/5 [&>[data-slot=progress-indicator]]:bg-gradient-to-r [&>[data-slot=progress-indicator]]:from-emerald-600 [&>[data-slot=progress-indicator]]:to-emerald-400"
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-zinc-300">
                      <ExternalLink className="h-3.5 w-3.5 text-emerald-400" />
                      OpenGraph coverage
                    </span>
                    <span className="tabular-nums text-zinc-500">
                      {ogCount}/{sites.length}
                    </span>
                  </div>
                  <Progress
                    value={(ogCount / sites.length) * 100}
                    className="h-2 bg-white/5 [&>[data-slot=progress-indicator]]:bg-gradient-to-r [&>[data-slot=progress-indicator]]:from-emerald-600 [&>[data-slot=progress-indicator]]:to-emerald-400"
                  />
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] px-4 py-2 ring-1 ring-white/5">
                  <ScoreRing score={data?.summary.avgScore ?? 0} size={46} stroke={4} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-zinc-300">
                      Fleet avg score
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      weighted audit · live sites
                    </div>
                    <FleetTrend trend={data?.trend ?? []} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {/* incidents */}
        {!loading &&
        ((data?.incidents?.active.length ?? 0) > 0 ||
          (data?.incidents?.recent.length ?? 0) > 0) ? (
          <section aria-label="Incidents" className="space-y-3">
            <IncidentBanner
              incidents={data?.incidents ?? { active: [], recent: [] }}
            />
            <RecentIncidents
              recent={data?.incidents?.recent ?? []}
            />
          </section>
        ) : null}

        {/* priority actions */}
        {!loading && sites.length > 0 ? (
          <section aria-label="Priority actions">
            <PriorityActions sites={sites} onAudit={(id) => setAuditId(id)} />
          </section>
        ) : null}

        {/* blockers banner */}
        {!loading && blockers.length > 0 ? (
          <section aria-label="Needs attention">
            <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.04] p-4 transition-colors hover:border-amber-500/25 sm:p-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                {blockers.length} sites need a Vercel dashboard fix
              </div>
              <ul className="grid gap-1.5 text-xs text-amber-400/80 sm:grid-cols-2">
                {blockers.map((s) => (
                  <li key={s.id} className="flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                    <span>
                      <span className="font-mono text-amber-300">{s.host}</span>{" "}
                      — {s.blocker}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* sites grid */}
        <section aria-label="Sites">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              <Globe className="h-4 w-4 text-emerald-400" />
              Fleet sites
              {!loading ? (
                <span className="text-zinc-600 normal-case">
                  ({filtered.length})
                </span>
              ) : null}
            </h2>
            {data ? (
              <span className="text-[11px] text-zinc-600">
                checked {relativeTime(data.checkedAt)}
                {data.cached ? " · cached" : ""}
              </span>
            ) : null}
          </div>

          {/* filters */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {GROUPS.map((g) => {
                const count =
                  g === "all"
                    ? sites.length
                    : sites.filter((s) => s.group === g).length;
                const active = group === g;
                return (
                  <button
                    key={g}
                    onClick={() => setGroup(g)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                      active
                        ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                        : "bg-white/[0.03] text-zinc-400 ring-white/10 hover:bg-white/[0.06] hover:text-zinc-200"
                    }`}
                  >
                    {g === "all" ? "All sites" : g}
                    <span
                      className={`ml-1.5 tabular-nums ${active ? "text-emerald-400/70" : "text-zinc-600"}`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {/* sort */}
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger
                  aria-label="Sort sites"
                  className="h-9 w-[9.5rem] border-white/10 bg-white/[0.03] text-xs text-zinc-300 focus-visible:ring-emerald-500/40"
                >
                  <ArrowDownWideNarrow className="h-3.5 w-3.5 text-zinc-500" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-zinc-900 text-zinc-200">
                  <SelectItem value="score" className="text-xs">
                    SEO score ↓
                  </SelectItem>
                  <SelectItem value="status" className="text-xs">
                    Status first
                  </SelectItem>
                  <SelectItem value="name" className="text-xs">
                    Name A→Z
                  </SelectItem>
                </SelectContent>
              </Select>
              {/* export */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    aria-label="Export fleet report"
                    className="h-9 gap-1.5 border-white/10 bg-transparent text-xs hover:bg-white/5 hover:text-zinc-100 focus-visible:ring-emerald-500/50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="border-white/10 bg-zinc-900 text-zinc-200"
                >
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Fleet report
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => handleExport("json")}
                    className="gap-2 text-xs focus:bg-emerald-500/10 focus:text-emerald-300"
                  >
                    <FileJson className="h-3.5 w-3.5" /> JSON · full audit data
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleExport("csv")}
                    className="gap-2 text-xs focus:bg-emerald-500/10 focus:text-emerald-300"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" /> CSV · spreadsheet
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/5" />
                  <DropdownMenuItem
                    onClick={() => handleExport("md")}
                    className="gap-2 text-xs focus:bg-emerald-500/10 focus:text-emerald-300"
                  >
                    <FileText className="h-3.5 w-3.5" /> Markdown · summary
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* search */}
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search sites, repos, hosts… ( / )"
                  aria-label="Search sites, repos and hosts"
                  className="h-9 border-white/10 bg-white/[0.03] pl-9 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/40"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <Card
                    key={i}
                    className="border-white/5 bg-zinc-900/60 p-5 backdrop-blur"
                  >
                    <Skeleton className="mb-3 h-5 w-32 bg-white/10" />
                    <Skeleton className="mb-4 h-3 w-44 bg-white/5" />
                    <Skeleton className="mb-2 h-3 w-full bg-white/5" />
                    <Skeleton className="h-3 w-2/3 bg-white/5" />
                  </Card>
                ))
              : filtered.map((s, i) => (
                  <SiteCard
                    key={s.id}
                    site={s}
                    busy={busyHost === s.host || submittingAll}
                    onSubmit={(host) => void submitIndexNow(host)}
                    onAudit={(id) => setAuditId(id)}
                    log={log}
                    index={i}
                  />
                ))}
          </div>
          {!loading && filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 py-12 text-center">
              <Search className="h-6 w-6 text-zinc-700" />
              <p className="text-sm text-zinc-500">
                No sites match “{query}”
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setGroup("all");
                }}
                className="text-xs text-emerald-400 hover:bg-emerald-500/10"
              >
                Clear filters
              </Button>
            </div>
          ) : null}
        </section>

      </main>

      {/* per-site SEO audit sheet */}
      <AuditSheet
        site={auditSite}
        open={!!auditSite}
        onOpenChange={(o) => {
          if (!o) setAuditId(null);
        }}
        onSubmit={(host) => void submitIndexNow(host)}
        busy={busyHost === auditSite?.host || submittingAll}
      />

    </AppShell>
  );
}
