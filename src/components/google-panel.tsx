"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Bot,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileClock,
  Info,
  KeyRound,
  Link2,
  ListChecks,
  Loader2,
  MousePointerClick,
  RefreshCcw,
  Rocket,
  Send,
  ShieldCheck,
  Unplug,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type GscCallResult,
  type GscOutcome,
  type GscSitemapInfo,
} from "@/lib/gsc-types";
import type { FleetSiteStatus, VerifyStatus } from "@/lib/fleet";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Google "G" mark (inline SVG — lucide has no brand icon for Google). */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M21.35 11.1h-9.17v2.96h5.3c-.25 1.36-1.66 4-5.3 4-3.19 0-5.8-2.64-5.8-5.9s2.61-5.9 5.8-5.9c1.82 0 3.03.77 3.73 1.44l2.54-2.45C16.75 3.6 14.6 2.7 12.18 2.7 7.07 2.7 2.92 6.85 2.92 11.96s4.15 9.26 9.26 9.26c5.35 0 8.9-3.76 8.9-9.05 0-.61-.07-1.07-.16-1.53z"
      />
    </svg>
  );
}

const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
const PLAYGROUND_REDIRECT = "https://developers.google.com/oauthplayground";

function buildConsentUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: PLAYGROUND_REDIRECT,
    response_type: "code",
    scope: WEBMASTERS_SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
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

async function copyText(text: string, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    const { toast } = await import("sonner");
    toast.success(label);
  } catch {
    /* clipboard unavailable */
  }
}

// ─── component ───────────────────────────────────────────────────────────────

interface GscLogEntry {
  ts: string;
  action: "submit" | "status";
  host: string;
  http: number | null;
  ok: boolean;
  reason?: string;
}

interface GscAuthState {
  connected: boolean;
  needsReauth: boolean;
  savedAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}

const AUTH_IDLE: GscAuthState = {
  connected: false,
  needsReauth: false,
  savedAt: null,
  lastRefreshAt: null,
  lastError: null,
};

export function GoogleIndexingPanel({
  sites,
  gsc,
}: {
  sites: FleetSiteStatus[];
  gsc: VerifyStatus;
}) {
  const withSitemap = sites.filter((s) => s.health.sitemapOk);
  const sitemapUrls = withSitemap.map((s) => `https://${s.host}/sitemap.xml`);
  const allSitemaps = sitemapUrls.join("\n");

  // legacy 1-hour token
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  // connect-once credentials (kept in memory only — sent straight to backend)
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [mode, setMode] = useState<"connect" | "token">("connect");

  const [auth, setAuth] = useState<GscAuthState>(AUTH_IDLE);
  const [howtoOpen, setHowtoOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<GscSitemapInfo[] | null>(null);
  const [submitResults, setSubmitResults] = useState<GscOutcome[] | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [gscLog, setGscLog] = useState<GscLogEntry[]>([]);

  const loadGscLog = useCallback(async () => {
    try {
      const res = await fetch("/api/gsc");
      if (res.ok) {
        const json = (await res.json()) as {
          entries: GscLogEntry[];
          auth?: GscAuthState;
        };
        setGscLog(json.entries ?? []);
        if (json.auth) setAuth(json.auth);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadGscLog();
    // restore legacy token from this browser only (never leaves the device except to Google)
    try {
      const saved = localStorage.getItem("gsc-access-token");
      if (saved) setToken(saved);
    } catch {
      /* private mode */
    }
  }, [loadGscLog]);

  const saveToken = (t: string) => {
    setToken(t);
    try {
      if (t) localStorage.setItem("gsc-access-token", t);
      else localStorage.removeItem("gsc-access-token");
    } catch {
      /* private mode */
    }
  };

  const callApi = async (
    action: "status" | "submit",
  ): Promise<GscCallResult | null> => {
    setApiError(null);
    const res = await fetch("/api/gsc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: token.trim() || undefined,
        action,
        sitemaps: sitemapUrls,
      }),
    });
    const json = (await res.json()) as GscCallResult & {
      error?: string;
      needsReauth?: boolean;
    };
    if (json.error) {
      setApiError(json.error);
      if (json.needsReauth) {
        setAuth((a) => ({ ...a, needsReauth: true }));
        void loadGscLog();
      }
      return null;
    }
    return json;
  };

  const checkStatus = async () => {
    setChecking(true);
    setSubmitResults(null);
    try {
      const r = await callApi("status");
      if (r?.ok) {
        setStatusData(r.sitemaps ?? []);
        const { toast } = await import("sonner");
        toast.success(
          `Google has ${(r.sitemaps ?? []).length} sitemap(s) registered for the domain property`,
        );
        void loadGscLog();
      }
    } finally {
      setChecking(false);
    }
  };

  const submitAll = async () => {
    setSubmitting(true);
    try {
      const r = await callApi("submit");
      if (r) {
        setSubmitResults(r.results ?? []);
        const okCount = (r.results ?? []).filter((x) => x.ok).length;
        const { toast } = await import("sonner");
        if (okCount === (r.results ?? []).length && okCount > 0) {
          toast.success(
            `Google accepted ${okCount}/${r.results?.length} sitemaps — indexing is now in Google's hands`,
            { duration: 6000 },
          );
        } else if (okCount > 0) {
          toast.warning(`Google accepted ${okCount}/${r.results?.length} sitemaps — see details below`);
        }
        if (r.error) setApiError(r.error);
        void loadGscLog();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const saveConnection = async () => {
    setSaving(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/gsc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save-auth",
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          refreshToken: refreshToken.trim(),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        probe?: { ok: boolean; sitemaps?: GscSitemapInfo[] };
      };
      if (!res.ok || !json.ok) {
        setConnectError(json.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      const { toast } = await import("sonner");
      toast.success(
        "Google connected — sitemaps now submit with one click, forever. No more token pasting.",
        { duration: 7000 },
      );
      // credentials verified — drop them from the form immediately
      setClientId("");
      setClientSecret("");
      setRefreshToken("");
      await loadGscLog();
      if (json.probe?.ok) setStatusData(json.probe.sitemaps ?? []);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    try {
      await fetch("/api/gsc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      const { toast } = await import("sonner");
      toast.success("Google connection removed from the server");
      await loadGscLog();
    } catch {
      /* non-fatal */
    }
  };

  // which sitemaps does google already know about?
  const knownPaths = new Set((statusData ?? []).map((s) => s.path));
  const missing = sitemapUrls.filter((u) => !knownPaths.has(u));

  const connected = auth.connected && !auth.needsReauth;
  const tokenReady = token.trim().length >= 20;
  const canUseApi = connected || tokenReady;
  const consentUrl = useMemo(
    () => (clientId.trim().includes(".apps.googleusercontent.com") ? buildConsentUrl(clientId) : null),
    [clientId],
  );
  const formComplete =
    clientId.trim().length > 0 &&
    clientSecret.trim().length > 0 &&
    refreshToken.trim().length > 0;

  return (
    <div className="fade-up-item grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      {/* ── LEFT: the answer ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-zinc-900/60 p-5 backdrop-blur">
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/25">
            <GoogleMark className="h-4 w-4 text-emerald-400" />
          </span>
          <h3 className="text-sm font-semibold text-zinc-100">
            Do I have to index them one by one?
          </h3>
          <Badge
            variant="outline"
            className="ml-auto gap-1 border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400 ring-1 ring-emerald-500/20"
          >
            <BadgeCheck className="h-3 w-3" /> No
          </Badge>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-zinc-500">
          Google doesn&apos;t support IndexNow (that pipeline feeds Bing/Yandex
          only) — but you still don&apos;t do it per-URL. Here is the whole
          picture:
        </p>

        <ul className="space-y-3">
          <li className="flex gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div className="text-xs leading-relaxed">
              <span className="font-semibold text-zinc-200">
                Verification — already done once.
              </span>{" "}
              <span className="text-zinc-500">
                One DNS TXT record verified the whole{" "}
                <span className="font-mono text-zinc-400">
                  sc-domain:abdelhadygabriel.me
                </span>{" "}
                property — that single property covers the apex + all 13
                subdomains forever.{" "}
                {gsc.verified ? (
                  <span className="text-emerald-400">✓ confirmed live</span>
                ) : (
                  <span className="text-amber-400">still pending</span>
                )}
              </span>
            </div>
          </li>
          <li className="flex gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div className="text-xs leading-relaxed">
              <span className="font-semibold text-zinc-200">
                Bing &amp; Yandex — zero clicks, ever.
              </span>{" "}
              <span className="text-zinc-500">
                The dashboard&apos;s{" "}
                <span className="font-mono text-emerald-400">Submit all</span>{" "}
                button pushes every URL through IndexNow automatically.
              </span>
            </div>
          </li>
          <li className="flex gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
            <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div className="text-xs leading-relaxed">
              <span className="font-semibold text-zinc-200">
                Google sitemaps — three ways, pick one.
              </span>{" "}
              <span className="text-zinc-500">
                (a) <span className="text-emerald-400">Connect once</span> (below)
                → submit all {sitemapUrls.length} sitemaps with one click, then
                never think about it again (best), (b) paste the sitemap list
                into GSC manually —{" "}
                <button
                  onClick={() => void copyText(allSitemaps, `Copied ${sitemapUrls.length} sitemap URLs`)}
                  className="inline-flex items-center gap-0.5 text-emerald-400 hover:underline"
                >
                  copy all <Copy className="h-3 w-3" />
                </button>{" "}
                (~2 min), or (c) do nothing — Google discovers sitemaps from
                robots.txt and links within days to weeks.
              </span>
            </div>
          </li>
          <li className="flex gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div className="text-xs leading-relaxed">
              <span className="font-semibold text-zinc-200">
                After that — nothing.
              </span>{" "}
              <span className="text-zinc-500">
                Google re-crawls sitemaps on its own schedule. &quot;Request
                indexing&quot; is only for single urgent pages, never needed for
                a fleet.
              </span>
            </div>
          </li>
        </ul>

        {/* how to connect once — collapsible */}
        <button
          onClick={() => setHowtoOpen((o) => !o)}
          aria-expanded={howtoOpen}
          className="mt-4 flex w-full items-center gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5 text-left text-xs font-medium text-zinc-300 transition-colors hover:bg-black/40"
        >
          <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
          How does “connect once” work? (~4 minutes, free, one time)
          <ChevronDown
            className={`ml-auto h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${howtoOpen ? "rotate-180" : ""}`}
          />
        </button>
        {howtoOpen ? (
          <ol className="mt-2 space-y-2 rounded-xl border border-white/5 bg-black/20 p-3 text-xs leading-relaxed text-zinc-400">
            {[
              <>
                In{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-emerald-400 hover:underline"
                >
                  Google Cloud Console → APIs &amp; Services <ExternalLink className="h-3 w-3" />
                </a>{" "}
                — create a project (any name), enable the{" "}
                <span className="text-zinc-200">Google Search Console API</span>,
                then create an <span className="text-zinc-200">OAuth client ID</span>{" "}
                → type <span className="text-zinc-200">Web application</span>.
              </>,
              <>
                Add this exact authorized redirect URI:{" "}
                <button
                  onClick={() => void copyText(PLAYGROUND_REDIRECT, "Redirect URI copied")}
                  className="inline-flex items-center gap-0.5 font-mono text-[10px] text-emerald-400 hover:underline"
                >
                  {PLAYGROUND_REDIRECT} <Copy className="h-3 w-3" />
                </button>{" "}
                → save, then copy the <span className="text-zinc-200">Client ID</span>{" "}
                and <span className="text-zinc-200">Client secret</span> into the
                form on the right.
              </>,
              <>
                Also publish the OAuth consent screen under{" "}
                <span className="text-zinc-200">OAuth consent screen</span> →
                Publishing status →{" "}
                <span className="text-zinc-200">In production</span> (otherwise
                refresh tokens expire after 7 days).
              </>,
              <>
                Click the <span className="text-zinc-200">consent link</span> the
                form generates → choose your Google account → Allow. Google
                bounces you to OAuth Playground with a code in the URL.
              </>,
              <>
                In Playground: gear icon ⚙ → check{" "}
                <span className="text-zinc-200">Use your own OAuth credentials</span>{" "}
                (paste the same client ID/secret) → step 2 →{" "}
                <span className="text-zinc-200">
                  Exchange authorization code for tokens
                </span>{" "}
                → copy the <span className="font-mono text-[10px]">refresh_token</span>{" "}
                (starts with <span className="font-mono text-[10px]">1//</span>)
                into the form.
              </>,
              <>
                Hit <span className="text-zinc-200">Save connection</span> — the
                dashboard verifies it against Google instantly, stores it
                server-side, and auto-refreshes from then on. This is the last
                time you ever paste anything.
              </>,
            ].map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[9px] font-bold text-emerald-400">
                  {i + 1}
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      {/* ── RIGHT: connect once / submitter ────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-zinc-900/60 p-5 backdrop-blur">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <MousePointerClick className="h-3.5 w-3.5 text-emerald-400" />
            Google submitter
          </h3>
          {connected ? (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400 ring-1 ring-emerald-500/20"
            >
              <CheckCircle2 className="h-3 w-3" /> connected · auto-refresh
            </Badge>
          ) : gsc.verified ? (
            <Badge
              variant="outline"
              className="gap-1 border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400 ring-1 ring-white/10"
            >
              <CheckCircle2 className="h-3 w-3 text-emerald-500" /> property verified
            </Badge>
          ) : null}
        </div>

        {/* connected summary */}
        {connected ? (
          <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <Link2 className="h-3.5 w-3.5" />
              Google connection active
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-emerald-400/70">
              Access tokens refresh themselves server-side
              {auth.lastRefreshAt
                ? ` · last refresh ${relativeTime(auth.lastRefreshAt)}`
                : ""}
              . Submit sitemaps any time — no token needed.
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void disconnect()}
              className="mt-2 h-7 gap-1 px-2 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-rose-300"
            >
              <Unplug className="h-3 w-3" /> disconnect
            </Button>
          </div>
        ) : null}

        {/* re-auth warning */}
        {auth.needsReauth ? (
          <div className="mb-4 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs leading-relaxed text-amber-300">
            <RefreshCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              The stored Google connection expired (Google revoked the refresh
              token — happens after consent-screen changes or 7-day test mode).
              Re-run the connect steps once to restore it.
              {auth.lastError ? (
                <span className="mt-1 block font-mono text-[10px] text-amber-400/70">
                  {auth.lastError}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}

        {/* mode switch — only when not connected */}
        {!connected ? (
          <div className="mb-3 flex rounded-lg bg-black/20 p-1 ring-1 ring-white/5">
            {(
              [
                { id: "connect", label: "Connect once (recommended)" },
                { id: "token", label: "1-hour token" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  mode === m.id
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        ) : null}

        {/* ── connect-once form ─────────────────────────────────────────── */}
        {!connected && mode === "connect" ? (
          <div className="mb-4 space-y-3">
            <div>
              <label htmlFor="gsc-client-id" className="mb-1.5 block text-[11px] font-medium text-zinc-500">
                1 · OAuth Client ID
              </label>
              <Input
                id="gsc-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="1234567890-xyz.apps.googleusercontent.com"
                autoComplete="off"
                className="border-white/10 bg-white/[0.03] font-mono text-xs text-zinc-200 placeholder:text-zinc-700 focus-visible:ring-emerald-500/40"
              />
            </div>

            {/* consent link — the tool-generated link the user asked for */}
            {consentUrl ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
                <p className="mb-2 text-[11px] leading-relaxed text-emerald-300/90">
                  Consent link ready — open it, choose the account that owns
                  Search Console, click <span className="font-semibold">Allow</span>:
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    asChild
                    size="sm"
                    className="h-8 gap-1.5 bg-emerald-500 px-3 text-xs font-semibold text-emerald-950 hover:bg-emerald-400"
                  >
                    <a href={consentUrl} target="_blank" rel="noreferrer">
                      Open Google consent <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void copyText(consentUrl, "Consent link copied")}
                    className="h-8 gap-1 px-2 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                  >
                    <Copy className="h-3 w-3" /> copy link
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-[10px] leading-relaxed text-zinc-600">
                The consent link appears here automatically once a valid client
                ID is entered.
              </p>
            )}

            <div>
              <label htmlFor="gsc-client-secret" className="mb-1.5 block text-[11px] font-medium text-zinc-500">
                2 · OAuth Client secret
              </label>
              <div className="relative">
                <Input
                  id="gsc-client-secret"
                  type={showSecret ? "text" : "password"}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="GOCSPX-…"
                  autoComplete="off"
                  className="border-white/10 bg-white/[0.03] pr-9 font-mono text-xs text-zinc-200 placeholder:text-zinc-700 focus-visible:ring-emerald-500/40"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? "Hide client secret" : "Show client secret"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors hover:text-zinc-300"
                >
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="gsc-refresh-token" className="mb-1.5 block text-[11px] font-medium text-zinc-500">
                3 · Refresh token (from Playground exchange — starts with 1//)
              </label>
              <Input
                id="gsc-refresh-token"
                type="password"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                placeholder="1//0g…"
                autoComplete="off"
                className="border-white/10 bg-white/[0.03] font-mono text-xs text-zinc-200 placeholder:text-zinc-700 focus-visible:ring-emerald-500/40"
              />
            </div>

            <Button
              size="sm"
              disabled={!formComplete || saving}
              onClick={() => void saveConnection()}
              className="h-9 w-full gap-1.5 bg-emerald-500 text-xs font-semibold text-emerald-950 shadow-[0_0_20px_-6px_rgba(16,185,129,0.6)] hover:bg-emerald-400"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Save connection — verified against Google instantly
            </Button>
            {connectError ? (
              <div className="flex gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-300">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{connectError}</span>
              </div>
            ) : (
              <p className="text-center text-[10px] leading-relaxed text-zinc-600">
                Values are sent straight to the server and never stored in this
                browser. Full walkthrough in “How does connect once work?” on the left.
              </p>
            )}
          </div>
        ) : null}

        {/* ── legacy 1-hour token form ──────────────────────────────────── */}
        {!connected && mode === "token" ? (
          <div className="mb-4">
            <label htmlFor="gsc-token" className="mb-1.5 block text-[11px] font-medium text-zinc-500">
              Google access token <span className="text-zinc-700">(expires in ~1 hour)</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="gsc-token"
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => saveToken(e.target.value)}
                  placeholder="ya29.…"
                  autoComplete="off"
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
              {token ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => saveToken("")}
                  className="h-9 shrink-0 px-2 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                >
                  clear
                </Button>
              ) : null}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">
              Prefer not to expire? Switch to{" "}
              <button
                onClick={() => setMode("connect")}
                className="text-emerald-400 hover:underline"
              >
                Connect once
              </button>{" "}
              — one consent, permanent auto-refreshing access.
            </p>
          </div>
        ) : null}

        {/* actions */}
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!canUseApi || checking || submitting}
            onClick={() => void checkStatus()}
            className="h-9 flex-1 gap-1.5 border border-white/10 bg-white/[0.04] text-xs text-zinc-200 hover:bg-white/[0.08]"
            variant="outline"
          >
            {checking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ListChecks className="h-3.5 w-3.5" />
            )}
            What&apos;s already in Google?
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                disabled={!canUseApi || checking || submitting}
                onClick={() => void submitAll()}
                className="h-9 flex-1 gap-1.5 bg-emerald-500 text-xs font-semibold text-emerald-950 shadow-[0_0_20px_-6px_rgba(16,185,129,0.6)] hover:bg-emerald-400"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Submit all {sitemapUrls.length} to Google
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="border border-white/10 bg-zinc-900 text-zinc-200">
              Bulk-PUTs every fleet sitemap into the verified
              sc-domain property via the Search Console API
            </TooltipContent>
          </Tooltip>
        </div>

        {apiError ? (
          <div className="mb-4 flex gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-300">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{apiError}</span>
          </div>
        ) : null}

        {/* status results */}
        {statusData ? (
          <div className="mb-4 rounded-xl border border-white/5 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Registered in Google ({statusData.length})
              </h4>
              <span className="text-[10px] text-zinc-600">
                sc-domain:abdelhadygabriel.me
              </span>
            </div>
            <ScrollArea className="scrollbar-thin max-h-40">
              <div className="space-y-1 pr-2">
                {statusData.map((sm) => (
                  <div
                    key={sm.path}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/[0.03]"
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">
                      {sm.path.replace("https://", "")}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className={`shrink-0 px-1.5 text-[9px] ${
                            sm.isPending
                              ? "border-amber-500/25 bg-amber-500/10 text-amber-400"
                              : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                          }`}
                        >
                          {sm.isPending ? "pending" : "processed"}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="border border-white/10 bg-zinc-900 text-[10px] text-zinc-300">
                        {sm.lastDownloaded
                          ? `Google last fetched it ${relativeTime(sm.lastDownloaded)}`
                          : "Google hasn't fetched it yet"}
                        {sm.errors > 0 ? ` · ${sm.errors} errors` : ""}
                        {sm.warnings > 0 ? ` · ${sm.warnings} warnings` : ""}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ))}
                {missing.length > 0 ? (
                  <div className="mt-2 border-t border-white/5 pt-2">
                    <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-amber-500/80">
                      Not yet in Google ({missing.length})
                    </p>
                    {missing.map((u) => (
                      <div
                        key={u}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
                      >
                        <span className="h-3 w-3 shrink-0 rounded-full border border-dashed border-amber-500/40" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500">
                          {u.replace("https://", "")}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-1 text-[11px] text-emerald-400">
                    All fleet sitemaps are registered — nothing left to do. ✓
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        ) : null}

        {/* submit results */}
        {submitResults ? (
          <div className="mb-4 rounded-xl border border-white/5 bg-black/20 p-3">
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Submission results
            </h4>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {submitResults.map((r) => (
                <div
                  key={r.sitemap}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] ${
                    r.ok ? "bg-emerald-500/[0.07]" : "bg-rose-500/[0.07]"
                  }`}
                >
                  {r.ok ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="h-3 w-3 shrink-0 text-rose-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-zinc-400">
                    {r.host}
                  </span>
                  <span
                    className={`shrink-0 font-mono text-[10px] tabular-nums ${r.ok ? "text-emerald-500" : "text-rose-400"}`}
                  >
                    {r.http ?? "ERR"}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 px-1 text-[10px] leading-relaxed text-zinc-600">
              Google will crawl these sitemaps on its own schedule (usually
              within days). You never need to touch this again unless you add
              new sites.
            </p>
          </div>
        ) : null}

        {/* history */}
        {gscLog.length > 0 ? (
          <div className="border-t border-white/5 pt-3">
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              <FileClock className="h-3 w-3" /> Recent GSC activity
            </h4>
            <div className="space-y-0.5">
              {gscLog.slice(0, 5).map((e, i) => (
                <div
                  key={`${e.ts}-${i}`}
                  className="flex items-center gap-2 text-[10px] text-zinc-600"
                >
                  {e.ok ? (
                    <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="h-2.5 w-2.5 shrink-0 text-rose-500" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {e.action} · {e.host}
                  </span>
                  <span className="shrink-0">{relativeTime(e.ts)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!canUseApi && mode === "token" ? (
          <p className="mt-3 text-center text-[10px] leading-relaxed text-zinc-600">
            Prefer not to use any token at all? Use the{" "}
            <span className="text-zinc-400">copy all</span> button on the left
            and paste the list into Search Console → Sitemaps — same result,
            just 2 minutes of clicking.
          </p>
        ) : null}
      </div>
    </div>
  );
}
