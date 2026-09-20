"use client";

// ─── /analytics — full fleet analytics + auto-pilot control room ────────────
// Aggregates: score history trend, uptime per host, IndexNow submissions,
// downtime incidents, Vercel production deployments, GitHub repo activity —
// plus the auto-pilot master switch and its most recent self-heal actions.

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  Gauge,
  Loader2,
  RefreshCcw,
  Rocket,
  Send,
  ShieldCheck,
  Timer,
  XCircle,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { AnalyticsResponse } from "@/lib/analytics";
import { FLEET } from "@/lib/fleet";

function relativeTime(t: number | string | null | undefined): string {
  if (!t) return "—";
  const diff = Date.now() - new Date(t).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const scoreToneClass = (score: number): string =>
  score >= 80
    ? "text-emerald-300"
    : score >= 50
      ? "text-amber-300"
      : "text-rose-300";

function deployStateClass(state: string): string {
  if (state === "READY") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (["BUILDING", "QUEUED", "INITIALIZING"].includes(state))
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-rose-500/30 bg-rose-500/10 text-rose-300";
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone = "emerald",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "emerald" | "amber" | "rose" | "zinc";
}) {
  const toneMap = {
    emerald: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/20",
    amber: "text-amber-300 bg-amber-500/10 ring-amber-500/20",
    rose: "text-rose-300 bg-rose-500/10 ring-rose-500/20",
    zinc: "text-zinc-300 bg-white/5 ring-white/10",
  } as const;
  return (
    <Card className="border-white/5 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${toneMap[tone]}`}>
          {icon}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {label}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] text-zinc-600">{sub}</div> : null}
    </Card>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoHeal, setAutoHeal] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch("/api/analytics", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as AnalyticsResponse;
        setData(json);
        setAutoHeal(json.autopilot.config.autoHeal);
      }
    } catch {
      /* keep previous data */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateAutoHeal = async (v: boolean) => {
    setToggling(true);
    const prev = autoHeal;
    setAutoHeal(v); // optimistic
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set", autoHeal: v }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { toast } = await import("sonner");
      toast.success(v ? "Auto-pilot armed — the fleet heals itself" : "Auto-pilot disarmed");
    } catch {
      setAutoHeal(prev);
      const { toast } = await import("sonner");
      toast.error("Could not update auto-pilot");
    } finally {
      setToggling(false);
    }
  };

  const scoreData = (data?.scoreHistory ?? []).map((p) => ({
    ...p,
    label: new Date(p.t).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }),
  }));
  const latestAvg = scoreData.length ? scoreData[scoreData.length - 1].avg : null;
  const firstAvg = scoreData.length ? scoreData[0].avg : null;
  const scoreDelta = latestAvg !== null && firstAvg !== null ? latestAvg - firstAvg : 0;

  const liveSites = FLEET.filter((s) => {
    const u = data?.uptimeByHost[s.host];
    return u ? u.lastAt !== null && Date.now() - u.lastAt < 60 * 60 * 1000 : false;
  });

  return (
    <AppShell>
      <main className="relative mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-100">
              <Gauge className="h-5 w-5 text-emerald-400" />
              Fleet Analytics
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {data
                ? `Aggregated ${relativeTime(data.generatedAt)} · ${FLEET.length} sites tracked`
                : "Loading fleet telemetry…"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="h-8 gap-1.5 border-white/10 bg-white/[0.04] text-xs text-zinc-200 hover:bg-white/[0.08]"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl bg-white/5" />
            ))}
          </div>
        ) : data ? (
          <>
            {/* ── AUTO-PILOT ─────────────────────────────────────────── */}
            <Card className="border-white/5 bg-white/[0.02]">
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
                  <Bot className="h-4 w-4 text-sky-300" />
                  Auto-pilot
                  <Badge
                    variant="outline"
                    className={`ml-1 text-[9px] ${
                      autoHeal
                        ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                        : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
                    }`}
                  >
                    {autoHeal ? "ARMED" : "OFF"}
                  </Badge>
                  <span className="ml-auto flex items-center gap-2 text-[10px] font-normal text-zinc-500">
                    {toggling ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    heals on every fleet check
                    <Switch
                      checked={autoHeal}
                      disabled={toggling}
                      onCheckedChange={(v) => void updateAutoHeal(v)}
                      aria-label="Toggle auto-pilot self-healing"
                    />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  On every fresh check the pilot <span className="text-zinc-300">re-attaches</span> fleet
                  domains that point at a stale project and{" "}
                  <span className="text-zinc-300">redeploys</span> down sites from GitHub main — never
                  while a deployment is already building, and at most once per project every 3h.
                  IndexNow auto-submission stays armed separately on the overview.
                </p>
                {data.autopilot.log.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-white/5 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10">
                    <div className="divide-y divide-white/5">
                      {data.autopilot.log.map((a, i) => (
                        <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                          {a.status === "redeployed" || a.status === "reattached" ? (
                            <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
                          ) : a.status === "error" ? (
                            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                          ) : (
                            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[10px] text-zinc-300">{a.host}</span>
                              <Badge
                                variant="outline"
                                className={`text-[8px] uppercase ${
                                  a.status === "redeployed" || a.status === "reattached"
                                    ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                                    : a.status === "error"
                                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                                      : "border-white/10 bg-white/5 text-zinc-500"
                                }`}
                              >
                                {a.status}
                              </Badge>
                              {a.project ? (
                                <span className="text-[9px] text-zinc-600">{a.project}</span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                              {a.detail} · {relativeTime(a.ts)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-[10px] text-zinc-600">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    No self-heal actions yet — either everything is healthy or every down site was
                    inside its cooldown.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ── KPI ROW ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi
                icon={<Gauge className="h-3.5 w-3.5" />}
                label="avg seo score"
                value={latestAvg !== null ? String(latestAvg) : "—"}
                sub={
                  scoreDelta !== 0
                    ? `${scoreDelta > 0 ? "+" : ""}${scoreDelta} over stored history`
                    : "trend below"
                }
              />
              <Kpi
                icon={<Activity className="h-3.5 w-3.5" />}
                label="fleet uptime"
                value={`${data.fleetUptimePct}%`}
                sub={
                  Object.keys(data.uptimeByHost).length === 0
                    ? "no history on this instance yet"
                    : `${liveSites.length}/${FLEET.length} live in the last hour`
                }
              />
              <Kpi
                icon={<Send className="h-3.5 w-3.5" />}
                label="urls submitted"
                value={String(data.submissions.total)}
                sub={`${data.submissions.autoCount} auto-fired · ${data.submissions.successRate}% success`}
              />
              <Kpi
                icon={<Rocket className="h-3.5 w-3.5" />}
                label="deploys · 30d"
                value={data.vercelConnected ? String(data.deployments.count30d) : "—"}
                sub={
                  data.vercelConnected
                    ? `${data.deployments.count7d} in the last 7d`
                    : "connect Vercel to unlock"
                }
                tone={data.vercelConnected ? "emerald" : "zinc"}
              />
              <Kpi
                icon={<Timer className="h-3.5 w-3.5" />}
                label="downtime events · 7d"
                value={String(data.incidents.events7d)}
                sub={`${data.incidents.downtimeMin}min cumulative · ${data.incidents.activeNow} active now`}
                tone={data.incidents.events7d > 0 ? "amber" : "emerald"}
              />
              <Kpi
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
                label="repos active · 30d"
                value={String(
                  Object.values(data.repos).filter(
                    (r) => r.pushedAt && Date.now() - new Date(r.pushedAt).getTime() < 30 * 24 * 60 * 60 * 1000,
                  ).length,
                )}
                sub={`${Object.keys(data.repos).length} tracked on GitHub`}
              />
            </div>

            {/* ── CHARTS ─────────────────────────────────────────────── */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="border-white/5 bg-white/[0.02]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-zinc-400">
                    Fleet SEO score trend
                    <span className="ml-2 text-[10px] font-normal text-zinc-600">
                      stored fresh checks · {scoreData.length} samples
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {scoreData.length > 1 ? (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={scoreData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                          <defs>
                            <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                              <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#ffffff08" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: "#71717a", fontSize: 9 }}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={40}
                          />
                          <YAxis
                            domain={[0, 100]}
                            tick={{ fill: "#71717a", fontSize: 9 }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <ReTooltip
                            contentStyle={{
                              background: "#0a0c10",
                              border: "1px solid #ffffff14",
                              borderRadius: 8,
                              fontSize: 11,
                              color: "#e4e4e7",
                            }}
                            labelStyle={{ color: "#a1a1aa" }}
                          />
                          <Area
                            type="monotone"
                            dataKey="avg"
                            stroke="#34d399"
                            strokeWidth={1.8}
                            fill="url(#scoreFill)"
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="flex h-48 items-center justify-center text-[11px] text-zinc-600">
                      Not enough samples yet — run a fresh check from the overview.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-white/5 bg-white/[0.02]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-zinc-400">
                    IndexNow submissions · 14 days
                    <span className="ml-2 text-[10px] font-normal text-zinc-600">
                      URLs pushed to search engines per day
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.submissions.perDay} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                        <CartesianGrid stroke="#ffffff08" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: "#71717a", fontSize: 9 }}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={24}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fill: "#71717a", fontSize: 9 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <ReTooltip
                          contentStyle={{
                            background: "#0a0c10",
                            border: "1px solid #ffffff14",
                            borderRadius: 8,
                            fontSize: 11,
                            color: "#e4e4e7",
                          }}
                          labelStyle={{ color: "#a1a1aa" }}
                        />
                        <Bar
                          dataKey="urls"
                          fill="#34d399"
                          radius={[3, 3, 0, 0]}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── PER-SITE TABLE ─────────────────────────────────────── */}
            <Card className="border-white/5 bg-white/[0.02]">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-zinc-400">
                  Per-site analytics
                  <span className="ml-2 text-[10px] font-normal text-zinc-600">
                    sorted by uptime · live Vercel join when connected
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10">
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 bg-[#0a0c10] text-[9px] uppercase tracking-wider text-zinc-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">site</th>
                        <th className="px-3 py-2 font-medium">uptime</th>
                        <th className="px-3 py-2 font-medium">avg score</th>
                        <th className="px-3 py-2 font-medium">submitted</th>
                        <th className="px-3 py-2 font-medium">project</th>
                        <th className="px-3 py-2 font-medium">last deploy</th>
                        <th className="px-3 py-2 font-medium">repo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {FLEET.map((site) => {
                        const u = data.uptimeByHost[site.host];
                        const project = data.hostProject[site.host] ?? "—";
                        const projStats = data.deployments.byProject.find(
                          (p) => p.project === project,
                        );
                        const repo = data.repos[site.repo];
                        return (
                          <tr key={site.id} className="transition-colors hover:bg-white/[0.03]">
                            <td className="max-w-44 px-3 py-2">
                              <div className="truncate font-mono text-[10px] text-zinc-300">
                                {site.host}
                              </div>
                              <div className="truncate text-[9px] text-zinc-600">{site.label}</div>
                            </td>
                            <td className="px-3 py-2">
                              {u ? (
                                <span
                                  className={
                                    u.pct >= 95
                                      ? "text-emerald-300"
                                      : u.pct >= 80
                                        ? "text-amber-300"
                                        : "text-rose-300"
                                  }
                                >
                                  {u.pct}%
                                </span>
                              ) : (
                                <span className="text-zinc-600">no samples</span>
                              )}
                              <span className="ml-1 text-[9px] text-zinc-600">
                                ({u?.checked ?? 0})
                              </span>
                            </td>
                            <td className={`px-3 py-2 font-medium ${u ? scoreToneClass(u.avgScore) : "text-zinc-600"}`}>
                              {u ? u.avgScore : "—"}
                            </td>
                            <td className="px-3 py-2 text-zinc-400">
                              {data.submissions.byHost[site.host] ?? 0}
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px] text-zinc-400">
                              {project}
                            </td>
                            <td className="px-3 py-2">
                              {projStats?.last ? (
                                <span className="flex items-center gap-1.5">
                                  <Badge
                                    variant="outline"
                                    className={`text-[8px] ${deployStateClass(projStats.last.state)}`}
                                  >
                                    {projStats.last.state}
                                  </Badge>
                                  <span className="text-[9px] text-zinc-600">
                                    {relativeTime(projStats.last.createdAt)}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-zinc-600">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {repo ? (
                                <span className="flex items-center gap-1.5">
                                  {repo.language ? (
                                    <span className="rounded border border-white/10 bg-white/5 px-1 py-px text-[8px] text-zinc-400">
                                      {repo.language}
                                    </span>
                                  ) : null}
                                  <span className="text-[9px] text-zinc-600">
                                    pushed {relativeTime(repo.pushedAt)}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-zinc-600">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* ── RECENT DEPLOYMENTS ─────────────────────────────────── */}
            {data.vercelConnected ? (
              <Card className="border-white/5 bg-white/[0.02]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-zinc-400">
                    Recent production deployments
                    <span className="ml-2 text-[10px] font-normal text-zinc-600">
                      last 8 across the Vercel account
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.deployments.recent.length === 0 ? (
                    <p className="text-[11px] text-zinc-600">No deployments returned.</p>
                  ) : (
                    <div className="divide-y divide-white/5 rounded-lg border border-white/5">
                      {data.deployments.recent.map((d) => (
                        <div
                          key={d.uid}
                          className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]"
                        >
                          <Badge
                            variant="outline"
                            className={`text-[8px] ${deployStateClass(d.state)}`}
                          >
                            {d.state}
                          </Badge>
                          <span className="font-mono text-zinc-300">{d.project}</span>
                          {d.sha ? (
                            <span className="font-mono text-[9px] text-zinc-600">{d.sha}</span>
                          ) : null}
                          <span className="ml-auto text-[9px] text-zinc-600">
                            {relativeTime(d.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed border-white/10 bg-white/[0.02]">
                <CardContent className="p-4 text-[11px] leading-relaxed text-zinc-500">
                  Connect a Vercel token on the Integrations page to unlock deployment analytics —
                  counts, per-project stats and the live deployment feed.
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <p className="text-xs text-zinc-500">Analytics unavailable — try refreshing.</p>
        )}
      </main>
    </AppShell>
  );
}
