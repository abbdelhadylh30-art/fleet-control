"use client";

// ─── Search performance — clicks / impressions from Search Analytics ────────
// The "is any of this working?" panel: what Google actually served for the
// fleet in the last 28 days. Requires the connect-once Google auth (or a
// pasted 1-hour token in the panel below). Empty results on brand-new sites
// are normal — impressions ramp over 1–4 weeks after sitemap submission.

import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  ExternalLink,
  Eye,
  Hash,
  Loader2,
  MousePointerClick,
  RefreshCcw,
  Search,
  TrendingUp,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { GscPerfResult, GscPerfRow } from "@/lib/gsc-types";
import { GSC_OWNER_EMAIL } from "@/lib/gsc-types";

const GSC_RESOURCE = "sc-domain:abdelhadygabriel.me";
const GSC_PERF_LINK = `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(GSC_RESOURCE)}`;

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "/" : u.pathname.replace(/\/$/, "");
    return `${u.hostname}${path}`;
  } catch {
    return url;
  }
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-3.5">
      <div className={`flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider ${accent}`}>
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-xl font-bold tabular-nums text-zinc-100">{value}</div>
    </div>
  );
}

function PerfList({
  rows,
  kind,
}: {
  rows: GscPerfRow[];
  kind: "page" | "query";
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-[11px] text-zinc-600">
        nothing in this bucket yet — Google hasn&apos;t served{" "}
        {kind === "page" ? "any fleet page" : "any query"} in the window
      </p>
    );
  }
  return (
    <ul className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto pr-1">
      {rows.map((r) => (
        <li
          key={r.key}
          className="group rounded-lg border border-white/5 bg-black/20 px-2.5 py-2 transition-colors hover:border-emerald-500/20"
        >
          <div className="flex items-center gap-2">
            {kind === "page" ? (
              <a
                href={`https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(GSC_RESOURCE)}&id=${encodeURIComponent(r.key)}`}
                target="_blank"
                rel="noreferrer"
                title={`inspect ${r.key} in Search Console`}
                className="min-w-0 flex-1 truncate text-[11px] text-zinc-300 transition-colors group-hover:text-emerald-300"
              >
                {shortUrl(r.key)}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{r.key}</span>
            )}
            {kind === "page" ? (
              <ExternalLink className="h-2.5 w-2.5 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" />
            ) : (
              <Search className="h-2.5 w-2.5 shrink-0 text-zinc-700" />
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] tabular-nums text-zinc-500">
            <span className="text-emerald-400/90">{r.clicks} clicks</span>
            <span>{r.impressions} impr.</span>
            <span>{fmtPct(r.ctr)} CTR</span>
            <span className="ml-auto">pos {r.position.toFixed(1)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Search Analytics panel (lives on /integrations, under the Google panel). */
export function GscPerformancePanel() {
  const [data, setData] = useState<GscPerfResult | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/gsc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "performance" }),
      });
      const json = (await res.json()) as GscPerfResult & { error?: string };
      if (json.ok) {
        setData(json);
        setState("ready");
      } else {
        setErrorMsg(json.error ?? `Google returned ${res.status}`);
        setState("error");
      }
    } catch {
      setErrorMsg("network error — could not reach the dashboard API");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <Card className="fade-up-item border-white/5 bg-zinc-900/60 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <BarChart3 className="h-4 w-4 text-emerald-400" />
          Search performance — what Google actually served
        </h2>
        <div className="flex items-center gap-1.5">
          {data ? (
            <Badge
              variant="outline"
              className="px-2 py-0.5 text-[10px] text-zinc-400"
            >
              {data.range.start} → {data.range.end}
            </Badge>
          ) : null}
          <a href={GSC_PERF_LINK} target="_blank" rel="noreferrer">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-white/10 px-2.5 text-[11px] text-zinc-300 hover:bg-white/5"
            >
              full report <ExternalLink className="h-2.5 w-2.5" />
            </Button>
          </a>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load()}
            disabled={state === "loading"}
            className="h-7 gap-1 border-white/10 px-2.5 text-[11px] text-zinc-300 hover:bg-white/5"
          >
            {state === "loading" ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-2.5 w-2.5" />
            )}
            refresh
          </Button>
        </div>
      </div>

      <CardContent className="p-5">
        {state === "error" ? (
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-4 text-xs leading-relaxed text-rose-300">
            <div className="flex items-center gap-2 font-semibold text-rose-200">
              <XCircle className="h-4 w-4 shrink-0" /> Performance data unavailable
            </div>
            <p className="mt-1.5">{errorMsg}</p>
            <p className="mt-1.5 text-rose-300/70">
              Need the Google connection with the <span className="font-semibold">{GSC_OWNER_EMAIL}</span>{" "}
              account (the property owner) — connect it in the panel below, or paste a 1-hour token.
            </p>
          </div>
        ) : state !== "ready" || !data ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> asking Google for the last 28 days…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatTile
                icon={<MousePointerClick className="h-3 w-3" />}
                label="clicks"
                value={String(data.totals?.clicks ?? 0)}
                accent="text-emerald-400"
              />
              <StatTile
                icon={<Eye className="h-3 w-3" />}
                label="impressions"
                value={String(data.totals?.impressions ?? 0)}
                accent="text-sky-400"
              />
              <StatTile
                icon={<TrendingUp className="h-3 w-3" />}
                label="avg CTR"
                value={fmtPct(data.totals?.ctr ?? 0)}
                accent="text-amber-400"
              />
              <StatTile
                icon={<Hash className="h-3 w-3" />}
                label="avg position"
                value={(data.totals?.position ?? 0).toFixed(1)}
                accent="text-zinc-400"
              />
            </div>

            {(data.totals?.clicks ?? 0) === 0 && (data.totals?.impressions ?? 0) === 0 ? (
              <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-[11px] leading-relaxed text-amber-300/90">
                Zero impressions so far — normal for brand-new sites. Make sure every sitemap is
                submitted (runbook step 2), then give Google 1–4 weeks. This panel turns into your
                scoreboard automatically.
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Top pages · click to inspect
                </h3>
                <PerfList rows={data.pages ?? []} kind="page" />
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Top search queries
                </h3>
                <PerfList rows={data.queries ?? []} kind="query" />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
