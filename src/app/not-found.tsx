// ─── Branded 404 — recovery path instead of the bare default ────────────────
// Audit L2: /nonexistent used to serve the unstyled 9-byte "Not found" (or the
// raw HTML shell) with no way back. This page renders inside the root layout
// (AuthGate): anonymous visitors see the lock screen — standard for a gated
// management plane — while signed-in admins get a proper recovery page with a
// route home. Single-segment unknown paths reach here via the [keyfile]
// route's notFound().

import Link from "next/link";
import { Radar } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0a0c10] px-4 text-zinc-100">
      {/* ambient pulse rings — same family as the lock screen (L3) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-[560px] w-[560px] rounded-full border border-emerald-500/20" />
        <div className="absolute h-[380px] w-[380px] rounded-full border border-emerald-500/30" />
        <div className="absolute h-[220px] w-[220px] rounded-full border border-emerald-500/40" />
      </div>

      <div className="relative w-full max-w-sm text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/25">
            <Radar className="h-4 w-4 text-emerald-400" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-zinc-100">
            Fleet Control
          </span>
        </div>

        <p
          aria-hidden
          className="mb-2 font-mono text-[64px] font-semibold leading-none tracking-tight text-emerald-400/90"
        >
          404
        </p>
        <h1 className="text-base font-semibold text-zinc-100">
          Off the chart
        </h1>
        <p className="mx-auto mt-2 max-w-[34ch] text-balance text-sm leading-relaxed text-zinc-500">
          This coordinate isn&apos;t in the fleet. The page may have moved, or
          the link that brought you here is stale.
        </p>

        <div className="mt-7 flex items-center justify-center gap-2.5">
          <Button
            asChild
            className="h-11 bg-emerald-500 px-5 font-semibold text-emerald-950 transition-all hover:bg-emerald-400"
          >
            <Link href="/">
              Back to the dashboard
              <span aria-hidden>→</span>
            </Link>
          </Button>
        </div>

        <p className="mt-8 font-mono text-[12px] text-zinc-600">
          every other route is under the management lock
        </p>
      </div>
    </div>
  );
}
