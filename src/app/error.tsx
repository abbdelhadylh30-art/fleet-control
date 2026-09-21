"use client";

// ─── Route error boundary — a recovery path instead of the white screen ─────
// Lesson from 2026-09-21: a render crash in the overview page surfaced as
// Next's bare "Application error" for every anonymous visitor for two days.
// This boundary catches page/section render failures inside the gated shell
// and offers a real recovery action. The digest is what the operator needs
// to correlate with server logs.

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // surface it in the browser console for the operator
    console.error("[fleet] render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/10 ring-1 ring-rose-500/30">
        <TriangleAlert className="h-5 w-5 text-rose-400" />
      </span>
      <h1 className="text-base font-semibold text-zinc-100">
        Something broke on this screen
      </h1>
      <p className="mt-2 max-w-[40ch] text-balance text-sm leading-relaxed text-zinc-500">
        The dashboard hit an unexpected error while rendering. The rest of the
        fleet keeps running — retrying usually clears it.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-[12px] text-zinc-600">
          digest: {error.digest}
        </p>
      )}
      <Button
        onClick={reset}
        className="mt-6 h-11 gap-2 bg-emerald-500 px-5 font-semibold text-emerald-950 transition-all hover:bg-emerald-400"
      >
        <RotateCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
