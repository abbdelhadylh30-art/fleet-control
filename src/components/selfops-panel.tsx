"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  HardDrive,
  KeyRound,
  Loader2,
  RefreshCw,
  Rocket,
  Server,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useChallengeAction } from "@/lib/challenge-client";
import { toast } from "sonner";

interface SelfOpsStatus {
  fsWritable: boolean;
  project: string;
  envKeys: { hint: string; scopes: string[] }[];
  latest: {
    uid: string;
    readyState: string;
    createdAt: number | null;
    url: string | null;
    sha: string | null;
    target: string | null;
  } | null;
  latestError?: string;
}

function relativeTime(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ACTIVE_STATES = ["QUEUED", "INITIALIZING", "BUILDING"];

function StateDot({ state }: { state: string }) {
  const color = state.startsWith("READY")
    ? "bg-emerald-400"
    : ACTIVE_STATES.includes(state)
      ? "bg-amber-400"
      : "bg-rose-400";
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-50`} />
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}

/** Deployment health + self-operation controls for the dashboard's own Vercel project. */
export function SelfOpsPanel() {
  const [status, setStatus] = useState<SelfOpsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  // destructive op → two-step confirmation (one-time challenge token)
  const challenge = useChallengeAction();
  const armedRedeploy = challenge.armedOp === "selfops-redeploy";

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/selfops", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as SelfOpsStatus);
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

  // auto-poll while a deployment is in flight
  useEffect(() => {
    if (!status?.latest) return;
    if (!ACTIVE_STATES.includes(status.latest.readyState)) return;
    const t = setTimeout(() => void load(), 8000);
    return () => clearTimeout(t);
  }, [status, load]);

  const redeploy = async () => {
    await challenge.trigger("selfops-redeploy", async (confirmToken) => {
      setDeploying(true);
      try {
        const res = await fetch("/api/selfops", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "redeploy", confirmToken }),
        });
        const json = (await res.json()) as { ok: boolean; uid?: string; error?: string };
        if (json.ok) {
          toast.success("Production redeploy triggered — new build goes live in ~60s", {
            duration: 6000,
          });
          setTimeout(() => void load(), 3000);
        } else {
          toast.error(json.error ?? "Redeploy failed");
        }
      } catch {
        toast.error("Network error while triggering the redeploy");
      } finally {
        setDeploying(false);
      }
    });
  };

  const building = status?.latest ? ACTIVE_STATES.includes(status.latest.readyState) : false;
  const connected = !!status?.latest || !status?.latestError;

  return (
    <Card className="fade-up-item border-white/5 bg-zinc-900/60 backdrop-blur transition-colors duration-300 hover:border-emerald-500/15">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            <Server className="h-4 w-4 text-emerald-400" />
            Self-ops
            <Badge
              variant="outline"
              className="border-emerald-500/20 bg-emerald-500/5 px-1.5 py-0 font-mono text-[10px] text-emerald-300"
            >
              {status?.project ?? "…"}
            </Badge>
          </h2>
          <p className="mt-1 text-[11px] text-zinc-600">
            The dashboard watches its own production deployment — and can heal it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={deploying || building}
            onClick={() => void redeploy()}
            aria-label={armedRedeploy ? "Confirm the production redeploy" : "Redeploy production — requires a confirmation click"}
            className={`h-8 gap-1.5 px-3 text-xs ring-1 transition-all ${
              armedRedeploy
                ? "animate-pulse bg-amber-500/20 text-amber-200 ring-amber-500/40 hover:bg-amber-500/30"
                : "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/25 hover:text-emerald-200"
            }`}
          >
            {deploying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : armedRedeploy ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            {building
              ? "deploying…"
              : armedRedeploy
                ? `Confirm redeploy (${challenge.secondsLeft}s)`
                : "Redeploy production"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={refreshing}
            onClick={() => void load(true)}
            aria-label="Refresh self-ops status"
            className="h-8 w-8 p-0 text-zinc-500 hover:bg-white/5 hover:text-emerald-300"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-px bg-white/5 sm:grid-cols-3">
        {/* latest production deploy */}
        <div className="bg-zinc-900/60 p-5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            <Rocket className="h-3 w-3" /> Latest production deploy
          </p>
          {loading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> checking…
            </div>
          ) : status?.latest ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <StateDot state={status.latest.readyState} />
                <span className="text-sm font-semibold text-zinc-200">
                  {status.latest.readyState}
                </span>
                <span className="text-[11px] tabular-nums text-zinc-600">
                  {relativeTime(status.latest.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                {status.latest.sha && (
                  <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {status.latest.sha}
                  </code>
                )}
                {status.latest.url && (
                  <a
                    href={`https://${status.latest.url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 transition-colors hover:text-emerald-300"
                  >
                    {status.latest.url.slice(0, 28)}…
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              {status?.latestError
                ? "Vercel not connected — link it on the Integrations page to monitor deploys."
                : "No production deployment found."}
            </p>
          )}
        </div>

        {/* persistence probe */}
        <div className="bg-zinc-900/60 p-5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            <HardDrive className="h-3 w-3" /> Link persistence
          </p>
          {loading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> probing…
            </div>
          ) : status?.fsWritable ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Filesystem writable
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Minted agent links persist here — this instance stores sessions on disk.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                <AlertTriangle className="h-4 w-4" /> Read-only filesystem
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                UI-minted links vanish on cold start — mint, then hit{" "}
                <span className="text-amber-300">Make permanent</span> to copy the key into
                the deployment env.
              </p>
            </div>
          )}
        </div>

        {/* env agent keys */}
        <div className="bg-zinc-900/60 p-5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            <KeyRound className="h-3 w-3" /> Permanent agent keys
          </p>
          {loading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading…
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {status?.envKeys.length ? (
                  status.envKeys.map((k) => (
                    <span
                      key={k.hint}
                      className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                      title={`scopes: ${k.scopes.join(", ")}`}
                    >
                      {k.hint}
                      <span
                        className={`rounded px-1 text-[8px] uppercase tracking-wide ${
                          k.scopes.length === 4
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {k.scopes.length === 4 ? "full" : "scoped"}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-zinc-600">none configured</span>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                {connected
                  ? "Always-valid env links — survive cold starts; promoted links keep their minted scopes."
                  : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
