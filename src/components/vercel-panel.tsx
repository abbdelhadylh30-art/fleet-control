"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileClock,
  Info,
  Loader2,
  MoveRight,
  Unplug,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChallengeAction } from "@/lib/challenge-client";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Vercel "▲" mark (inline SVG — lucide has no brand icon). */
function VercelMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="currentColor" d="M12 3.5 22.5 21h-21L12 3.5z" />
    </svg>
  );
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

// ─── types ───────────────────────────────────────────────────────────────────

interface VercelStatusClient {
  connected: boolean;
  savedAt: string | null;
  account: { uid: string; username: string; email: string | null } | null;
}

interface VercelFinding {
  domain: string;
  currentProject: string | null;
  expectedProject: string | null;
  ok: boolean | null;
  note?: string;
}

interface VercelAudit {
  ok: boolean;
  error?: string;
  projects: Array<{ name: string; domains: string[] }>;
  findings: VercelFinding[];
}

// ─── component ───────────────────────────────────────────────────────────────

export function VercelOpsPanel() {
  const [status, setStatus] = useState<VercelStatusClient>({
    connected: false,
    savedAt: null,
    account: null,
  });
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [audit, setAudit] = useState<VercelAudit | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [moveResults, setMoveResults] = useState<
    Array<{ domain: string; ok: boolean; detail: string }>
  >([]);
  const [disconnecting, setDisconnecting] = useState(false);
  // domain moves still reshape production → two-step confirmation (challenge)
  const challenge = useChallengeAction();

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/vercel");
      if (res.ok) setStatus((await res.json()) as VercelStatusClient);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/vercel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "connect", token: token.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; username?: string };
      if (!res.ok || !json.ok) {
        setConnectError(json.error ?? `Connect failed (HTTP ${res.status})`);
        return;
      }
      const { toast } = await import("sonner");
      toast.success(`Vercel connected as ${json.username} — stored server-side, once`);
      setToken("");
      await loadStatus();
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "Connect failed");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/vercel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        const { toast } = await import("sonner");
        toast.error(json.error ?? `Disconnect failed (HTTP ${res.status})`);
        return;
      }
      const { toast } = await import("sonner");
      toast.success("Vercel token removed from the server");
      setAudit(null);
      setMoveResults([]);
      await loadStatus();
    } catch {
      const { toast } = await import("sonner");
      toast.error("Network error while disconnecting");
    } finally {
      setDisconnecting(false);
    }
  };

  const runAudit = async () => {
    setAuditing(true);
    setMoveResults([]);
    try {
      const res = await fetch("/api/vercel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "audit" }),
      });
      const json = (await res.json()) as VercelAudit;
      setAudit(json);
      if (json.ok) {
        const fixable = json.findings.filter((f) => f.ok === false).length;
        const { toast } = await import("sonner");
        if (fixable > 0) toast.warning(`${fixable} domain assignment(s) need a move`);
        else toast.success("All tracked domain assignments are correct");
      }
    } catch {
      setAudit({ ok: false, error: "Audit request failed", projects: [], findings: [] });
    } finally {
      setAuditing(false);
    }
  };

  const moveDomain = async (domain: string, toProject: string) => {
    await challenge.trigger("vercel-reattach", async (confirmToken) => {
      setMoving(domain);
      try {
        const res = await fetch("/api/vercel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reattach", domain, toProject, confirmToken }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          moved?: { from: string | null; to: string };
        };
        const { toast } = await import("sonner");
        if (res.ok && json.ok) {
          toast.success(
            `${domain} → ${toProject}${json.moved?.from ? ` (detached from ${json.moved.from})` : ""}`,
            { duration: 6000 },
          );
          setMoveResults((r) => [
            { domain, ok: true, detail: `now served by ${toProject}` },
            ...r,
          ]);
        } else {
          toast.error(json.error ?? "Move failed", { duration: 8000 });
          setMoveResults((r) => [
            { domain, ok: false, detail: json.error ?? `HTTP ${res.status}` },
            ...r,
          ]);
        }
        await loadStatus();
      } catch (e) {
        setMoveResults((r) => [
          { domain, ok: false, detail: e instanceof Error ? e.message : "network error" },
          ...r,
        ]);
      } finally {
        setMoving(null);
      }
    });
  };

  const fixable = (audit?.findings ?? []).filter((f) => f.ok === false);

  return (
    <div className="fade-up-item rounded-2xl border border-white/5 bg-zinc-900/60 p-5 backdrop-blur">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
          <VercelMark className="h-4 w-4 text-zinc-100" />
        </span>
        <h3 className="text-sm font-semibold text-zinc-100">
          Vercel ops — fix the stale domains in one click
        </h3>
        {status.connected ? (
          <Badge
            variant="outline"
            className="ml-auto gap-1 border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400 ring-1 ring-emerald-500/20"
          >
            <CheckCircle2 className="h-3 w-3" />
            connected{status.account ? ` · ${status.account.username}` : ""}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="ml-auto gap-1 border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400 ring-1 ring-white/10"
          >
            <Info className="h-3 w-3" /> optional — fixes 2 of the 5 blocked sites
          </Badge>
        )}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">
        The <span className="text-amber-400/90">leads.</span> and{" "}
        <span className="text-amber-400/90">dev.</span> subdomains still point at
        old Vercel projects, so they serve stale builds. Paste a Vercel API
        token <span className="text-zinc-400">once</span> (create at{" "}
        <a
          href="https://vercel.com/account/tokens"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-emerald-400 hover:underline"
        >
          vercel.com/account/tokens <ExternalLink className="h-3 w-3" />
        </a>
        ) and the dashboard can audit every domain → project assignment and
        re-attach the stale ones itself.
      </p>

      {!status.connected ? (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Vercel API token — stored server-side once, never in this browser"
              autoComplete="off"
              aria-label="Vercel API token"
              className="border-white/10 bg-white/[0.03] pr-9 font-mono text-xs text-zinc-200 placeholder:text-zinc-700 focus-visible:ring-emerald-500/40"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? "Hide token" : "Show token"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors hover:text-zinc-300"
            >
              {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Button
            size="sm"
            disabled={connecting || token.trim().length < 20}
            onClick={() => void connect()}
            className="h-9 gap-1.5 bg-emerald-500 px-4 text-xs font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <VercelMark className="h-3 w-3" />}
            Connect Vercel
          </Button>
        </div>
      ) : null}

      {connectError ? (
        <div className="mb-4 flex gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-300">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{connectError}</span>
        </div>
      ) : null}

      {status.connected ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={auditing || moving !== null}
            onClick={() => void runAudit()}
            className="h-8 gap-1.5 border border-white/10 bg-white/[0.04] text-xs text-zinc-200 hover:bg-white/[0.08]"
            variant="outline"
          >
            {auditing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoveRight className="h-3.5 w-3.5" />
            )}
            Audit domain → project assignments
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disconnecting}
            onClick={() => void disconnect()}
            className="h-8 gap-1 px-2 text-[11px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-rose-300"
          >
            {disconnecting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Unplug className="h-3 w-3" />
            )}{" "}
            {disconnecting ? "disconnecting…" : "disconnect"}
          </Button>
          <span className="text-[10px] text-zinc-600">
            {status.savedAt ? `token saved ${relativeTime(status.savedAt)}` : ""}
          </span>
        </div>
      ) : null}

      {/* audit findings */}
      {audit?.ok ? (
        <div className="mb-4 space-y-2">
          {audit.findings.map((f) => (
            <div
              key={f.domain}
              className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ${
                f.ok
                  ? "bg-emerald-500/[0.05] ring-emerald-500/15"
                  : "bg-amber-500/[0.05] ring-amber-500/20"
              }`}
            >
              {f.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              )}
              <span className="min-w-0 flex-1 text-xs leading-relaxed">
                <span className="font-mono text-zinc-300">{f.domain}</span>{" "}
                <span className="text-zinc-500">— {f.note}</span>
              </span>
              {!f.ok && f.expectedProject ? (
                <Button
                  size="sm"
                  disabled={moving !== null}
                  onClick={() => void moveDomain(f.domain, f.expectedProject as string)}
                  className={`h-7 shrink-0 gap-1 rounded-lg px-2.5 text-[11px] font-semibold ring-1 transition-all ${
                    challenge.armedOp === "vercel-reattach"
                      ? "animate-pulse bg-amber-500/20 text-amber-200 ring-amber-500/40 hover:bg-amber-500/30"
                      : "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25 hover:bg-emerald-500/25 hover:text-emerald-300"
                  }`}
                >
                  {moving === f.domain ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowRight className="h-3 w-3" />
                  )}
                  {challenge.armedOp === "vercel-reattach"
                    ? `Confirm move (${challenge.secondsLeft}s)`
                    : `Move to ${f.expectedProject}`}
                </Button>
              ) : null}
            </div>
          ))}
          {audit.projects.length > 0 ? (
            <details className="rounded-xl border border-white/5 bg-black/20 p-3">
              <summary className="cursor-pointer text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300">
                Full project → domain map ({audit.projects.length} projects)
              </summary>
              <div className="mt-2 space-y-1">
                {audit.projects.map((p) => (
                  <div key={p.name} className="flex items-start gap-2 text-[11px]">
                    <span className="w-44 shrink-0 truncate font-mono text-zinc-400">
                      {p.name}
                    </span>
                    <span className="min-w-0 flex-1 font-mono text-[10px] text-zinc-600">
                      {p.domains.length > 0 ? p.domains.join(", ") : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <p className="px-1 text-[10px] leading-relaxed text-zinc-600">
            Note: <span className="font-mono">landing.</span>{" "}
            <span className="font-mono">ledger.</span>{" "}
            <span className="font-mono">profile.</span> can&apos;t be fixed by a
            move — their repos aren&apos;t git-linked to any project yet. Import
            them in the Vercel dashboard (Add New → Project → Import Git
            Repository), then this audit shows them too.
          </p>
        </div>
      ) : audit && !audit.ok ? (
        <div className="mb-4 flex gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-300">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{audit.error}</span>
        </div>
      ) : null}

      {/* move results */}
      {moveResults.length > 0 ? (
        <div className="mb-4 rounded-xl border border-white/5 bg-black/20 p-3">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <FileClock className="h-3 w-3" /> Move log
          </h4>
          <div className="space-y-1">
            {moveResults.map((r, i) => (
              <div key={`${r.domain}-${i}`} className="flex items-center gap-2 text-[11px]">
                {r.ok ? (
                  <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="h-2.5 w-2.5 shrink-0 text-rose-500" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-zinc-400">
                  {r.domain}
                </span>
                <span className={`shrink-0 ${r.ok ? "text-emerald-400" : "text-rose-400"}`}>
                  {r.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <p className="cursor-default text-[10px] leading-relaxed text-zinc-600">
            Token scope: it can list your projects and move fleet domains only
            (guarded to *.abdelhadygabriel.me). Stored server-side with
            restrictive permissions, never logged, removable any time.
          </p>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-72 border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">
          Prefer a narrower token? Create one scoped to a single project — the
          audit needs read access, the move button needs write on the two
          target projects (lead-profiler-deploy, abdelhady-gabriel).
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
