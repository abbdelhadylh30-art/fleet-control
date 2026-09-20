"use client";

import { Activity } from "lucide-react";

import { ActivityPanel } from "@/components/activity-panel";
import { AppShell } from "@/components/app-shell";

export default function ActivityPage() {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-6 sm:px-6">
        {/* page header */}
        <div className="fade-up-item flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/25">
            <Activity className="h-4.5 w-4.5 text-emerald-400" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
              Indexing activity
            </h1>
            <p className="text-xs text-zinc-500">
              Every IndexNow submission across the fleet — newest first, with a
              7-day pulse.
            </p>
          </div>
        </div>

        <section aria-label="Indexing activity log">
          <ActivityPanel />
        </section>
      </main>
    </AppShell>
  );
}
