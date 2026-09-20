"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, Loader2, RefreshCw, Send, XCircle } from "lucide-react";

import { TrendChart } from "@/components/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LogEntry } from "@/lib/activity-log";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** IndexNow submission log — self-fetching panel used on /activity. */
export function ActivityPanel() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/indexnow", { cache: "no-store" });
      if (res.ok) setLog(((await res.json()) as { entries: LogEntry[] }).entries);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalUrls = log.filter((e) => e.ok).reduce((s, e) => s + e.urls, 0);
  const hosts = new Set(log.map((e) => e.host)).size;

  return (
    <Card className="fade-up-item border-white/5 bg-zinc-900/60 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            <Activity className="h-4 w-4 text-emerald-400" />
            IndexNow activity
          </h2>
          <p className="mt-1 text-[11px] text-zinc-600">
            {log.length} entries · {hosts} hosts · all-time total{" "}
            <span className="tabular-nums text-zinc-400">{totalUrls} URLs</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TrendChart log={log} />
          <Button
            size="sm"
            variant="ghost"
            disabled={refreshing}
            onClick={() => void load(true)}
            aria-label="Refresh activity log"
            className="h-8 w-8 p-0 text-zinc-500 hover:bg-white/5 hover:text-emerald-300"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
      <ScrollArea className="scrollbar-thin max-h-[32rem]">
        <div className="divide-y divide-white/5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> loading submissions…
            </div>
          ) : log.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <Send className="h-6 w-6 text-zinc-700" />
              <p className="text-sm text-zinc-500">
                No submissions yet — hit{" "}
                <span className="text-emerald-400">Submit all</span> on the
                Overview page to push the fleet into Bing/Yandex.
              </p>
            </div>
          ) : (
            log.map((e, i) => (
              <div
                key={`${e.ts}-${e.host}-${i}`}
                className="group/entry flex items-center gap-3 px-5 py-3 transition-all duration-200 hover:bg-white/[0.02] hover:pl-6"
              >
                {e.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 transition-transform duration-300 group-hover/entry:scale-110" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-rose-400 transition-transform duration-300 group-hover/entry:scale-110" />
                )}
                <span
                  className={`min-w-0 flex-1 truncate font-mono text-xs transition-colors ${
                    e.ok
                      ? "text-zinc-300 group-hover/entry:text-emerald-300"
                      : "text-zinc-400 group-hover/entry:text-rose-300"
                  }`}
                >
                  {e.host}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {e.urls} URLs
                </span>
                <Badge
                  variant="outline"
                  className={`shrink-0 border-white/10 px-1.5 text-[10px] tabular-nums ${
                    e.ok ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {e.http ?? "ERR"}
                </Badge>
                <span className="w-16 shrink-0 text-right text-[11px] text-zinc-600 transition-colors group-hover/entry:text-zinc-400">
                  {relativeTime(e.ts)}
                </span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
