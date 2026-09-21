"use client";

// Fleet summary stat card (L4 split out of the old monolith page.tsx).

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedNumber } from "@/components/fleet/animated-number";

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone: "emerald" | "amber" | "zinc" | "rose";
  loading?: boolean;
}) {
  const tones = {
    emerald: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 ring-amber-500/20",
    zinc: "text-zinc-300 bg-zinc-500/10 ring-zinc-500/20",
    rose: "text-rose-400 bg-rose-500/10 ring-rose-500/20",
  } as const;
  const values = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    zinc: "text-zinc-100",
    rose: "text-rose-300",
  } as const;
  return (
    <Card className="group border-white/5 bg-zinc-900/60 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-white/10 hover:shadow-lg hover:shadow-black/40 focus-within:ring-2 focus-within:ring-emerald-500/40">
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110 ${tones[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          {loading ? (
            <>
              <Skeleton className="mb-1.5 h-7 w-14 bg-white/10" />
              <Skeleton className="h-3.5 w-24 bg-white/5" />
            </>
          ) : (
            <>
              <div
                className={`text-2xl font-semibold tracking-tight tabular-nums transition-colors ${values[tone]}`}
              >
                {/^\d+$/.test(value) ? (
                  <AnimatedNumber value={parseInt(value, 10)} />
                ) : (
                  value
                )}
              </div>
              <div className="truncate text-xs text-zinc-400">
                {label} · <span className="text-zinc-500">{sub}</span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
