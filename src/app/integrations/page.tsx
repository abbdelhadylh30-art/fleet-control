"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug } from "lucide-react";

import { AgentAccessPanel } from "@/components/agent-panel";
import { AppShell } from "@/components/app-shell";
import { GscPerformancePanel } from "@/components/gsc-performance";
import { GoogleIndexingPanel } from "@/components/google-panel";
import { SetupGuide } from "@/components/setup-guide";
import { VercelOpsPanel } from "@/components/vercel-panel";
import type { FleetResponse } from "@/lib/fleet";

export default function IntegrationsPage() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as FleetResponse);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sites = data?.sites ?? [];
  const gsc = data?.gsc ?? { checked: false, verified: false, record: null };
  const bing = data?.bing ?? { checked: false, verified: false, record: null };

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-6 sm:px-6">
        {/* page header */}
        <div className="fade-up-item flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/25">
            <Plug className="h-4.5 w-4.5 text-emerald-400" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
              Integrations &amp; setup
            </h1>
            <p className="text-xs text-zinc-500">
              Vault your tokens, connect Google once, fix Vercel assignments —
              everything external lives here.
            </p>
          </div>
        </div>

        <section aria-label="Integrations" className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/5 bg-zinc-900/60 py-16 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> loading fleet data…
            </div>
          ) : (
            <>
              <SetupGuide sites={sites} gsc={gsc} bing={bing} />
              <GscPerformancePanel />
              <AgentAccessPanel />
              <GoogleIndexingPanel sites={sites} gsc={gsc} />
              <VercelOpsPanel />
            </>
          )}
        </section>
      </main>
    </AppShell>
  );
}
