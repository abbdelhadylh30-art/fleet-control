"use client";

// State-layer health chip (L4): one glance at the durable Postgres state —
// which mode is live, how many CAS versions the watched key has, and how
// fresh the last durable write is. Amber when the last write is >15 min old.

import { Database } from "lucide-react";

import { relativeTime } from "@/components/fleet/relative-time";
import type { FleetResponse } from "@/lib/fleet";

export function StateLayerChip({
  layer,
}: {
  layer: FleetResponse["stateLayer"];
}) {
  if (!layer) return null;
  const stale =
    layer.updatedAt && Date.now() - new Date(layer.updatedAt).getTime() > 15 * 60_000;
  const title = layer.updatedAt
    ? `State layer: ${layer.mode} · CAS version ${layer.version ?? "?"} · last durable write ${relativeTime(layer.updatedAt)}`
    : `State layer: ${layer.mode} (no meta yet — first write pending)`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
        stale
          ? "bg-amber-500/10 text-amber-400 ring-amber-500/20"
          : "bg-emerald-500/5 text-emerald-500/80 ring-emerald-500/15"
      }`}
    >
      <Database className="h-3 w-3" />
      state {layer.mode === "postgres" ? "pg" : "file"}
      {layer.version != null ? ` · v${layer.version}` : ""}
      {layer.updatedAt ? ` · ${relativeTime(layer.updatedAt)}` : ""}
    </span>
  );
}
