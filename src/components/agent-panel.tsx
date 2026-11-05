"use client";

// ─── Agent access panel — approval flow + token vault ───────────────────────
// v22 (2026-11-05): the ONLY way an AI gets in is the approval flow at the
// top (temp password fac_… → the AI asks → you approve/deny → it works under
// a 1-hour derived session). Direct agent links and pair codes are retired.
// This panel keeps the TOKEN VAULT — add or disconnect the GitHub/Vercel
// tokens by will, stored durably server-side (Postgres) — plus the audit
// feed of everything approved sessions do.

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
  History,
  Info,
  KeyRound,
  Loader2,
  ShieldCheck,
  Unplug,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AccessApprovalCard } from "@/components/access-approval-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** GitHub mark (inline SVG — octocat silhouette). */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

/** Vercel "▲" mark (inline SVG). */
function VercelMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="currentColor" d="M12 3l10 17.5H2L12 3z" />
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

interface VaultStatus {
  github: {
    connected: boolean;
    savedAt: string | null;
    account: { login: string; type: string; scopes: string | null } | null;
    disabledAt?: string | null;
    source?: "vault" | "env" | null;
  };
  vercel: {
    connected: boolean;
    savedAt: string | null;
    account: { uid: string; username: string; email: string | null } | null;
    disabledAt?: string | null;
    source?: "vault" | "env" | null;
  };
  scopes: string[];
  sessions: Array<{
    id: string;
    keyHint: string;
    label: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string;
    lastUsedAt: string | null;
    callCount: number;
    revoked: boolean;
  }>;
  activity: Array<{
    t: string;
    label: string;
    provider: string;
    op: string;
    ok: boolean;
    status: number | string;
  }>;
}

// ─── component ───────────────────────────────────────────────────────────────

export function AgentAccessPanel() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [ghToken, setGhToken] = useState("");
  const [ghShow, setGhShow] = useState(false);
  const [ghBusy, setGhBusy] = useState(false);
  const [vcToken, setVcToken] = useState("");
  const [vcShow, setVcShow] = useState(false);
  const [vcBusy, setVcBusy] = useState(false);
  const [discBusy, setDiscBusy] = useState<"github" | "vercel" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent");
      if (res.ok) setStatus((await res.json()) as VaultStatus);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> => {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean; error?: string };
  };

  const connectGithub = async () => {
    setGhBusy(true);
    try {
      const json = await post({ action: "connect-github", token: ghToken.trim() });
      if (json.ok) {
        toast.success(`GitHub connected as ${String(json.login)} — vaulted server-side`, {
          duration: 6000,
        });
        setGhToken("");
        await load();
      } else {
        toast.error(String(json.error ?? "connect failed"), { duration: 8000 });
      }
    } finally {
      setGhBusy(false);
    }
  };

  const connectVercel = async () => {
    setVcBusy(true);
    try {
      const json = await post({ action: "connect-vercel", token: vcToken.trim() });
      if (json.ok) {
        toast.success(`Vercel connected as ${String(json.username)} — vaulted server-side`, {
          duration: 6000,
        });
        setVcToken("");
        await load();
      } else {
        toast.error(String(json.error ?? "connect failed"), { duration: 8000 });
      }
    } finally {
      setVcBusy(false);
    }
  };

  const disconnect = async (provider: "github" | "vercel") => {
    setDiscBusy(provider);
    try {
      const json = await post({ action: `disconnect-${provider}` });
      if (json.ok) {
        toast.success(
          `${
            provider === "github" ? "GitHub" : "Vercel"
          } token removed — the vault is fully disconnected (env fallback disabled too until you reconnect)`,
          { duration: 7000 },
        );
      } else {
        toast.error(String(json.error ?? "disconnect failed"), { duration: 8000 });
      }
      await load();
    } finally {
      setDiscBusy(null);
    }
  };

  const gh = status?.github ?? { connected: false, savedAt: null, account: null, source: null };
  const vc = status?.vercel ?? { connected: false, savedAt: null, account: null, source: null };
  const activity = status?.activity ?? [];

  return (
    <div className="fade-up-item space-y-4">
      {/* ── the only access path: temp password → request → you approve ── */}
      <AccessApprovalCard />

      {/* ── the token vault: add & disconnect by will ─────────────────── */}
      <div className="rounded-2xl border border-emerald-500/15 bg-zinc-900/60 p-5 backdrop-blur">
        {/* header */}
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/25">
            <KeyRound className="h-4 w-4 text-emerald-400" />
          </span>
          <h3 className="text-sm font-semibold text-zinc-100">
            Token vault — add &amp; disconnect anytime
          </h3>
          <Badge
            variant="outline"
            className="ml-auto gap-1 border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400 ring-1 ring-emerald-500/20"
          >
            <ShieldCheck className="h-3 w-3" />
            {gh.connected || vc.connected
              ? `vault: ${[gh.connected && "GitHub", vc.connected && "Vercel"].filter(Boolean).join(" + ")}`
              : "vault empty"}
          </Badge>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-zinc-400">
          The approval flow above is the only way an AI gets in. This vault is
          what that flow uses: paste a token{" "}
          <span className="text-zinc-200">here</span> — it is validated live and
          stored server-side (durable, never exposed) — or{" "}
          <span className="text-zinc-200">disconnect</span> it in one click and
          every approved session loses that provider instantly.
        </p>

        {/* connections */}
        <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* github */}
          <div className="rounded-xl border border-white/5 bg-black/20 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <GithubMark className="h-3.5 w-3.5 text-zinc-100" />
              <span className="text-xs font-semibold text-zinc-200">GitHub</span>
              {gh.connected ? (
                <Badge
                  variant="outline"
                  className="ml-auto gap-1 border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[9px] text-emerald-400"
                >
                  <CheckCircle2 className="h-2.5 w-2.5" /> {gh.account?.login}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="ml-auto gap-1 border-white/10 bg-white/[0.03] px-1.5 py-0 text-[9px] text-zinc-400"
                >
                  <Info className="h-2.5 w-2.5" /> not connected
                </Badge>
              )}
            </div>
            {gh.connected ? (
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-400">
                  {gh.source === "env" ? (
                    <span className="text-amber-300">
                      env fallback active — paste your own token below to override it
                    </span>
                  ) : (
                    <>
                      saved {gh.savedAt ? relativeTime(gh.savedAt) : ""} · vaulted in Postgres ·
                      never leaves the server
                    </>
                  )}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-400">
                    agent proxy uses this token immediately
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={discBusy !== null}
                    onClick={() => void disconnect("github")}
                    className="h-7 gap-1 px-2 text-[10px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-rose-300"
                  >
                    {discBusy === "github" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Unplug className="h-3 w-3" />
                    )}{" "}
                    {discBusy === "github" ? "disconnecting…" : "disconnect"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Input
                    type={ghShow ? "text" : "password"}
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                    placeholder="GitHub PAT (github.com/settings/tokens)"
                    autoComplete="off"
                    aria-label="GitHub personal access token"
                    className="border-white/10 bg-white/[0.03] pr-9 font-mono text-xs text-zinc-200 placeholder:text-zinc-400 focus-visible:ring-emerald-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setGhShow((v) => !v)}
                    aria-label={ghShow ? "Hide token" : "Show token"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    {ghShow ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  size="sm"
                  disabled={ghBusy || ghToken.trim().length < 20}
                  onClick={() => void connectGithub()}
                  className="h-8 gap-1.5 bg-emerald-500 text-xs font-semibold text-emerald-950 hover:bg-emerald-400"
                >
                  {ghBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GithubMark className="h-3 w-3" />}
                  Validate &amp; vault it
                </Button>
              </div>
            )}
          </div>

          {/* vercel */}
          <div className="rounded-xl border border-white/5 bg-black/20 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <VercelMark className="h-3 w-3 text-zinc-100" />
              <span className="text-xs font-semibold text-zinc-200">Vercel</span>
              {vc.connected ? (
                <Badge
                  variant="outline"
                  className="ml-auto gap-1 border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[9px] text-emerald-400"
                >
                  <CheckCircle2 className="h-2.5 w-2.5" /> {vc.account?.username}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="ml-auto gap-1 border-white/10 bg-white/[0.03] px-1.5 py-0 text-[9px] text-zinc-400"
                >
                  <Info className="h-2.5 w-2.5" /> not connected
                </Badge>
              )}
            </div>
            {vc.connected ? (
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-400">
                  {vc.source === "env" ? (
                    <span className="text-amber-300">
                      env fallback active — paste your own token below to override it
                    </span>
                  ) : (
                    <>
                      saved {vc.savedAt ? relativeTime(vc.savedAt) : ""} · vaulted in Postgres ·
                      shared with the Vercel ops panel
                    </>
                  )}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-400">
                    agent proxy + domain ops use this token immediately
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={discBusy !== null}
                    onClick={() => void disconnect("vercel")}
                    className="h-7 gap-1 px-2 text-[10px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-rose-300"
                  >
                    {discBusy === "vercel" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Unplug className="h-3 w-3" />
                    )}{" "}
                    {discBusy === "vercel" ? "disconnecting…" : "disconnect"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Input
                    type={vcShow ? "text" : "password"}
                    value={vcToken}
                    onChange={(e) => setVcToken(e.target.value)}
                    placeholder="Vercel token (vercel.com/account/tokens)"
                    autoComplete="off"
                    aria-label="Vercel API token"
                    className="border-white/10 bg-white/[0.03] pr-9 font-mono text-xs text-zinc-200 placeholder:text-zinc-400 focus-visible:ring-emerald-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setVcShow((v) => !v)}
                    aria-label={vcShow ? "Hide token" : "Show token"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    {vcShow ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  size="sm"
                  disabled={vcBusy || vcToken.trim().length < 20}
                  onClick={() => void connectVercel()}
                  className="h-8 gap-1.5 bg-emerald-500 text-xs font-semibold text-emerald-950 hover:bg-emerald-400"
                >
                  {vcBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <VercelMark className="h-3 w-3" />}
                  Validate &amp; vault it
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* activity */}
        {activity.length > 0 ? (
          <div className="mb-4 rounded-xl border border-white/5 bg-black/20 p-4">
            <div className="mb-2 flex items-center gap-2">
              <History className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-xs font-semibold text-zinc-200">Agent activity</span>
              <span className="ml-auto text-[10px] text-zinc-400">
                newest first · every proxied call is recorded
              </span>
            </div>
            <div className="scrollbar-thin max-h-44 space-y-1 overflow-y-auto pr-1">
              {activity.slice(0, 12).map((a, i) => (
                <div key={`${a.t}-${i}`} className="flex items-center gap-2 text-[10px]">
                  {a.ok ? (
                    <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="h-2.5 w-2.5 shrink-0 text-rose-500" />
                  )}
                  <span className="w-14 shrink-0 text-zinc-400">{relativeTime(a.t)}</span>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-white/10 px-1 py-0 text-[8px] uppercase text-zinc-400"
                  >
                    {a.provider}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{a.op}</span>
                  <span className="shrink-0 text-zinc-400">{String(a.status)}</span>
                  <span className="hidden shrink-0 text-zinc-400 sm:inline">· {a.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <p className="cursor-default text-[10px] leading-relaxed text-zinc-400">
              Security model: tokens live in the durable server-side vault
              (Postgres via pg-state) and never reach the browser after saving.
              Approved sessions are scoped, expire after one hour, and every
              call they make is audited above. Mutations are allow-listed
              (repos content/issues, projects/domains, deployments) and token
              endpoints are blocked.
            </p>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-72 border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">
            Tip: disconnecting a provider instantly cuts that provider off from
            every live session — no need to wait for sessions to expire.{" "}
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-emerald-400 hover:underline"
            >
              github.com/settings/tokens <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}