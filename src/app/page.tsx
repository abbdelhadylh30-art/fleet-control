"use client";

// Fleet overview page — composition only (L4, 2026-09-21): the 1766-line
// monolith was decomposed into section components under components/fleet/.
// This file keeps the data layer (fetch/poll/actions) and the page skeleton.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  FileText,
  Globe,
  HeartPulse,
  Link2,
  Radar,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Timer,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { AuditSheet, ScoreRing } from "@/components/audit-sheet";
import { AppShell } from "@/components/app-shell";
import { StatCard } from "@/components/fleet/stat-card";
import { SiteCard } from "@/components/fleet/site-card";
import { PriorityActions } from "@/components/fleet/priority-actions";
import { FleetTrend } from "@/components/fleet/fleet-trend";
import { IncidentBanner, RecentIncidents } from "@/components/fleet/incidents";
import { StateLayerChip } from "@/components/fleet/state-layer-chip";
import { relativeTime } from "@/components/fleet/relative-time";
import {
  downloadFile,
  fleetMarkdownSummary,
  fleetTimestamp,
  fleetToCsv,
} from "@/lib/export";
import { FLEET, type FleetResponse, type FleetSiteStatus, type SiteGroup } from "@/lib/fleet";
import type { LogEntry } from "@/lib/activity-log";

const GROUPS: Array<"all" | SiteGroup> = [
  "all",
  "Client Sites",
  "Tools & Apps",
  "Portfolio",
];

type FleetData = FleetResponse;

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
      const json = (await res.json()) as FleetData;
      // shape guard (2026-09-21): an anonymous/unauthenticated response is the
      // reduced aggregate (no sites/summary.attention) — never let it into
      // state, the dashboard render assumes the full payload.
      if (!json || !Array.isArray(json.sites) || !json.summary || !Array.isArray(json.summary.attention)) {
        throw new Error("Unexpected fleet payload shape");
      }
      setData(json);
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
  // optional chaining: defense in depth — the payload is shape-guarded at the
  // fetch boundary, this must never see a reduced/anonymous payload again
  const attention = data?.summary?.attention?.length ?? 0;
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
          uptime {data ? `${data.summary.uptimePct}%${data.summary.uptimeWindowDays ? ` (${data.summary.uptimeWindowDays}d)` : ""}` : "—"} · auto-refresh{" "}
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
                    100% uptime{data.summary.uptimeWindowDays ? ` · ${data.summary.uptimeWindowDays}d` : ""}
                  </span>
                ) : data ? (
                  <span className="hidden items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 ring-1 ring-amber-500/20 lg:inline-flex">
                    <HeartPulse className="h-3 w-3" />
                    {data.summary.uptimePct}% uptime{data.summary.uptimeWindowDays ? ` · ${data.summary.uptimeWindowDays}d` : ""}
                  </span>
                ) : null}
              </h1>
              <p className="truncate text-[11px] text-zinc-500">
                abdelhadygabriel.me · {data?.summary.total ?? FLEET.length} sites · IndexNow pipeline
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
            sub={`of ${data?.summary.total ?? FLEET.length} sites`}
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
            <div className="flex flex-wrap items-center gap-2">
              {data ? (
                <span className="text-[11px] text-zinc-600">
                  checked {relativeTime(data.checkedAt)}
                  {data.cached ? " · cached" : ""}
                </span>
              ) : null}
              <StateLayerChip layer={data?.stateLayer} />
            </div>
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
