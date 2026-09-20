"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  History,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  ShieldCheck,
  Unplug,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

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

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}

async function copyText(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    toast.success(message);
  }
}

// ─── types ───────────────────────────────────────────────────────────────────

interface VaultStatus {
  github: {
    connected: boolean;
    savedAt: string | null;
    account: { login: string; type: string; scopes: string | null } | null;
  };
  vercel: {
    connected: boolean;
    savedAt: string | null;
    account: { uid: string; username: string; email: string | null } | null;
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

interface MintedLink {
  id: string;
  key: string;
  url: string;
  expiresAt: string;
  scopes: string[];
}

const SCOPE_META: Record<string, { label: string; hint: string }> = {
  "github:read": { label: "GitHub read", hint: "browse repos, files, issues, actions" },
  "github:write": { label: "GitHub write", hint: "push files, open issues, trigger deploys" },
  "vercel:read": { label: "Vercel read", hint: "list projects, deployments, audit domains" },
  "vercel:write": { label: "Vercel write", hint: "move domains, redeploy, manage projects" },
};

const TTL_OPTIONS = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];

// ─── component ───────────────────────────────────────────────────────────────

export function AgentAccessPanel() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [ghToken, setGhToken] = useState("");
  const [ghShow, setGhShow] = useState(false);
  const [ghBusy, setGhBusy] = useState(false);
  const [vcToken, setVcToken] = useState("");
  const [vcShow, setVcShow] = useState(false);
  const [vcBusy, setVcBusy] = useState(false);

  const [sessLabel, setSessLabel] = useState("");
  const [sessScopes, setSessScopes] = useState<string[]>(["github:read", "vercel:read"]);
  const [sessTtl, setSessTtl] = useState(168);
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<MintedLink | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [discBusy, setDiscBusy] = useState<"github" | "vercel" | null>(null);
  const [promoting, setPromoting] = useState(false);
  // one-time pairing codes — the link never enters the chat transcript
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairHint, setPairHint] = useState("");
  const [pairSeconds, setPairSeconds] = useState(0);
  const [pairLoading, setPairLoading] = useState(false);
  // destructive ops → two-step confirmation (one-time challenge tokens)
  const challenge = useChallengeAction();

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

  // pairing-code countdown — clears the code when it hits zero
  useEffect(() => {
    if (!pairCode) return;
    const t = setInterval(() => {
      setPairSeconds((s) => {
        if (s <= 1) {
          setPairCode(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [pairCode]);

  const makePair = async () => {
    setPairLoading(true);
    try {
      const res = await fetch("/api/agent/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const json = (await res.json()) as {
        ok: boolean;
        code?: string;
        expiresAt?: string;
        parentHint?: string;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.code) {
        toast.error(String(json.error ?? "could not generate a pairing code"), { duration: 8000 });
        return;
      }
      setPairCode(json.code);
      setPairHint(json.parentHint ?? "");
      const ms = json.expiresAt ? new Date(json.expiresAt).getTime() - Date.now() : 600_000;
      setPairSeconds(Math.max(1, Math.round(ms / 1000)));
      toast.success("Pairing code ready — paste it in chat, not the link", { duration: 6000 });
    } catch {
      toast.error("pairing request failed");
    } finally {
      setPairLoading(false);
    }
  };

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
          `${provider === "github" ? "GitHub" : "Vercel"} token removed from the vault`,
        );
      } else {
        toast.error(String(json.error ?? "disconnect failed"), { duration: 8000 });
      }
      await load();
    } finally {
      setDiscBusy(null);
    }
  };

  const toggleScope = (s: string) => {
    setSessScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const mint = async () => {
    if (sessScopes.length === 0) {
      toast.error("Pick at least one scope first");
      return;
    }
    setMinting(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create-session",
          label: sessLabel.trim() || "chat agent",
          scopes: sessScopes,
          ttlHours: sessTtl,
        }),
      });
      const json = (await res.json()) as MintedLink & { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast.error(String(json.error ?? "could not mint link"), { duration: 8000 });
        return;
      }
      setMinted({
        id: json.id,
        key: json.key,
        url: json.url,
        expiresAt: json.expiresAt,
        scopes: json.scopes,
      });
      toast.success("Agent link minted — copy it into the chat", { duration: 6000 });
      await load();
    } finally {
      setMinting(false);
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await post({ action: "revoke-session", id });
      toast.success("Agent link revoked — it can no longer be used");
      if (minted?.id === id) setMinted(null);
      await load();
    } finally {
      setRevoking(null);
    }
  };

  /** Copy this freshly-minted key into the deployed instance's FLEET_AGENT_KEYS
   *  + redeploy production, so the link survives serverless cold starts. */
  const promote = async () => {
    if (!minted) return;
    await challenge.trigger("selfops-promote", async (confirmToken) => {
      setPromoting(true);
      try {
        const res = await fetch("/api/selfops", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "promote", key: minted.key, confirmToken }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          updated?: boolean;
          redeployUid?: string;
          error?: string;
        };
        if (json.ok) {
          toast.success(
            json.updated
              ? "Key copied to the deployment env — production is redeploying, link is cold-start-proof in ~1 min"
              : "Key is already permanent on the deployment",
            { duration: 8000 },
          );
        } else {
          toast.error(json.error ?? "could not promote the key", { duration: 8000 });
        }
      } catch {
        toast.error("Network error while promoting the key");
      } finally {
        setPromoting(false);
      }
    });
  };

  const gh = status?.github ?? { connected: false, savedAt: null, account: null };
  const vc = status?.vercel ?? { connected: false, savedAt: null, account: null };
  const sessions = status?.sessions ?? [];
  const activity = status?.activity ?? [];
  const activeCount = sessions.filter((s) => !s.revoked && new Date(s.expiresAt) > new Date()).length;

  return (
    <div className="fade-up-item rounded-2xl border border-emerald-500/15 bg-zinc-900/60 p-5 backdrop-blur">
      {/* header */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/25">
          <KeyRound className="h-4 w-4 text-emerald-400" />
        </span>
        <h3 className="text-sm font-semibold text-zinc-100">
          Agent access — connect tokens once, then just send the link
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
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">
        Paste your tokens <span className="text-zinc-300">here</span> — not in the
        chat. Then mint a scoped, expiring{" "}
        <span className="text-emerald-400">agent link</span> and paste{" "}
        <span className="text-emerald-400">that</span> into the chat. The AI works
        through this dashboard&apos;s server-side vault; your real tokens never
        appear in any conversation, and a link can be revoked any time without
        touching the tokens.
      </p>

      {/* 4-step flow */}
      <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-4">
        {[
          { icon: <KeyRound className="h-3.5 w-3.5" />, title: "1 · Connect", text: "paste tokens here, stored server-side (chmod 600)" },
          { icon: <Link2 className="h-3.5 w-3.5" />, title: "2 · Mint link", text: "scoped + expiring, shown once" },
          { icon: <Copy className="h-3.5 w-3.5" />, title: "3 · Send link", text: "paste it in the chat — never a token" },
          { icon: <Zap className="h-3.5 w-3.5" />, title: "4 · AI works", text: "every call logged here; revoke anytime" },
        ].map((s) => (
          <div
            key={s.title}
            className="rounded-xl border border-white/5 bg-white/[0.02] p-3 transition-colors hover:border-emerald-500/20 hover:bg-emerald-500/[0.04]"
          >
            <div className="mb-1 flex items-center gap-1.5 text-emerald-400">
              {s.icon}
              <span className="text-[11px] font-semibold">{s.title}</span>
            </div>
            <p className="text-[10px] leading-relaxed text-zinc-500">{s.text}</p>
          </div>
        ))}
      </div>

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
                className="ml-auto gap-1 border-white/10 bg-white/[0.03] px-1.5 py-0 text-[9px] text-zinc-500"
              >
                <Info className="h-2.5 w-2.5" /> not connected
              </Badge>
            )}
          </div>
          {gh.connected ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-zinc-600">
                saved {gh.savedAt ? relativeTime(gh.savedAt) : ""} · never leaves the server
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={discBusy !== null}
                onClick={() => void disconnect("github")}
                className="h-7 gap-1 px-2 text-[10px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-rose-300"
              >
                {discBusy === "github" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Unplug className="h-3 w-3" />
                )}{" "}
                {discBusy === "github" ? "disconnecting…" : "disconnect"}
              </Button>
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
                  className="border-white/10 bg-white/[0.03] pr-9 font-mono text-xs text-zinc-200 placeholder:text-zinc-700 focus-visible:ring-emerald-500/40"
                />
                <button
                  type="button"
                  onClick={() => setGhShow((v) => !v)}
                  aria-label={ghShow ? "Hide token" : "Show token"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors hover:text-zinc-300"
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
                className="ml-auto gap-1 border-white/10 bg-white/[0.03] px-1.5 py-0 text-[9px] text-zinc-500"
              >
                <Info className="h-2.5 w-2.5" /> not connected
              </Badge>
            )}
          </div>
          {vc.connected ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-zinc-600">
                saved {vc.savedAt ? relativeTime(vc.savedAt) : ""} · shared with the Vercel ops panel
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={discBusy !== null}
                onClick={() => void disconnect("vercel")}
                className="h-7 gap-1 px-2 text-[10px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-rose-300"
              >
                {discBusy === "vercel" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Unplug className="h-3 w-3" />
                )}{" "}
                {discBusy === "vercel" ? "disconnecting…" : "disconnect"}
              </Button>
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
                  className="border-white/10 bg-white/[0.03] pr-9 font-mono text-xs text-zinc-200 placeholder:text-zinc-700 focus-visible:ring-emerald-500/40"
                />
                <button
                  type="button"
                  onClick={() => setVcShow((v) => !v)}
                  aria-label={vcShow ? "Hide token" : "Show token"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors hover:text-zinc-300"
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

      {/* mint a link */}
      <div className="mb-4 rounded-xl border border-white/5 bg-black/20 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Plus className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs font-semibold text-zinc-200">Mint an agent link</span>
          <span className="ml-auto text-[10px] text-zinc-600">
            {activeCount} active link{activeCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* left: label + ttl */}
          <div className="space-y-2">
            <Input
              value={sessLabel}
              onChange={(e) => setSessLabel(e.target.value)}
              placeholder="Label — e.g. “chat agent, Sept 20”"
              aria-label="Agent link label"
              className="border-white/10 bg-white/[0.03] text-xs text-zinc-200 placeholder:text-zinc-700 focus-visible:ring-emerald-500/40"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Clock className="h-3 w-3 text-zinc-600" />
              <span className="text-[10px] text-zinc-500">expires after</span>
              {TTL_OPTIONS.map((o) => (
                <button
                  key={o.hours}
                  type="button"
                  onClick={() => setSessTtl(o.hours)}
                  aria-pressed={sessTtl === o.hours}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium ring-1 transition-all ${
                    sessTtl === o.hours
                      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                      : "bg-white/[0.03] text-zinc-500 ring-white/10 hover:text-zinc-300"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={minting || sessScopes.length === 0}
              onClick={() => void mint()}
              className="h-8 w-full gap-1.5 bg-emerald-500 text-xs font-semibold text-emerald-950 hover:bg-emerald-400 sm:w-auto sm:px-4"
            >
              {minting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Generate agent link
            </Button>
          </div>

          {/* right: scopes */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              scopes the link grants
            </span>
            {Object.entries(SCOPE_META).map(([scope, meta]) => {
              const checked = sessScopes.includes(scope);
              return (
                <label
                  key={scope}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 transition-all ${
                    checked
                      ? "bg-emerald-500/[0.06] ring-emerald-500/25"
                      : "bg-white/[0.02] ring-white/5 hover:ring-white/15"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleScope(scope)}
                    className="h-3 w-3 accent-emerald-500"
                    aria-label={scope}
                  />
                  <span className={`text-[11px] font-medium ${checked ? "text-emerald-300" : "text-zinc-400"}`}>
                    {meta.label}
                  </span>
                  <span className="ml-auto truncate text-[10px] text-zinc-600">{meta.hint}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* pair a chat — one-time code, the link never enters the transcript */}
        <div className="mb-4 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 text-sky-400" />
            <span className="text-xs font-semibold text-zinc-200">
              Pair a chat — no link in the transcript
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pairLoading}
              onClick={() => void makePair()}
              className="ml-auto h-8 gap-1.5 border-sky-500/30 px-3 text-xs text-sky-300 hover:bg-sky-500/10"
            >
              {pairLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Generate pair code
            </Button>
          </div>
          {pairCode ? (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-[11px] text-sky-300">
                  {pairCode}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText(pairCode, "Pairing code copied — paste it in chat")}
                  className="h-9 shrink-0 gap-1.5 border-white/15 px-3 text-xs text-zinc-300 hover:bg-white/5"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy code
                </Button>
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                One-time · expires in <span className="font-semibold text-sky-300">{pairSeconds}s</span> · bound to{" "}
                <span className="font-mono">{pairHint}</span>. Paste ONLY this code in chat — the AI exchanges it
                for a 1-hour session at <span className="font-mono">/api/agent/exchange</span>. The agent link
                itself stays here in the dashboard.
              </p>
            </div>
          ) : (
            <p className="text-[10px] leading-relaxed text-zinc-500">
              A one-time 10-minute code your chat AI can trade for a 1-hour derived session — the long-lived
              link never has to be pasted anywhere. Even if the transcript leaks, all it holds is a code that
              is already dead.
            </p>
          )}
        </div>

        {/* minted result */}
        {minted ? (
          <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-[11px] font-semibold text-emerald-300">
                Link minted — copy it into the chat now
              </span>
              <Badge
                variant="outline"
                className="ml-auto gap-1 border-emerald-500/25 px-1.5 py-0 text-[9px] text-emerald-400"
              >
                {minted.scopes.length} scope{minted.scopes.length === 1 ? "" : "s"} · expires{" "}
                {timeUntil(minted.expiresAt)}
              </Badge>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-[11px] text-emerald-300">
                {`${typeof window !== "undefined" ? window.location.origin : ""}${minted.url}`}
              </code>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    void copyText(
                      `${typeof window !== "undefined" ? window.location.origin : ""}${minted.url}`,
                      "Agent link copied — paste it into the chat",
                    )
                  }
                  className="h-9 flex-1 gap-1.5 bg-emerald-500 px-3 text-xs font-semibold text-emerald-950 hover:bg-emerald-400 sm:flex-none"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy link
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      onClick={() => void promote()}
                      disabled={promoting}
                      className={`h-9 gap-1.5 px-2.5 text-xs ring-1 transition-all ${
                        challenge.armedOp === "selfops-promote"
                          ? "animate-pulse bg-amber-500/25 text-amber-200 ring-amber-500/50 hover:bg-amber-500/35"
                          : "bg-amber-500/15 text-amber-300 ring-amber-500/30 hover:bg-amber-500/25 hover:text-amber-200"
                      }`}
                    >
                      {promoting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      {challenge.armedOp === "selfops-promote"
                        ? `Confirm (${challenge.secondsLeft}s)`
                        : "Make permanent"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-56 border border-white/10 bg-zinc-900 text-[10px] leading-relaxed text-zinc-300">
                    Copies this key into the deployed instance&apos;s env and redeploys
                    production — the link then survives serverless cold starts, keeping
                    exactly the scopes it was minted with (nothing more).
                  </TooltipContent>
                </Tooltip>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void revoke(minted.id)}
                  disabled={revoking === minted.id}
                  className="h-9 gap-1 px-2 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-rose-300"
                >
                  {revoking === minted.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <XCircle className="h-3 w-3" />
                  )}
                  revoke
                </Button>
              </div>
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-[11px] text-zinc-300">
                {`x-agent-key: ${minted.key}`}
              </code>
              <div className="flex">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void copyText(
                      minted.key,
                      "Key copied — send it as the x-agent-key header",
                    )
                  }
                  className="h-9 gap-1.5 border-white/15 px-3 text-xs text-zinc-300 hover:bg-white/5"
                >
                  <KeyRound className="h-3.5 w-3.5" /> Copy header key
                </Button>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
              <span className="text-emerald-400/90">Header mode (recommended)</span> keeps the key
              out of URLs, browser history, referrers and access logs. The URL link above stays
              available for chat flows — treat it as a live credential either way.
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              The full link is <span className="text-amber-400/90">shown only this once</span> —
              the vault keeps a masked hint (flk_…{minted.key.slice(-4)}). Anyone holding it can
              act within the scopes above until it expires or you revoke it.
            </p>
          </div>
        ) : null}
      </div>

      {/* sessions list */}
      {sessions.length > 0 ? (
        <div className="mb-4 rounded-xl border border-white/5 bg-black/20 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs font-semibold text-zinc-200">
              Minted links ({sessions.length})
            </span>
          </div>
          <div className="scrollbar-thin max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {sessions.map((s) => {
              const expired = new Date(s.expiresAt) <= new Date();
              const dead = s.revoked || expired;
              return (
                <div
                  key={s.id}
                  className={`flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2 ring-1 ${
                    dead
                      ? "bg-white/[0.02] ring-white/5 opacity-60"
                      : "bg-emerald-500/[0.04] ring-emerald-500/15"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dead ? "bg-zinc-600" : "bg-emerald-400"}`} />
                  <span className="min-w-0 truncate text-[11px] font-medium text-zinc-300">
                    {s.label}
                  </span>
                  <code className="shrink-0 font-mono text-[10px] text-zinc-600">{s.keyHint}</code>
                  <span className="hidden gap-1 sm:flex">
                    {s.scopes.map((sc) => (
                      <Badge
                        key={sc}
                        variant="outline"
                        className="border-white/10 px-1 py-0 text-[8px] text-zinc-500"
                      >
                        {sc}
                      </Badge>
                    ))}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-zinc-600">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-0.5">
                          <Zap className="h-2.5 w-2.5" /> {s.callCount}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">
                        {s.callCount} proxied call{s.callCount === 1 ? "" : "s"}
                        {s.lastUsedAt ? ` · last ${relativeTime(s.lastUsedAt)}` : ""}
                      </TooltipContent>
                    </Tooltip>
                    <span className={dead ? "text-zinc-600" : "text-emerald-400/80"}>
                      {s.revoked ? "revoked" : expired ? "expired" : timeUntil(s.expiresAt)}
                    </span>
                    {!s.revoked ? (
                      <button
                        type="button"
                        onClick={() => void revoke(s.id)}
                        disabled={revoking === s.id}
                        aria-label={`Revoke link ${s.label}`}
                        className="text-zinc-600 transition-colors hover:text-rose-400"
                      >
                        {revoking === s.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* activity */}
      {activity.length > 0 ? (
        <div className="mb-4 rounded-xl border border-white/5 bg-black/20 p-4">
          <div className="mb-2 flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-xs font-semibold text-zinc-200">Agent activity</span>
            <span className="ml-auto text-[10px] text-zinc-600">
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
                <span className="w-14 shrink-0 text-zinc-600">{relativeTime(a.t)}</span>
                <Badge
                  variant="outline"
                  className="shrink-0 border-white/10 px-1 py-0 text-[8px] uppercase text-zinc-500"
                >
                  {a.provider}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-zinc-400">{a.op}</span>
                <span className="shrink-0 text-zinc-600">{String(a.status)}</span>
                <span className="hidden shrink-0 text-zinc-700 sm:inline">· {a.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <p className="cursor-default text-[10px] leading-relaxed text-zinc-600">
            Security model: tokens live only in server-side files with restrictive
            permissions (chmod 600). Chat carries links, not tokens. Links are
            scoped, expiring, revocable, and every call they make is audited above.
            Mutations are allow-listed (repos content/issues, projects/domains,
            deployments) and token endpoints are blocked.
          </p>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-72 border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">
          Tip: mint read-only links for routine asks, add write scopes only when
          you want the AI to actually push files or move domains.{" "}
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
  );
}
