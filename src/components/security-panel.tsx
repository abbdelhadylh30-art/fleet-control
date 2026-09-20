"use client";

// ─── SecurityPanel — the security event log, visible in the dashboard ────────
// Closes the loop on the external review's "logs & alerting" point: failed
// capability attempts, rate limits, blocked paths and challenge-confirmed
// destructive ops are recorded by the backend — this panel surfaces them so a
// leak shows up HERE (with IP + UA) instead of being discovered via a rogue
// deploy. On serverless the file-backed copy is per-warm-instance; the
// durable channel is console.warn → Vercel log drain (noted in the footer).

import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  CheckCircle2,
  Eye,
  Loader2,
  RefreshCw,
  ScrollText,
  ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface SecurityEvent {
  t: string;
  kind: string;
  detail: string;
  ip: string;
  ua: string;
}

/** Color + icon per event kind family. */
function kindMeta(kind: string): {
  tone: string;
  icon: React.ComponentType<{ className?: string }>;
} {
  if (kind.endsWith("-rate-limited"))
    return {
      tone: "border-amber-500/25 bg-amber-500/10 text-amber-300",
      icon: Ban,
    };
  if (kind === "admin-gate-denied" || kind.startsWith("proxy-auth-failed"))
    return {
      tone: "border-rose-500/25 bg-rose-500/10 text-rose-300",
      icon: ShieldAlert,
    };
  if (kind === "proxy-path-rejected" || kind === "proxy-token-block")
    return {
      tone: "border-rose-500/25 bg-rose-500/10 text-rose-300",
      icon: Ban,
    };
  // challenge-confirmed destructive ops (selfops-redeploy, vercel-reattach, …)
  return {
    tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    icon: CheckCircle2,
  };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatUa(ua: string): string {
  if (ua === "unknown") return "unknown client";
  if (/curl/i.test(ua)) return "curl";
  if (/bot|spider|crawler/i.test(ua)) return "bot";
  if (/Chrome/i.test(ua)) return "Chrome";
  if (/Firefox/i.test(ua)) return "Firefox";
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return "Safari";
  return ua.slice(0, 24);
}

/** Security events feed for the Activity page. */
export function SecurityPanel() {
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/security", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { events: SecurityEvent[] };
        setEvents(json.events);
      }
    } catch {
      /* non-fatal */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="fade-up-item border-white/5 bg-zinc-900/60 backdrop-blur transition-colors duration-300 hover:border-emerald-500/15">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            <ScrollText className="h-4 w-4 text-emerald-400" />
            Security log
            {events && events.length > 0 && (
              <Badge
                variant="outline"
                className="border-white/10 bg-white/5 px-1.5 py-0 font-mono text-[10px] text-zinc-400"
              >
                {events.length}
              </Badge>
            )}
          </h2>
          <p className="mt-1 text-[11px] text-zinc-600">
            Auth failures, rate limits, blocked paths, challenge-confirmed ops.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={refreshing}
          onClick={() => void load(true)}
          aria-label="Refresh security log"
          className="h-8 w-8 p-0 text-zinc-500 hover:bg-white/5 hover:text-emerald-300"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      <div className="max-h-96 overflow-y-auto p-5 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
        {events === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading events…
          </div>
        ) : events.length === 0 ? (
          <p className="py-6 text-xs leading-relaxed text-zinc-500">
            No security events on this warm instance yet — failed key attempts,
            rate-limit hits and challenge-confirmed actions will appear here.
            The durable copy lives in the platform logs (console.warn).
          </p>
        ) : (
          <ul className="space-y-2">
            {events.map((e, i) => {
              const meta = kindMeta(e.kind);
              const Icon = meta.icon;
              const key = `${e.t}-${i}`;
              return (
                <li
                  key={key}
                  className="flex items-start gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5 transition-colors hover:border-white/10"
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ring-1 ${meta.tone}`}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <code className="text-[11px] font-semibold text-zinc-200">
                        {e.kind}
                      </code>
                      <span className="text-[10px] tabular-nums text-zinc-600">
                        {relativeTime(e.t)}
                      </span>
                      <span
                        title={e.ip}
                        className="rounded bg-white/5 px-1 py-px font-mono text-[9px] text-zinc-500"
                      >
                        {e.ip}
                      </span>
                      <span className="flex items-center gap-0.5 text-[9px] text-zinc-600">
                        <Eye className="h-2.5 w-2.5" />
                        {formatUa(e.ua)}
                      </span>
                    </div>
                    <p className="mt-0.5 break-words text-[11px] leading-relaxed text-zinc-500">
                      {e.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
