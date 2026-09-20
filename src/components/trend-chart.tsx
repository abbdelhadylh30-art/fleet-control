"use client";

import { useMemo } from "react";

import type { LogEntry } from "@/lib/activity-log";

/** 7-day IndexNow submission bars (shared by / overview and /activity). */
export function TrendChart({ log }: { log: LogEntry[] }) {
  const days = useMemo(() => {
    const buckets: { label: string; urls: number; date: string }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const urls = log
        .filter((e) => {
          const t = new Date(e.ts);
          return e.ok && t >= d && t < next;
        })
        .reduce((s, e) => s + e.urls, 0);
      buckets.push({
        label: d.toLocaleDateString("en", { weekday: "short" })[0],
        urls,
        date: d.toLocaleDateString("en", { month: "short", day: "numeric" }),
      });
    }
    return buckets;
  }, [log]);

  const max = Math.max(...days.map((d) => d.urls), 1);

  return (
    <div className="flex items-end gap-1.5" aria-label="Submissions last 7 days">
      {days.map((d, i) => (
        <div
          key={i}
          className="flex w-6 flex-col items-center gap-1"
          title={`${d.date} · ${d.urls} URLs submitted`}
        >
          <div className="flex h-14 w-full items-end">
            <div
              className={`w-full rounded-t transition-all duration-500 ${
                d.urls > 0
                  ? "bg-gradient-to-t from-emerald-600/70 to-emerald-400"
                  : "bg-white/5"
              }`}
              style={{ height: `${Math.max((d.urls / max) * 100, 6)}%` }}
            />
          </div>
          <span className="text-[9px] uppercase text-zinc-600">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
