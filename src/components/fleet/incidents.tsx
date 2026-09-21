"use client";

// Active downtime banner + recently-resolved strip (L4 split).
// M3 (2026-09-21): incidents now carry a severity set at close time —
// minor (<15m) · major (<2h) · extended (≥2h).

import { CheckCircle2 } from "lucide-react";

import type { FleetResponse } from "@/lib/fleet";
import { relativeTime } from "@/components/fleet/relative-time";

export function durationSince(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

const SEVERITY_STYLE: Record<string, string> = {
  minor: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
  major: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  extended: "bg-rose-500/10 text-rose-400 ring-rose-500/20",
};

export function IncidentBanner({
  incidents,
}: {
  incidents: FleetResponse["incidents"];
}) {
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

export function RecentIncidents({
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
          className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400 ring-1 ring-white/5 transition-colors hover:text-zinc-200"
        >
          {i.host}
          {i.severity ? (
            <span
              className={`rounded px-1 text-[9px] uppercase ring-1 ${SEVERITY_STYLE[i.severity] ?? SEVERITY_STYLE.minor}`}
            >
              {i.severity}
            </span>
          ) : null}
          <span className="text-zinc-500">
            back {i.recoveredAt ? relativeTime(i.recoveredAt) : "—"}
          </span>
        </span>
      ))}
    </div>
  );
}
