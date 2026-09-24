"use client";

// ─── DeployWatchCard — deploy-triggered auto-resubmission, visible ────────────
// When any fleet site ships a new production deployment, its sitemap URLs go
// straight back into IndexNow + the GSC sitemap gets re-PUT. This card shows
// the watch state, the recent per-deploy outcomes, and a manual "run now".

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  GitCommitHorizontal,
  Loader2,
  MinusCircle,
  Play,
  RefreshCw,
  Radar,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ResubmitEntry {
  t: string;
  host: string;
  project: string;
  deployment: string;
  commitSha: string | null;
  indexNow: { ok: boolean; status: number | null; urls: number; reason?: string };
  gsc: { ok: boolean; status: number | null; reason?: string } | null;
}

interface ResubmitPayload {
  state: { lastRun: string | null; seenCount: number };
  log: ResubmitEntry[];
  vaultConnected?: boolean;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Chip({ ok, label, title }: { ok: boolean | null; label: string; title?: string }) {
  const tone =
    ok === null
      ? "border-zinc-500/25 bg-zinc-500/10 text-zinc-400"
      : ok
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
        : "border-rose-500/25 bg-rose-500/10 text-rose-300";
  const Icon = ok === null ? MinusCircle : ok ? CheckCircle2 : XCircle;
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
    >
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

export function DeployWatchCard() {
  const [data, setData] = useState<ResubmitPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/resubmit", { cache: "no-store" });
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as ResubmitPayload);
    } catch {
      // transient
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    pollRef.current = setInterval(() => void load(), 45_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/resubmit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const json = (await res.json()) as ResubmitPayload & {
        ok?: boolean;
        ran?: boolean;
        entries?: ResubmitEntry[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? "Run failed");
        return;
      }
      if (json.entries && json.entries.length > 0) {
        toast.success(`Resubmitted ${json.entries.length} site${json.entries.length > 1 ? "s" : ""} from recent deploys`);
      } else {
        toast.success("Watch pass complete — no new fleet deployments to resubmit");
      }
      setData({ state: json.state, log: json.log });
    } catch {
      toast.error("Network error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-white/5 bg-zinc-900/60 backdrop-blur transition-colors hover:border-white/10">
      <CardContent className="space-y-5 p-5">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/25">
              <Radar className="h-4.5 w-4.5 text-emerald-400" />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
                Deploy-triggered resubmission
              </h2>
              <p className="text-xs text-zinc-500">
                Every new production deploy re-feeds IndexNow + Google automatically.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={running}
              onClick={() => void runNow()}
              className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run now
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="h-8 gap-1.5 border-white/10 text-zinc-300 hover:bg-white/5"
              aria-label="Refresh resubmission log"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> loading watch state…
          </div>
        ) : !data ? (
          <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
            Unlock the dashboard to see the deployment watch.
          </p>
        ) : (
          <>
            {data.vaultConnected === false && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
                Vercel is disconnected in the vault — the watch can&apos;t see deployments. Reconnect
                the Vercel token below to enable auto-resubmission.
              </p>
            )}
            {/* state strip */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-3">
                <p className="text-[11px] uppercase tracking-wider text-zinc-500">Last watch</p>
                <p className="mt-1 text-sm font-semibold text-zinc-200">
                  {relativeTime(data.state.lastRun)}
                </p>
              </div>
              <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-3">
                <p className="text-[11px] uppercase tracking-wider text-zinc-500">Deploys tracked</p>
                <p className="mt-1 text-sm font-semibold text-zinc-200">{data.state.seenCount}</p>
              </div>
              <div className="rounded-xl border border-white/5 bg-zinc-950/40 p-3">
                <p className="text-[11px] uppercase tracking-wider text-zinc-500">Resubmissions</p>
                <p className="mt-1 text-sm font-semibold text-zinc-200">{data.log.length}</p>
              </div>
            </div>

            {/* log */}
            {data.log.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Nothing resubmitted yet — ship a deploy on any fleet site (or press Run now) and the
                outcome lands here.
              </p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                {data.log.map((e, i) => (
                  <div
                    key={`${e.deployment}-${i}`}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-2.5"
                  >
                    <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-zinc-200">
                        {e.host}
                        {e.commitSha && (
                          <span className="ml-1.5 font-mono text-[10px] text-zinc-500">{e.commitSha}</span>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {e.project} · {relativeTime(e.t)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Chip
                        ok={e.indexNow.ok}
                        label={`IndexNow · ${e.indexNow.urls} urls`}
                        title={e.indexNow.reason}
                      />
                      <Chip
                        ok={e.gsc ? e.gsc.ok : null}
                        label={e.gsc ? "GSC" : "GSC —"}
                        title={
                          e.gsc
                            ? (e.gsc.reason ?? `HTTP ${e.gsc.status}`)
                            : "no Google connection — connect once in Integrations"
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
              <Badge variant="outline" className="border-white/10 text-zinc-500">
                auto
              </Badge>
              runs with every fresh fleet check (90s throttle) · failed deploys ping your alert
              channels
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
