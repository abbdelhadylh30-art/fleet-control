"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AgentActivityEntry, AgentSession } from "@/lib/agent-vault";

interface AgentPayload {
  sessions: AgentSession[];
  activity: AgentActivityEntry[];
}

const DAYS = 14;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Agent-link usage — calls/day mini chart + per-link breakdown, from the audit log. */
export function AgentUsageCard() {
  const [data, setData] = useState<AgentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/agent", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as AgentPayload);
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

  const { days, total, okRate, topLinks } = useMemo(() => {
    const activity = data?.activity ?? [];
    const buckets = new Map<string, { calls: number; ok: number }>();
    const today = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400_000);
      buckets.set(d.toISOString().slice(0, 10), { calls: 0, ok: 0 });
    }
    for (const e of activity) {
      const b = buckets.get(dayKey(e.t));
      if (!b) continue;
      b.calls += 1;
      if (e.ok) b.ok += 1;
    }
    const days = [...buckets.entries()].map(([date, v]) => ({ date, ...v }));
    const total = days.reduce((s, d) => s + d.calls, 0);
    const okSum = days.reduce((s, d) => s + d.ok, 0);
    const perLink = new Map<string, number>();
    for (const e of activity) {
      if (e.label === "-") continue;
      perLink.set(e.label, (perLink.get(e.label) ?? 0) + 1);
    }
    const topLinks = [...perLink.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, calls]) => ({ label, calls }));
    return { days, total, okRate: total ? Math.round((okSum / total) * 100) : 100, topLinks };
  }, [data]);

  const max = Math.max(1, ...days.map((d) => d.calls));

  return (
    <Card className="fade-up-item border-white/5 bg-zinc-900/60 backdrop-blur transition-colors duration-300 hover:border-emerald-500/15">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            <Bot className="h-4 w-4 text-emerald-400" />
            Agent usage
          </h2>
          <p className="mt-1 text-[11px] text-zinc-600">
            <span className="tabular-nums text-zinc-400">{total}</span> proxied calls in the
            last {DAYS} days ·{" "}
            <span className="tabular-nums text-emerald-400">{okRate}%</span> ok
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={refreshing}
          onClick={() => void load(true)}
          aria-label="Refresh agent usage"
          className="h-8 w-8 p-0 text-zinc-500 hover:bg-white/5 hover:text-emerald-300"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto]">
        {/* 14-day bars */}
        <div>
          {loading ? (
            <div className="flex h-20 items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> loading usage…
            </div>
          ) : total === 0 ? (
            <p className="flex h-20 items-center text-xs leading-relaxed text-zinc-600">
              No proxied calls yet — paste an agent link in the chat and the AI&apos;s GitHub /
              Vercel calls will chart here.
            </p>
          ) : (
            <div className="flex h-20 items-end gap-1.5" aria-hidden="true">
              {days.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.calls} call${d.calls === 1 ? "" : "s"}`}
                  className="group relative flex-1"
                >
                  <div
                    className={`w-full rounded-t-sm transition-all duration-300 group-hover:opacity-100 ${
                      d.calls > 0
                        ? "bg-gradient-to-t from-emerald-600/60 to-emerald-400 opacity-80"
                        : "bg-white/5"
                    }`}
                    style={{ height: `${Math.max(3, (d.calls / max) * 72)}px` }}
                  />
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-zinc-700">
            {days[0]?.date} → {days[days.length - 1]?.date} (UTC)
          </p>
        </div>

        {/* top links */}
        <div className="min-w-40 space-y-2 sm:border-l sm:border-white/5 sm:pl-5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            Busiest links
          </p>
          {!loading && topLinks.length === 0 ? (
            <p className="text-xs text-zinc-600">—</p>
          ) : (
            topLinks.map((l) => (
              <div key={l.label} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-zinc-400">{l.label}</span>
                <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-emerald-300">
                  {l.calls}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
