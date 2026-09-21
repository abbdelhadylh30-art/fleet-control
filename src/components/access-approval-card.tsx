"use client";

// ─── Access approval card — the AI asks, you decide ─────────────────────────
// Replaces the "paste a long-lived link into chat" flow:
//   1 · generate a temp password (fac_…) scoped + expiring
//   2 · give it to your AI — it can only ASK for access
//   3 · a live request lands here → you Approve or Deny
//   4 · approved AIs work under a 1-hour session, tracked live:
//       which AI · since when · what it's doing (live activity feed)

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Fingerprint,
  KeyRound,
  Loader2,
  RadioTower,
  ShieldCheck,
  Timer,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { copyText } from "@/lib/copy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── types (mirror /api/agent/access GET) ────────────────────────────────────

interface AccessCodeRow {
  id: string;
  codeHint: string;
  label: string;
  scopes: string[];
  parentHint: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  useCount: number;
  lastUsedAt: string | null;
}

interface AccessRequestRow {
  id: string;
  codeHint: string;
  clientName: string;
  userAgent: string;
  ip: string;
  task: string;
  scopes: string[];
  parentHint: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  sessionExpiresAt: string | null;
  consumedAt: string | null;
}

interface ActivityRow {
  t: string;
  label: string;
  provider: string;
  op: string;
  ok: boolean;
  status: number | string;
}

const SCOPE_META: Record<string, { label: string; hint: string }> = {
  "github:read": { label: "GitHub read", hint: "browse repos, files, issues" },
  "github:write": { label: "GitHub write", hint: "push files, open issues" },
  "vercel:read": { label: "Vercel read", hint: "list projects & deployments" },
  "vercel:write": { label: "Vercel write", hint: "redeploy, manage domains" },
};

const TTL_CHOICES = [
  { minutes: 15, label: "15 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 360, label: "6 hours" },
  { minutes: 1440, label: "24 hours" },
];

// ─── time helpers ────────────────────────────────────────────────────────────

function since(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function until(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return "expired";
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s left`;
  return `${Math.floor(m / 60)}h ${m % 60}m left`;
}

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── component ───────────────────────────────────────────────────────────────

export function AccessApprovalCard() {
  const [codes, setCodes] = useState<AccessCodeRow[]>([]);
  const [requests, setRequests] = useState<AccessRequestRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  // mint form
  const [label, setLabel] = useState("");
  const [ttl, setTtl] = useState("15");
  const [scopes, setScopes] = useState<string[]>(["github:read", "vercel:read"]);
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<{ code: string; expiresAt: string } | null>(null);

  // decisions
  const [deciding, setDeciding] = useState<string | null>(null);
  const [revealedUa, setRevealedUa] = useState<string | null>(null);

  // 1s ticker so live durations keep moving without refetching
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const [accRes, agentRes] = await Promise.all([
        fetch("/api/agent/access", { cache: "no-store" }),
        fetch("/api/agent", { cache: "no-store" }),
      ]);
      if (accRes.ok) {
        const json = (await accRes.json()) as { codes: AccessCodeRow[]; requests: AccessRequestRow[] };
        setCodes(json.codes ?? []);
        setRequests(json.requests ?? []);
      }
      if (agentRes.ok) {
        const json = (await agentRes.json()) as { activity?: ActivityRow[] };
        setActivity(json.activity ?? []);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoaded(true);
    }
  }, []);

  const hasPending = requests.some((r) => r.status === "pending");
  const pollRef = useRef(load);
  pollRef.current = load;
  const knownPendingRef = useRef<Set<string>>(new Set());

  // approval queue is time-sensitive: poll 8s idle, 4s while something waits
  useEffect(() => {
    const id = setInterval(() => void pollRef.current(), hasPending ? 4000 : 8000);
    return () => clearInterval(id);
  }, [hasPending]);

  // toast the moment a NEW pending request shows up (initial load registers
  // silently so pre-existing pendings don't spam toasts)
  const mountedRef = useRef(false);
  useEffect(() => {
    const fresh = requests.filter(
      (r) => r.status === "pending" && !knownPendingRef.current.has(r.id),
    );
    requests.forEach((r) => knownPendingRef.current.add(r.id));
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    for (const r of fresh) {
      toast.message(`${r.clientName} is asking for access`, {
        description: r.task ? `wants to: ${r.task}` : "no task given — review and decide below",
        duration: 10000,
      });
    }
  }, [requests]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    if (scopes.length === 0) {
      toast.error("Pick at least one scope");
      return;
    }
    setMinting(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create-access-code",
          label: label.trim() || "ai access",
          scopes,
          ttlMinutes: Number(ttl),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        code?: string;
        expiresAt?: string;
      };
      if (!json.ok || !json.code) {
        toast.error(String(json.error ?? "could not generate the temp password"), {
          duration: 8000,
        });
        return;
      }
      setMinted({ code: json.code, expiresAt: json.expiresAt ?? "" });
      setLabel("");
      toast.success("Temp password generated — copy it below (shown once)");
      await load();
    } finally {
      setMinting(false);
    }
  };

  const revokeCode = async (id: string) => {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "revoke-access-code", id }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (json.ok) {
      toast.success("Access code revoked");
      await load();
    } else {
      toast.error(String(json.error ?? "revoke failed"));
    }
  };

  const decide = async (id: string, approve: boolean) => {
    setDeciding(id);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: approve ? "approve-request" : "deny-request", id }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) {
        toast.success(approve ? "Approved — the AI can pick up its 1-hour session" : "Denied");
        await load();
      } else {
        toast.error(String(json.error ?? "decision failed"), { duration: 8000 });
        await load();
      }
    } finally {
      setDeciding(null);
    }
  };

  const aiInstructions = minted
    ? [
        "Use this approval-based access to my Fleet Control dashboard:",
        "1. POST https://fleet.abdelhadygabriel.me/api/agent/access",
        `   body: {"action":"request","code":"${minted.code}","client":{"name":"<your name>","task":"<what you want to do>"}}`,
        "2. Wait for my approval in the dashboard, then poll the same endpoint:",
        `   body: {"action":"poll","requestId":"<id from step 1>","code":"${minted.code}"}`,
        '   → you receive {"session":"fls_…"} — a 1-hour session token.',
        "3. Call operations with header x-agent-key: <session> against",
        "   https://fleet.abdelhadygabriel.me/api/agent/proxy",
      ].join("\n")
    : null;

  const activeCodes = codes.filter((c) => !c.revoked && new Date(c.expiresAt).getTime() > Date.now());
  const pending = requests.filter((r) => r.status === "pending");
  const activeSessions = requests
    .filter((r) => r.status === "approved" && r.sessionExpiresAt && new Date(r.sessionExpiresAt).getTime() > Date.now())
    .sort((a, b) => new Date(b.decidedAt ?? b.createdAt).getTime() - new Date(a.decidedAt ?? a.createdAt).getTime());
  const history = requests.filter(
    (r) => r.status === "denied" || r.status === "expired" || (r.status === "approved" && (!r.sessionExpiresAt || new Date(r.sessionExpiresAt).getTime() <= Date.now())),
  );

  const toggleScope = (s: string) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <div
      className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] via-zinc-900/40 to-zinc-900/60 p-5 backdrop-blur"
      data-testid="access-approval-card"
    >
      {/* header */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
          <RadioTower className="h-4 w-4 text-emerald-300" />
        </span>
        <h3 className="text-sm font-semibold text-zinc-100">
          Approval-based access — the AI asks, you decide
        </h3>
        {hasPending ? (
          <Badge className="ml-auto gap-1 animate-pulse border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-300">
            <Timer className="h-3 w-3" /> {pending.length} waiting for you
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="ml-auto gap-1 border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-500"
          >
            <ShieldCheck className="h-3 w-3" /> nothing pending
          </Badge>
        )}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">
        Generate a <span className="font-mono text-emerald-400">temp password</span>, hand it to
        your AI. It can only <span className="text-zinc-300">ask</span> — each request lands here
        with who&apos;s asking, and you approve or deny. Approved AIs work under a{" "}
        <span className="text-emerald-400">1-hour session</span> tracked live below.
      </p>

      {/* mint row */}
      <div className="mb-4 rounded-xl border border-white/5 bg-black/20 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_auto_auto]">
          <div className="space-y-1.5">
            <label htmlFor="access-label" className="text-[11px] font-medium text-zinc-400">
              Which AI is this for?
            </label>
            <Input
              id="access-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Claude on web · Z.ai agent"
              className="h-9 border-white/10 bg-white/[0.03] text-xs text-zinc-200 placeholder:text-zinc-600"
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-400">Password lives</label>
            <Select value={ttl} onValueChange={setTtl}>
              <SelectTrigger className="h-9 w-full border-white/10 bg-white/[0.03] text-xs md:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-zinc-900">
                {TTL_CHOICES.map((t) => (
                  <SelectItem key={t.minutes} value={String(t.minutes)} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={generate}
              disabled={minting}
              className="h-9 w-full gap-1.5 bg-emerald-500 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 md:w-auto"
            >
              {minting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              Generate
            </Button>
          </div>
        </div>
        {/* scope chips */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(SCOPE_META).map(([scope, meta]) => {
            const on = scopes.includes(scope);
            return (
              <Tooltip key={scope}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => toggleScope(scope)}
                    aria-pressed={on}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium ring-1 transition-all ${
                      on
                        ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                        : "bg-white/[0.02] text-zinc-500 ring-white/10 hover:text-zinc-300"
                    }`}
                  >
                    {on && <Check className="mr-1 inline h-2.5 w-2.5" />}
                    {meta.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">
                  {meta.hint}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* minted result — shown once */}
        {minted && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3.5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <BadgeCheck className="h-3.5 w-3.5 text-emerald-300" />
              <span className="text-[11px] font-semibold text-emerald-200">
                Temp password — copy now, shown only once
              </span>
              <Badge variant="outline" className="ml-auto gap-1 border-white/10 px-1.5 py-0 text-[9px] text-zinc-400">
                <Clock className="h-2.5 w-2.5" /> {until(minted.expiresAt)}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-emerald-300">
                {minted.code}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 border-emerald-500/30 px-2.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10"
                onClick={() => void copyText(minted.code, "Temp password copied")}
              >
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </div>
            {aiInstructions && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Paste this into the AI chat
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-2 text-[10px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    onClick={() => void copyText(aiInstructions, "AI instructions copied")}
                  >
                    <Copy className="h-2.5 w-2.5" /> Copy instructions
                  </Button>
                </div>
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-zinc-400">
                  {aiInstructions}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* live request queue */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <Fingerprint className="h-3.5 w-3.5 text-emerald-400" />
          Access requests
          {loaded && <span className="ml-auto font-normal normal-case text-zinc-600">auto-refresh {hasPending ? "4s" : "8s"}</span>}
        </div>
        {!loaded ? (
          <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/20 p-4 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading requests…
          </div>
        ) : pending.length === 0 && activeSessions.length === 0 && history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-4 text-center text-[11px] text-zinc-600">
            No requests yet — generate a temp password above and give it to your AI.
          </div>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {pending.map((r) => (
              <div key={r.id} className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                  </span>
                  <span className="text-xs font-semibold text-amber-200">{r.clientName}</span>
                  <Badge variant="outline" className="gap-1 border-white/10 px-1.5 py-0 text-[9px] text-zinc-400">
                    <Clock className="h-2.5 w-2.5" /> decide within {until(r.expiresAt)}
                  </Badge>
                  <span className="ml-auto text-[10px] text-zinc-600">{relTime(r.createdAt)}</span>
                </div>
                {r.task && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-300">
                    wants to: <span className="text-zinc-100">{r.task}</span>
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {r.scopes.map((s) => (
                    <Badge key={s} variant="outline" className="px-1.5 py-0 text-[9px] text-zinc-400">
                      {SCOPE_META[s]?.label ?? s}
                    </Badge>
                  ))}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setRevealedUa(revealedUa === r.id ? null : r.id)}
                        className="text-[10px] text-zinc-600 underline decoration-dotted hover:text-zinc-400"
                      >
                        {r.ip ? `from ${r.ip}` : "unknown ip"} · agent details
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-72 border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">
                      user-agent: {r.userAgent || "unknown"}
                    </TooltipContent>
                  </Tooltip>
                </div>
                {revealedUa === r.id && (
                  <p className="mt-1.5 break-all rounded-lg bg-black/30 p-2 font-mono text-[9px] leading-relaxed text-zinc-500">
                    {r.userAgent || "unknown user-agent"} · via {r.codeHint} · parent {r.parentHint}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void decide(r.id, true)}
                    disabled={deciding === r.id}
                    className="h-8 flex-1 gap-1.5 bg-emerald-500 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-400 sm:flex-none sm:px-4"
                  >
                    {deciding === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void decide(r.id, false)}
                    disabled={deciding === r.id}
                    className="h-8 flex-1 gap-1.5 border-rose-500/30 px-3 text-[11px] text-rose-300 hover:bg-rose-500/10 sm:flex-none"
                  >
                    <X className="h-3.5 w-3.5" /> Deny
                  </Button>
                </div>
              </div>
            ))}

            {activeSessions.map((r) => (
              <div key={r.id} className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <span className="text-xs font-semibold text-emerald-200">{r.clientName}</span>
                  <Badge variant="outline" className="gap-1 border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[9px] text-emerald-300">
                    <Activity className="h-2.5 w-2.5" /> working · {since(r.decidedAt ?? r.createdAt)} active
                  </Badge>
                  <Badge variant="outline" className="gap-1 border-white/10 px-1.5 py-0 text-[9px] text-zinc-400">
                    <Clock className="h-2.5 w-2.5" /> {until(r.sessionExpiresAt)}
                  </Badge>
                  <span className="ml-auto text-[10px] text-zinc-600">via {r.codeHint}</span>
                </div>
                {r.task && <p className="mt-1.5 text-[11px] text-zinc-400">task: {r.task}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.scopes.map((s) => (
                    <Badge key={s} variant="outline" className="px-1.5 py-0 text-[9px] text-zinc-500">
                      {SCOPE_META[s]?.label ?? s}
                    </Badge>
                  ))}
                  {r.consumedAt ? (
                    <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[9px] text-emerald-400/80">
                      <BadgeCheck className="h-2.5 w-2.5" /> session collected {relTime(r.consumedAt)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[9px] text-amber-400/80">
                      <Clock className="h-2.5 w-2.5" /> AI hasn&apos;t collected the session yet
                    </Badge>
                  )}
                </div>
              </div>
            ))}

            {history.slice(0, 4).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-black/10 p-3 opacity-60">
                <Badge
                  variant="outline"
                  className={`px-1.5 py-0 text-[9px] ${
                    r.status === "denied"
                      ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
                      : "border-white/10 bg-white/[0.03] text-zinc-500"
                  }`}
                >
                  {r.status === "denied" ? <Ban className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
                  {r.status}
                </Badge>
                <span className="text-[11px] text-zinc-400">{r.clientName}</span>
                {r.task && <span className="truncate text-[10px] text-zinc-600">· {r.task}</span>}
                <span className="ml-auto text-[10px] text-zinc-600">{relTime(r.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* live activity — what is the AI doing right now */}
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <Activity className="h-3.5 w-3.5 text-emerald-400" />
          Live activity — what agents are doing
        </div>
        {activity.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-3 text-center text-[10px] text-zinc-600">
            No agent calls yet.
          </div>
        ) : (
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {activity.slice(0, 8).map((a, i) => (
              <div
                key={`${a.t}-${i}`}
                className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1.5 transition-colors hover:bg-white/[0.04]"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    a.ok ? "bg-emerald-400" : "bg-rose-400"
                  }`}
                />
                <span className="truncate text-[10px] font-medium text-zinc-300">{a.label}</span>
                <span className="truncate font-mono text-[10px] text-zinc-500">{a.op}</span>
                <span className="ml-auto shrink-0 text-[9px] text-zinc-600">{relTime(a.t)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* active codes */}
      {activeCodes.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Active temp passwords
          </div>
          <div className="space-y-1.5">
            {activeCodes.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1.5">
                <code className="font-mono text-[10px] text-emerald-400/90">{c.codeHint}</code>
                <span className="text-[10px] text-zinc-400">{c.label}</span>
                <Badge variant="outline" className="px-1.5 py-0 text-[9px] text-zinc-500">
                  {c.useCount} use{c.useCount === 1 ? "" : "s"}
                </Badge>
                <span className="ml-auto text-[9px] text-zinc-600">{until(c.expiresAt)}</span>
                <button
                  type="button"
                  onClick={() => void revokeCode(c.id)}
                  className="text-[10px] text-rose-400/70 underline decoration-dotted hover:text-rose-300"
                >
                  revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
