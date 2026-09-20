"use client";

// ─── /postgres — Postgres readiness + per-app migration spaces (v17) ────────
// Every fleet app gets a dedicated "migration space": why it needs Postgres,
// a 6-step plan with copy-ready snippets, and per-app progress tracking.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Code2,
  Copy,
  Database,
  ExternalLink,
  HardDrive,
  Info,
  Loader2,
  MinusCircle,
  RefreshCcw,
  RotateCcw,
  Server,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { copyText } from "@/lib/copy";
import {
  MIGRATION_STEPS,
  PRIORITY_LABEL,
  STEP_COUNT,
  VERDICT_LABEL,
  stepSnippet,
  type PgAppAudit,
  type PgStatusMap,
  type PgSummary,
  type PgVerdict,
} from "@/lib/pg-audit-shared";

interface AuditResponse {
  baseline: { scannedAt: string; source: string; owner: string } | null;
  apps: PgAppAudit[];
  status: PgStatusMap;
  summary: PgSummary;
}

function relativeTime(t: string | null | undefined): string {
  if (!t) return "—";
  const diff = Date.now() - new Date(t).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const verdictTone: Record<PgVerdict, { badge: string; dot: string; text: string }> = {
  needs: {
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    dot: "bg-rose-400",
    text: "text-rose-300",
  },
  optional: {
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-300",
    dot: "bg-sky-400",
    text: "text-sky-300",
  },
  ok: {
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
  },
};

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
  tone?: "rose" | "sky" | "emerald" | "zinc";
}) {
  const toneMap = {
    rose: "text-rose-300 bg-rose-500/10 ring-rose-500/20",
    sky: "text-sky-300 bg-sky-500/10 ring-sky-500/20",
    emerald: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/20",
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

// ─── Per-app migration space ────────────────────────────────────────────────

function StepRow({
  app,
  index,
  done,
  snippetOpen,
  onToggle,
  onToggleSnippet,
}: {
  app: string;
  index: number;
  done: boolean;
  snippetOpen: boolean;
  onToggle: () => void;
  onToggleSnippet: () => void;
}) {
  const step = MIGRATION_STEPS[index];
  return (
    <li
      className={`rounded-xl border p-3 transition-colors ${
        done
          ? "border-emerald-500/25 bg-emerald-500/[0.06]"
          : "border-white/5 bg-white/[0.02] hover:border-white/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={done}
          aria-label={`${done ? "Uncheck" : "Check"} step ${index + 1}: ${step.title}`}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
            done
              ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-300"
              : "border-white/15 bg-white/5 text-transparent hover:border-emerald-400/40 hover:text-emerald-400/40"
          }`}
        >
          <Check className="h-3 w-3" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-600">{String(index + 1).padStart(2, "0")}</span>
            <span
              className={`text-xs font-medium ${done ? "text-emerald-200/80 line-through decoration-emerald-500/40" : "text-zinc-200"}`}
            >
              {step.title}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{step.detail}</p>
        </div>
        <button
          type="button"
          onClick={onToggleSnippet}
          aria-expanded={snippetOpen}
          aria-label={`${snippetOpen ? "Hide" : "Show"} snippet for step ${index + 1}`}
          title="copy-ready snippet"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
            snippetOpen
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-white/10 bg-white/5 text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Code2 className="h-3 w-3" />
        </button>
      </div>
      {snippetOpen && (
        <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
          <div className="flex items-center justify-between border-b border-white/5 px-2.5 py-1">
            <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">
              snippet · step {index + 1}
            </span>
            <button
              type="button"
              onClick={() => void copyText(stepSnippet(index, app), `Step ${index + 1} snippet copied`)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
            >
              <Copy className="h-2.5 w-2.5" /> copy
            </button>
          </div>
          <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[10px] leading-relaxed text-zinc-300">
            {stepSnippet(index, app)}
          </pre>
        </div>
      )}
    </li>
  );
}

function AppSpace({
  app,
  owner,
  steps,
  expanded,
  onToggleExpanded,
  onStep,
  onReset,
  snippetOpen,
  onToggleSnippet,
}: {
  app: PgAppAudit;
  owner: string;
  steps: boolean[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onStep: (index: number, done: boolean) => void;
  onReset: () => void;
  snippetOpen: string | null; // `${index}` of the open snippet in THIS app
  onToggleSnippet: (index: number) => void;
}) {
  const doneCount = steps.filter(Boolean).length;
  const pct = Math.round((doneCount / STEP_COUNT) * 100);

  return (
    <Card className={`border-white/5 bg-white/[0.02] transition-colors ${expanded ? "border-rose-500/20" : ""}`}>
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${verdictTone.needs.dot}`} />
        <span className="font-mono text-sm font-medium text-zinc-100">{app.repo}</span>
        <Badge variant="outline" className={`text-[9px] ${verdictTone.needs.badge}`}>
          {PRIORITY_LABEL[app.priority]}
        </Badge>
        {app.hosts.map((h) => (
          <span key={h} className="hidden font-mono text-[10px] text-zinc-600 sm:inline">
            {h}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-2" aria-label={`${doneCount} of ${STEP_COUNT} steps done`}>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
              <span
                className={`block h-full rounded-full transition-all duration-500 ${
                  pct === 100 ? "bg-emerald-400" : "bg-rose-400/70"
                }`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="font-mono text-[10px] text-zinc-500">
              {doneCount}/{STEP_COUNT}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 text-zinc-500 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {expanded && (
        <CardContent className="space-y-4 border-t border-white/5 pt-4">
          <div className="grid gap-4 lg:grid-cols-[1fr,1.25fr]">
            {/* WHY */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <HardDrive className="h-3.5 w-3.5 text-rose-300" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Why it needs Postgres
                </span>
              </div>
              <ul className="space-y-1.5">
                {app.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-400">
                    <Circle className="mt-1 h-1.5 w-1.5 shrink-0 fill-rose-400/60 text-rose-400/60" />
                    {r}
                  </li>
                ))}
                {app.reasons.length === 0 && (
                  <li className="text-[11px] text-zinc-500">No state stores detected in the repo tree.</li>
                )}
              </ul>
              <p className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-zinc-400">
                <Info className="mr-1 inline h-3 w-3 text-zinc-500" />
                {app.fixSummary}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 text-[10px]">
                <div className="flex justify-between gap-2 sm:col-span-1">
                  <dt className="text-zinc-600">framework</dt>
                  <dd className="truncate font-mono text-zinc-400">{app.framework ?? app.language ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-600">api routes</dt>
                  <dd className="font-mono text-zinc-400">{app.apiRoutes}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-600">branch</dt>
                  <dd className="font-mono text-zinc-400">{app.branch}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-600">last push</dt>
                  <dd className="font-mono text-zinc-400">{relativeTime(app.pushedAt)}</dd>
                </div>
                <div className="flex justify-between gap-2 sm:col-span-2">
                  <dt className="text-zinc-600">vercel project</dt>
                  <dd className="truncate font-mono text-zinc-400">{app.vercelProject ?? "—"}</dd>
                </div>
              </dl>
              <a
                href={`https://github.com/${owner}/${app.repo}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
              >
                <ExternalLink className="h-2.5 w-2.5" /> open repo
              </a>
            </div>

            {/* MIGRATION SPACE */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-emerald-300" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Migration space
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onReset}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-400"
                  title="Clear this app's progress"
                >
                  <RotateCcw className="h-2.5 w-2.5" /> reset
                </button>
              </div>
              <ul className="space-y-2">
                {MIGRATION_STEPS.map((_, i) => (
                  <StepRow
                    key={i}
                    app={app.repo}
                    index={i}
                    done={steps[i] ?? false}
                    snippetOpen={snippetOpen === String(i)}
                    onToggle={() => onStep(i, !(steps[i] ?? false))}
                    onToggleSnippet={() => onToggleSnippet(i)}
                  />
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function CompactApp({ app }: { app: PgAppAudit }) {
  const tone = verdictTone[app.verdict];
  return (
    <Card className="border-white/5 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        <span className="font-mono text-xs font-medium text-zinc-200">{app.repo}</span>
        <span className="text-[10px] text-zinc-600">
          {app.reasons[0] ?? VERDICT_LABEL[app.verdict]}
        </span>
        {app.hosts.length > 0 && (
          <span className="ml-auto hidden font-mono text-[10px] text-zinc-600 sm:inline">
            {app.hosts[0]}
          </span>
        )}
      </div>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PostgresPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Record<string, string | null>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/postgres-audit", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as AuditResponse);
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rescan = async () => {
    setRescanning(true);
    try {
      const res = await fetch("/api/postgres-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rescan" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { apps: PgAppAudit[]; summary: PgSummary; scannedAt: string };
      setData((prev) =>
        prev
          ? { ...prev, apps: json.apps, summary: json.summary, baseline: { ...prev.baseline!, scannedAt: json.scannedAt } }
          : prev,
      );
      const { toast } = await import("sonner");
      toast.success(`Re-scanned ${json.apps.length} repos from GitHub`);
    } catch {
      const { toast } = await import("sonner");
      toast.error("Re-scan failed — check that GitHub is connected in the vault");
    } finally {
      setRescanning(false);
    }
  };

  const setStep = async (repo: string, index: number, done: boolean) => {
    // optimistic
    setData((prev) => {
      if (!prev) return prev;
      const entry = prev.status.apps[repo];
      const steps = entry?.steps.length === STEP_COUNT ? [...entry.steps] : Array(STEP_COUNT).fill(false);
      steps[index] = done;
      return {
        ...prev,
        status: { ...prev.status, apps: { ...prev.status.apps, [repo]: { steps, updatedAt: new Date().toISOString() } } },
      };
    });
    try {
      const res = await fetch("/api/postgres-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "step", repo, index, done }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      const { toast } = await import("sonner");
      toast.error("Could not save the step — check your admin session");
      void load(); // revert to server truth
    }
  };

  const resetApp = async (repo: string) => {
    try {
      const res = await fetch("/api/postgres-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resetApp", repo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { status } = (await res.json()) as { status: PgStatusMap };
      setData((prev) => (prev ? { ...prev, status } : prev));
      const { toast } = await import("sonner");
      toast.success(`Progress cleared for ${repo}`);
    } catch {
      const { toast } = await import("sonner");
      toast.error("Reset failed");
    }
  };

  const { apps, summary, status, baseline } = data ?? {};
  const needs = useMemo(() => (apps ?? []).filter((a) => a.verdict === "needs"), [apps]);
  const optional = useMemo(() => (apps ?? []).filter((a) => a.verdict === "optional"), [apps]);
  const okApps = useMemo(() => (apps ?? []).filter((a) => a.verdict === "ok"), [apps]);
  const progressPct =
    summary && summary.stepsTotal > 0 ? Math.round((summary.stepsDone / summary.stepsTotal) * 100) : 0;

  const toggleSnippet = (repo: string, index: number) => {
    setSnippets((prev) => {
      const cur = prev[repo] ?? null;
      return { ...prev, [repo]: cur === String(index) ? null : String(index) };
    });
  };

  return (
    <AppShell>
      <main className="relative mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-100">
              <Database className="h-5 w-5 text-emerald-400" />
              Postgres Readiness
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {baseline
                ? `Audited ${relativeTime(baseline.scannedAt)} · ${summary?.total ?? 0} repos · ${baseline.owner}`
                : "Loading the fleet audit…"}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void rescan()}
            disabled={rescanning}
            className="h-8 gap-1.5 border-white/10 bg-white/[0.04] text-xs text-zinc-200 hover:bg-white/[0.08]"
          >
            {rescanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            Re-scan repos
          </Button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl bg-white/5" />
            ))}
          </div>
        ) : data && summary ? (
          <>
            {/* explainer */}
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                {
                  icon: <Server className="h-3.5 w-3.5 text-rose-300" />,
                  text: "Vercel lambdas have a read-only filesystem — runtime writes vanish on cold starts",
                },
                {
                  icon: <HardDrive className="h-3.5 w-3.5 text-amber-300" />,
                  text: "SQLite files ship as build-time snapshots only — they can never accept runtime writes",
                },
                {
                  icon: <Database className="h-3.5 w-3.5 text-emerald-300" />,
                  text: "Neon Postgres lives outside the lambda — every app below can hold real, durable state",
                },
              ].map((c) => (
                <div key={c.text} className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  {c.icon}
                  <p className="text-[11px] leading-relaxed text-zinc-400">{c.text}</p>
                </div>
              ))}
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Kpi
                icon={<Database className="h-4 w-4" />}
                label="Needs migration"
                value={String(summary.needs)}
                sub="SQLite-bound state"
                tone="rose"
              />
              <Kpi
                icon={<MinusCircle className="h-4 w-4" />}
                label="Optional"
                value={String(summary.optional)}
                sub="stateless APIs — fine for now"
                tone="sky"
              />
              <Kpi
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Ready as-is"
                value={String(summary.ok)}
                sub="static / no backend state"
              />
              <Kpi
                icon={<HardDrive className="h-4 w-4" />}
                label="SQLite schemas"
                value={String(summary.sqliteSchemas)}
                sub="prisma provider = sqlite"
                tone="zinc"
              />
              <Kpi
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Fleet progress"
                value={`${progressPct}%`}
                sub={`${summary.stepsDone}/${summary.stepsTotal} steps across ${summary.needs} apps`}
              />
            </div>

            {/* fleet-wide progress bar */}
            {summary.stepsTotal > 0 && (
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-500">
                  <span className="font-semibold uppercase tracking-wider">Fleet migration progress</span>
                  <span className="font-mono">
                    {summary.stepsDone}/{summary.stepsTotal} steps · {progressPct}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rose-400/60 via-amber-400/70 to-emerald-400 transition-all duration-700"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* NEEDS MIGRATION — per-app spaces */}
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Database className="h-4 w-4 text-rose-300" />
                Needs migration
                <Badge variant="outline" className="text-[9px] border-rose-500/30 bg-rose-500/10 text-rose-300">
                  {needs.length}
                </Badge>
                <span className="text-[10px] font-normal text-zinc-600">
                  click an app to open its migration space
                </span>
              </h2>
              <div className="space-y-2">
                {needs.map((app) => {
                  const steps = status?.apps[app.repo]?.steps;
                  const safeSteps =
                    steps && steps.length === STEP_COUNT ? steps : Array(STEP_COUNT).fill(false);
                  return (
                    <AppSpace
                      key={app.repo}
                      app={app}
                      owner={baseline?.owner ?? "abbdelhadylh30-art"}
                      steps={safeSteps}
                      expanded={expanded === app.repo}
                      onToggleExpanded={() => setExpanded(expanded === app.repo ? null : app.repo)}
                      onStep={(i, done) => void setStep(app.repo, i, done)}
                      onReset={() => void resetApp(app.repo)}
                      snippetOpen={snippets[app.repo] ?? null}
                      onToggleSnippet={(i) => toggleSnippet(app.repo, i)}
                    />
                  );
                })}
                {needs.length === 0 && (
                  <p className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-xs text-zinc-500">
                    No migration needed — the fleet is Postgres-ready.
                  </p>
                )}
              </div>
            </section>

            {/* OPTIONAL */}
            {optional.length > 0 && (
              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <MinusCircle className="h-4 w-4 text-sky-300" />
                  Optional
                  <Badge variant="outline" className="text-[9px] border-sky-500/30 bg-sky-500/10 text-sky-300">
                    {optional.length}
                  </Badge>
                </h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {optional.map((a) => (
                    <CompactApp key={a.repo} app={a} />
                  ))}
                </div>
              </section>
            )}

            {/* READY AS-IS */}
            {okApps.length > 0 && (
              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  Ready as-is
                  <Badge variant="outline" className="text-[9px] border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                    {okApps.length}
                  </Badge>
                </h2>
                <div className="grid gap-2 sm:grid-cols-3">
                  {okApps.map((a) => (
                    <CompactApp key={a.repo} app={a} />
                  ))}
                </div>
              </section>
            )}

            {/* honest persistence note */}
            <p className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-zinc-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
              Step progress for this dashboard is stored in its own Neon Postgres (first app in the
              list) — it now survives cold starts. The other apps keep ephemeral file state until their
              own migration runs; the audit verdicts persist either way via the committed baseline.
            </p>
          </>
        ) : (
          <Card className="border-white/5 bg-white/[0.02]">
            <CardContent className="p-6 text-center text-xs text-zinc-500">
              Audit unavailable — the baseline file is missing and the re-scan needs GitHub connected.
            </CardContent>
          </Card>
        )}
      </main>
    </AppShell>
  );
}
