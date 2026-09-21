"use client";

// Fleet average score trend — area sparkline over stored hourly rollups
// (L4 split out of the old monolith page.tsx).

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FleetResponse } from "@/lib/fleet";

export function FleetTrend({ trend }: { trend: FleetResponse["trend"] }) {
  const pts = (trend ?? []).filter((p) => Number.isFinite(p?.avg));
  const W = 160;
  const H = 30;

  // NOTE: computed BEFORE `tooltip`/early-return — `tooltip` closes over
  // `label`, and on fresh instances (empty history) the early-return path
  // runs first; a late declaration would be a TDZ crash in production.
  const avgs = pts.map((p) => p.avg);
  const min = Math.min(...avgs);
  const max = Math.max(...avgs);
  const hasTrend = pts.length >= 2;
  const label = hasTrend
    ? `Fleet avg ${avgs[0]} → ${avgs[avgs.length - 1]} · min ${min} · max ${max} · hourly avg · ${pts.length}h of history`
    : "Fleet score trend — builds with each fresh check";

  const tooltip = (children: React.ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <div role="img" aria-label={label} className="cursor-default">
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="border border-white/10 bg-zinc-900 text-zinc-200"
      >
        <span className="font-semibold">{label}</span>
      </TooltipContent>
    </Tooltip>
  );

  if (!hasTrend) {
    return tooltip(
      <div className="mt-1.5 flex items-center gap-2">
        <svg width={W} height={14} viewBox={`0 0 ${W} 14`}>
          <line
            x1={1}
            y1={7}
            x2={W - 1}
            y2={7}
            stroke="#3f3f46"
            strokeWidth={1.5}
            strokeDasharray="2 3"
            strokeLinecap="round"
          />
        </svg>
        <span className="whitespace-nowrap text-[9px] text-zinc-600">
          trend builds with each hourly rollup
        </span>
      </div>,
    );
  }

  const lo = Math.max(0, min - 4);
  const hi = Math.min(100, max + 4);
  const span = Math.max(hi - lo, 1);
  const coords = avgs.map((v, i) => ({
    x: (i / (pts.length - 1)) * (W - 2) + 1,
    y: H - 2 - ((v - lo) / span) * (H - 8),
  }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `1,${H - 1} ${line} ${W - 1},${H - 1}`;
  const up = avgs[avgs.length - 1] >= avgs[0];
  const stroke = up ? "#34d399" : "#fb7185";
  const last = coords[coords.length - 1];

  return tooltip(
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="mt-1.5 overflow-visible"
    >
      <defs>
        <linearGradient id="fleet-trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#fleet-trend-fill)" />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={2.2} fill={stroke}>
        <animate
          attributeName="opacity"
          values="1;0.35;1"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>,
  );
}
