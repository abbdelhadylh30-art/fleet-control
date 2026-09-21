"use client";

// ─── Google indexing runbook — the exact path to "finally indexed" ──────────
// Replaces the old 4-step guide with an actionable, status-driven runbook:
//   · every step auto-verifies what it can (TXT record, sitemap liveness,
//     GSC API connection) and says plainly what the user must do by hand
//   · deep links open the exact GSC screen (property, sitemaps, inspector)
//   · copy-ready blocks: all live sitemaps, priority URLs, property id
//   · progress persists in localStorage so "where was I?" always answers

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  ExternalLink,
  Gauge,
  ListChecks,
  Loader2,
  Radar,
  Rocket,
  Search,
  Siren,
  Workflow,
} from "lucide-react";

import { copyText } from "@/lib/copy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FleetSiteStatus, VerifyStatus } from "@/lib/fleet";

const DOMAIN_PROPERTY = "abdelhadygabriel.me";
const GSC_RESOURCE = `sc-domain:${DOMAIN_PROPERTY}`;
const GSC_BASE = "https://search.google.com/search-console";

const GSC_LINKS = {
  home: `${GSC_BASE}?resource_id=${encodeURIComponent(GSC_RESOURCE)}`,
  sitemaps: `${GSC_BASE}/sitemaps?resource_id=${encodeURIComponent(GSC_RESOURCE)}`,
  performance: `${GSC_BASE}/performance/search-analytics?resource_id=${encodeURIComponent(GSC_RESOURCE)}`,
  inspect: (url: string) =>
    `${GSC_BASE}/inspect?resource_id=${encodeURIComponent(GSC_RESOURCE)}&id=${encodeURIComponent(url)}`,
  siteSearch: `https://www.google.com/search?q=${encodeURIComponent(`site:${DOMAIN_PROPERTY}`)}`,
};

const RUNBOOK_KEY = "fleet-runbook-progress-v1";

// ─── module-level building blocks (react-hooks/static-components) ───────────

function StepHead({
  id,
  n,
  title,
  done,
  onToggle,
  icon,
  chip,
}: {
  id: string;
  n: string;
  title: string;
  done: boolean;
  onToggle: () => void;
  icon?: ReactNode;
  chip?: ReactNode;
}) {
  return (
    <div className="group flex w-full flex-wrap items-center gap-2.5 text-left">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={`step ${n} — mark ${done ? "not done" : "done"}`}
        data-runbook-step={id}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-all ${
          done
            ? "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40"
            : "bg-white/[0.03] text-zinc-400 ring-white/10 group-hover:ring-emerald-500/30"
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs font-bold">{n}</span>}
      </button>
      <button
        type="button"
        onClick={onToggle}
        className={`text-sm font-semibold transition-colors ${
          done ? "text-zinc-500 line-through" : "text-zinc-100"
        }`}
      >
        {title}
      </button>
      {chip}
      <span className="ml-auto text-[9px] text-zinc-600 group-hover:text-zinc-500">
        {done ? "done — click to undo" : "click number to mark done"}
      </span>
      {icon}
    </div>
  );
}

function LinkBtn({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 border-white/10 px-2.5 text-[11px] text-zinc-300 hover:bg-white/5"
      >
        {children} <ExternalLink className="h-2.5 w-2.5" />
      </Button>
    </a>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1 border-emerald-500/25 px-2.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10"
      onClick={() => void copyText(text, label)}
    >
      <Copy className="h-2.5 w-2.5" /> {label}
    </Button>
  );
}

interface GscAuthBrief {
  connected: boolean;
  needsReauth: boolean;
}

/** Google / Bing indexing runbook (lives on /integrations). */
export function SetupGuide({
  sites,
  gsc,
  bing,
}: {
  sites: FleetSiteStatus[];
  gsc: VerifyStatus;
  bing: VerifyStatus;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [gscAuth, setGscAuth] = useState<GscAuthBrief | null>(null);
  const [openFix, setOpenFix] = useState(false);

  // progress persistence (deferred — avoid sync setState in effect)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(RUNBOOK_KEY);
        if (raw) setDone(JSON.parse(raw) as Record<string, boolean>);
      } catch {
        /* fresh start */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const toggleDone = (step: string) => {
    setDone((prev) => {
      const next = { ...prev, [step]: !prev[step] };
      try {
        localStorage.setItem(RUNBOOK_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  };

  // GSC API connect status (drives step 3)
  const loadGscAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/gsc", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as {
          auth?: { connected?: boolean; needsReauth?: boolean };
        };
        setGscAuth({
          connected: !!json.auth?.connected,
          needsReauth: !!json.auth?.needsReauth,
        });
      }
    } catch {
      /* non-fatal — manual path still works */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadGscAuth(), 0);
    return () => clearTimeout(t);
  }, [loadGscAuth]);

  const withSitemap = sites.filter((s) => s.health.sitemapOk);
  const missing = sites.filter((s) => !s.health.sitemapOk);
  const allSitemaps = withSitemap.map((s) => `https://${s.host}/sitemap.xml`);
  const totalUrls = withSitemap.reduce((n, s) => n + (s.health.sitemapUrls ?? 0), 0);
  const priorityUrls = withSitemap.slice(0, 8).map((s) => `https://${s.host}/`);
  const gscDone = gsc.verified;
  const doneCount = ["s1", "s2", "s3", "s4", "s5", "s6"].filter((k) => done[k]).length;
  const stepDone = (id: string) => !!done[id];
  const toggle = (id: string) => () => toggleDone(id);

  return (
    <Card className="fade-up-item border-white/5 bg-zinc-900/60 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <BookOpenCheck className="h-4 w-4 text-emerald-400" />
          Google indexing runbook — finish it in one sitting
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={`gap-1 px-2 py-0.5 text-[10px] ${
              doneCount > 0
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/[0.03] text-zinc-500"
            }`}
          >
            <ListChecks className="h-3 w-3" /> {doneCount}/6 steps done
          </Badge>
          <Badge
            variant="outline"
            className={`gap-1 px-2 py-0.5 text-[10px] ring-1 ${
              gscDone
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
                : "border-amber-500/25 bg-amber-500/10 text-amber-400 ring-amber-500/20"
            }`}
          >
            {gscDone ? <CheckCircle2 className="h-3 w-3" /> : <Radar className="h-3 w-3" />}
            GSC TXT {gsc.checked ? (gscDone ? "verified" : "not found") : "checking…"}
          </Badge>
          <Badge
            variant="outline"
            className={`gap-1 px-2 py-0.5 text-[10px] ${
              withSitemap.length === sites.length
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/25 bg-amber-500/10 text-amber-400"
            }`}
          >
            <Gauge className="h-3 w-3" /> sitemaps {withSitemap.length}/{sites.length} live
          </Badge>
        </div>
      </div>

      <CardContent className="space-y-5 p-5">
        {/* ── step 1 ─────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <StepHead
            id="s1"
            done={stepDone("s1")}
            onToggle={toggle("s1")}
            n="1"
            title="Open the verified Search Console property"
            icon={
              <LinkBtn href={GSC_LINKS.home}>
                Open Search Console
              </LinkBtn>
            }
            chip={
              gscDone ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[9px] text-emerald-400">
                  <CheckCircle2 className="h-2.5 w-2.5" /> DNS already verified
                </Badge>
              ) : undefined
            }
          />
          <p className="mt-2 pl-[42px] text-xs leading-relaxed text-zinc-500">
            One <span className="text-zinc-300">Domain property</span> —{" "}
            <code className="rounded bg-black/30 px-1 font-mono text-[10px] text-emerald-300">
              {GSC_RESOURCE}
            </code>{" "}
            — covers the apex and <span className="text-zinc-300">all 13 subdomains</span> at once.
            Verification is already in your DNS
            {gsc.record ? (
              <>
                {" "}
                (<code className="break-all rounded bg-black/30 px-1 font-mono text-[9px] text-zinc-400">{gsc.record.slice(0, 44)}…</code>)
              </>
            ) : null}
            , so just open the link and pick the property. Nothing to paste, nothing to verify.
          </p>
        </section>

        {/* ── step 2 ─────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <StepHead
            id="s2"
            done={stepDone("s2")}
            onToggle={toggle("s2")}
            n="2"
            title={`Submit every live sitemap (${withSitemap.length} ready · ${totalUrls} URLs)`}
            icon={
              <LinkBtn href={GSC_LINKS.sitemaps}>Open Sitemaps page</LinkBtn>
            }
          />
          <p className="mt-2 pl-[42px] text-xs leading-relaxed text-zinc-500">
            In Search Console → <span className="text-zinc-300">Sitemaps</span>: click{" "}
            <span className="text-zinc-300">Add a new sitemap</span>, paste each URL below (only the
            part after the domain — GSC prefills{" "}
            <code className="font-mono text-[10px] text-zinc-400">{DOMAIN_PROPERTY}/</code>), press{" "}
            <span className="text-zinc-300">Submit</span>, repeat. Submission is instant; Google
            crawls over the next days.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 pl-[42px]">
            <CopyBtn
              text={allSitemaps.join("\n")}
              label={`Copy all ${withSitemap.length} sitemap URLs`}
            />
            <CopyBtn text={DOMAIN_PROPERTY} label="Copy property id" />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-1.5 pl-[42px] sm:grid-cols-2 xl:grid-cols-3">
            {withSitemap.map((s) => (
              <div
                key={s.host}
                className="group flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5 transition-colors hover:border-emerald-500/20"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                <span className="truncate text-[11px] text-zinc-300">{s.host}</span>
                <span className="ml-auto shrink-0 text-[9px] text-zinc-600">
                  {s.health.sitemapUrls} URLs
                </span>
                <button
                  type="button"
                  aria-label={`copy sitemap url for ${s.host}`}
                  onClick={() =>
                    void copyText(`https://${s.host}/sitemap.xml`, `Sitemap URL for ${s.host} copied`)
                  }
                  className="text-zinc-600 opacity-0 transition-opacity hover:text-emerald-300 group-hover:opacity-100"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ── step 3 ─────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <StepHead
            id="s3"
            done={stepDone("s3")}
            onToggle={toggle("s3")}
            n="3"
            title="Optional — let the dashboard submit sitemaps for you"
            icon={
              gscAuth?.connected ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[9px] text-emerald-400">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Google API connected
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-white/10 bg-white/[0.03] px-1.5 py-0 text-[9px] text-zinc-500">
                  manual mode is fine
                </Badge>
              )
            }
          />
          {gscAuth?.connected ? (
            <p className="mt-2 pl-[42px] text-xs leading-relaxed text-zinc-500">
              The <span className="text-zinc-300">Google panel below</span> can push every sitemap
              through the Search Console API in one click — and it keeps a submission history with
              per-sitemap counts. Re-run it any time you ship new pages.
            </p>
          ) : (
            <p className="mt-2 pl-[42px] text-xs leading-relaxed text-zinc-500">
              Prefer zero manual repeating? In the{" "}
              <span className="text-zinc-300">Google panel below</span>, connect a Google API token
              once (OAuth Playground, 3 minutes — the panel walks you through it). After that,
              sitemap submission, status checks and history are one click, forever.
            </p>
          )}
        </section>

        {/* ── step 4 ─────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <StepHead
            id="s4"
            done={stepDone("s4")}
            onToggle={toggle("s4")}
            n="4"
            title="Fast-track the pages that matter most"
          />
          <p className="mt-2 pl-[42px] text-xs leading-relaxed text-zinc-500">
            Sitemaps say <span className="text-zinc-300">“here is everything”</span>; URL Inspection
            says <span className="text-zinc-300">“crawl this one now”</span>. Google allows roughly{" "}
            <span className="text-zinc-300">10–12 requests per day</span> — spend them on the
            homepage and money pages first. Open the inspector link, hit{" "}
            <span className="text-zinc-300">Request indexing</span>, next URL.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 pl-[42px]">
            <CopyBtn text={priorityUrls.join("\n")} label="Copy priority URLs" />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-1.5 pl-[42px] sm:grid-cols-2 xl:grid-cols-3">
            {priorityUrls.map((u, i) => (
              <div
                key={u}
                className="group flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5 transition-colors hover:border-emerald-500/20"
              >
                <span className="shrink-0 text-[9px] font-bold text-zinc-600">#{i + 1}</span>
                <span className="truncate text-[11px] text-zinc-300">
                  {u.replace("https://", "")}
                </span>
                <a
                  href={GSC_LINKS.inspect(u)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`inspect ${u} in Google Search Console`}
                  className="ml-auto shrink-0 text-[9px] text-zinc-600 transition-colors hover:text-emerald-300"
                >
                  inspect <ExternalLink className="inline h-2.5 w-2.5" />
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* ── step 5 ─────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <StepHead
            id="s5"
            done={stepDone("s5")}
            onToggle={toggle("s5")}
            n="5"
            title={
              missing.length === 0
                ? "Stragglers — none, every sitemap is live"
                : `Fix the ${missing.length} straggler${missing.length === 1 ? "" : "s"}`
            }
            chip={
              missing.length === 0 ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[9px] text-emerald-400">
                  <CheckCircle2 className="h-2.5 w-2.5" /> 100% sitemap coverage
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-amber-500/25 bg-amber-500/10 px-1.5 py-0 text-[9px] text-amber-400">
                  <Siren className="h-2.5 w-2.5" /> needs Vercel dashboard action
                </Badge>
              )
            }
          />
          {missing.length > 0 ? (
            <>
              <p className="mt-2 pl-[42px] text-xs leading-relaxed text-zinc-500">
                These sites can&apos;t be fully indexed yet — not because of Google, but because
                their sitemap isn&apos;t reachable. The fix is in the{" "}
                <span className="text-zinc-300">Vercel dashboard</span> (attach the domain to the
                git-linked project / connect the repo). Their SEO files are already pushed to the
                repos — the moment the domain serves the right build, everything else is live.
              </p>
              <button
                type="button"
                onClick={() => setOpenFix((v) => !v)}
                className="ml-[42px] mt-2 flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
              >
                {openFix ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {openFix ? "hide" : "show"} per-site details
              </button>
              {openFix && (
                <div className="ml-[42px] mt-2 space-y-1.5">
                  {missing.map((s) => (
                    <div
                      key={s.host}
                      className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold text-amber-200">{s.host}</span>
                        <Badge variant="outline" className="px-1.5 py-0 text-[9px] text-zinc-400">
                          {s.group}
                        </Badge>
                        <a
                          href={`https://${s.host}/sitemap.xml`}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto text-[9px] text-zinc-600 hover:text-zinc-400"
                        >
                          check sitemap <ExternalLink className="inline h-2.5 w-2.5" />
                        </a>
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                        {s.blocker ??
                          s.note ??
                          "sitemap.xml is not reachable on this host yet — verify the deployment is live and the domain attached."}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="mt-2 pl-[42px] text-xs leading-relaxed text-emerald-400/80">
              Every fleet sitemap is live — nothing blocking full indexing. Re-submit after any new
              deployment with new pages.
            </p>
          )}
        </section>

        {/* ── step 6 ─────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <StepHead
            id="s6"
            done={stepDone("s6")}
            onToggle={toggle("s6")}
            n="6"
            title="Track results — and know what “done” looks like"
            icon={
              <>
                <LinkBtn href={GSC_LINKS.siteSearch}>
                  <Search className="h-2.5 w-2.5" /> site: check
                </LinkBtn>
                <LinkBtn href={GSC_LINKS.performance}>Performance</LinkBtn>
              </>
            }
          />
          <ul className="mt-2 space-y-1.5 pl-[42px] text-xs leading-relaxed text-zinc-500">
            <li className="flex gap-2">
              <Rocket className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
              <span>
                <span className="text-zinc-300">Bing / Yandex / Naver</span>: already fed by
                IndexNow (the dashboard auto-resubmits every 6 h) — that pipeline needs nothing
                from you.
              </span>
            </li>
            <li className="flex gap-2">
              <Radar className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
              <span>
                <span className="text-zinc-300">Google</span>: sitemaps show “Processed” in hours,
                but pages appear in search over <span className="text-zinc-300">1–4 weeks</span>.
                New/small sites start with few impressions — that is normal, not a failure.
              </span>
            </li>
            <li className="flex gap-2">
              <Search className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
              <span>
                Weekly check: <code className="font-mono text-[10px] text-zinc-400">site:{DOMAIN_PROPERTY}</code>{" "}
                (button above) — the result count only goes up. The{" "}
                <span className="text-zinc-300">Performance</span> report shows actual queries once
                traffic starts.
              </span>
            </li>
            <li className="flex gap-2">
              <Workflow className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
              <span>
                Every new page you ship: ask the AI to resubmit that host&apos;s sitemap via{" "}
                <span className="text-zinc-300">IndexNow</span> (one click here) — Google picks it
                up from the sitemap on its next crawl.
              </span>
            </li>
          </ul>
        </section>

        {/* bing footnote */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.03] p-3 text-[11px] text-zinc-500 ring-1 ring-white/5">
          <Badge
            variant="outline"
            className={`gap-1 px-1.5 py-0 text-[9px] ${
              bing.verified
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                : "border-white/10 bg-white/[0.03] text-zinc-500"
            }`}
          >
            {bing.verified ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
            Bing {bing.verified ? "verified" : "optional"}
          </Badge>
          {bing.verified ? (
            <span>Bing site ownership confirmed — the IndexNow pipeline covers Bing fully.</span>
          ) : (
            <span>
              Optional: verify Bing by adding{" "}
              <code className="font-mono text-[10px] text-zinc-400">BingSiteAuth.xml</code> at the
              apex — IndexNow submissions already work without it.
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto cursor-default text-[10px] text-zinc-600 underline decoration-dotted">
                why Bing first?
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-64 border border-white/10 bg-zinc-900 text-[10px] leading-relaxed text-zinc-300">
              IndexNow pings Bing instantly on every submit; Google only reads sitemaps + crawls.
              That&apos;s why Bing results show up in days and Google takes weeks.
            </TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}
