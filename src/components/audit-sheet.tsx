"use client";

import { useId } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ExternalLink,
  FileCode2,
  Gauge,
  Github,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Languages,
  Link2,
  Moon,
  Send,
  ShieldCheck,
  Type,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { scoreTone, type FleetSiteStatus, type SiteHealth } from "@/lib/fleet";

// ─── Score ring (SVG donut) ──────────────────────────────────────────────────

const TONE_STROKE = {
  emerald: { from: "#34d399", to: "#059669", text: "text-emerald-300", glow: "0 0 12px rgba(52,211,153,0.35)" },
  amber: { from: "#fcd34d", to: "#d97706", text: "text-amber-300", glow: "0 0 12px rgba(251,191,36,0.30)" },
  rose: { from: "#fda4af", to: "#e11d48", text: "text-rose-300", glow: "0 0 12px rgba(251,113,133,0.30)" },
} as const;

export function ScoreRing({
  score,
  size = 44,
  stroke = 4,
  asTrigger = false,
  onOpen,
  label,
}: {
  score: number;
  size?: number;
  stroke?: number;
  asTrigger?: boolean;
  onOpen?: () => void;
  label?: string;
}) {
  const gradId = useId();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  const t = TONE_STROKE[tone];

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={asTrigger ? "transition-transform duration-300 group-hover/ring:scale-110" : undefined}
      aria-hidden={asTrigger ? true : undefined}
      role={asTrigger ? undefined : "img"}
      aria-label={asTrigger ? undefined : `SEO score ${score} of 100`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 700ms cubic-bezier(0.22,1,0.36,1)", filter: score > 0 ? `drop-shadow(${t.glow})` : undefined }}
      />
      <text
        x="50%"
        y="52%"
        dominantBaseline="middle"
        textAnchor="middle"
        className={`fill-current tabular-nums ${t.text}`}
        fontSize={size * 0.32}
        fontWeight={700}
      >
        {score}
      </text>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={t.from} />
          <stop offset="100%" stopColor={t.to} />
        </linearGradient>
      </defs>
    </svg>
  );

  if (!asTrigger) return svg;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label ?? `Open SEO audit — score ${score} of 100`}
      className="group/ring inline-flex cursor-pointer items-center justify-center rounded-full outline-none transition-all focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0c10]"
    >
      {svg}
    </button>
  );
}

// ─── Score verbal label ──────────────────────────────────────────────────────

function scoreWord(score: number): { word: string; cls: string } {
  if (score >= 90) return { word: "Excellent", cls: "text-emerald-300" };
  if (score >= 80) return { word: "Strong", cls: "text-emerald-300" };
  if (score >= 50) return { word: "Needs work", cls: "text-amber-300" };
  return { word: "Critical", cls: "text-rose-300" };
}

// ─── Weighted breakdown (matches auditScore weights in lib/fleet.ts) ─────────

function scoreBreakdown(h: SiteHealth): {
  label: string;
  got: number;
  max: number;
}[] {
  const a = h.audit;
  const content = a ? (a.titleOk ? 15 : a.title ? 8 : 0) + (a.descriptionOk ? 15 : a.description ? 8 : 0) : 0;
  const social = a ? (a.ogTitleOk && a.ogImageOk ? 15 : a.ogTitleOk || a.ogImageOk ? 8 : 0) + (a.twitterOk ? 5 : 0) : 0;
  const technical = a ? (a.canonicalOk ? 10 : 0) + (a.viewportOk ? 10 : 0) : 0;
  const infra =
    (h.robotsOk ? 5 : 0) + (h.sitemapOk ? 10 : 0) + (h.keyOk ? 5 : 0) + (a ? (a.faviconOk ? 5 : 0) + (a.langOk ? 5 : 0) : 0);
  return [
    { label: "Content", got: content, max: 30 },
    { label: "Social", got: social, max: 20 },
    { label: "Technical", got: technical, max: 20 },
    { label: "Infra", got: infra, max: 30 },
  ];
}

// ─── Audit row ───────────────────────────────────────────────────────────────

type RowState = "ok" | "warn" | "fail";

function AuditRow({
  state,
  icon: Icon,
  label,
  value,
  hint,
}: {
  state: RowState;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  const styles = {
    ok: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
    warn: "text-amber-400 bg-amber-500/10 ring-amber-500/20",
    fail: "text-rose-400 bg-rose-500/10 ring-rose-500/20",
  } as const;
  return (
    <div
      className={`rounded-xl p-3 ring-1 transition-colors ${
        state === "ok"
          ? "bg-white/[0.02] ring-white/5 hover:bg-white/[0.04]"
          : state === "warn"
            ? "bg-amber-500/[0.04] ring-amber-500/15 hover:bg-amber-500/[0.07]"
            : "bg-rose-500/[0.04] ring-rose-500/15 hover:bg-rose-500/[0.07]"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1 ${styles[state]}`}
        >
          {state === "ok" ? (
            <Check className="h-3.5 w-3.5" />
          ) : state === "warn" ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">
          {label}
        </span>
        <span className="max-w-[55%] shrink truncate text-right font-mono text-[10px] text-zinc-500">
          {value}
        </span>
      </div>
      {hint && state !== "ok" ? (
        <p className="mt-1.5 pl-[3.25rem] text-[11px] leading-relaxed text-zinc-500">
          <span
            className={
              state === "warn" ? "text-amber-400/80" : "text-rose-400/80"
            }
          >
            Fix:
          </span>{" "}
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ─── Section title ───────────────────────────────────────────────────────────

function SectionTitle({
  icon: Icon,
  children,
  right,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        <Icon className="h-3.5 w-3.5 text-emerald-400/80" />
        {children}
      </h3>
      {right}
    </div>
  );
}

// ─── Audit sheet ─────────────────────────────────────────────────────────────

export function AuditSheet({
  site,
  open,
  onOpenChange,
  onSubmit,
  busy,
}: {
  site: FleetSiteStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (host: string) => void;
  busy: boolean;
}) {
  const h = site?.health;
  const a = h?.audit ?? null;
  const score = a?.seoScore ?? 0;
  const sw = scoreWord(score);
  const tone = scoreTone(score);
  const breakdown = h ? scoreBreakdown(h) : [];

  const seoReady =
    h?.httpStatus === 200 && h.robotsOk && h.sitemapOk && h.keyOk;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden border-white/10 bg-[#0b0e13] p-0 sm:max-w-md"
      >
        {site && h && a ? (
          <>
            {/* header */}
            <SheetHeader className="space-y-0 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent p-5 pb-4 text-left">
              <div className="flex items-start gap-4">
                <div
                  className="shrink-0 rounded-full p-1"
                  style={{ filter: score > 0 ? `drop-shadow(${TONE_STROKE[tone].glow})` : undefined }}
                >
                  <ScoreRing score={score} size={72} stroke={6} />
                </div>
                <div className="min-w-0 pt-1">
                  <SheetTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
                    <span className="truncate">{site.label}</span>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-white/10 px-1.5 text-[10px] text-zinc-400"
                    >
                      {site.group}
                    </Badge>
                  </SheetTitle>
                  <SheetDescription asChild>
                    <a
                      href={`https://${site.host}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-0.5 font-mono text-xs text-zinc-500 transition-colors hover:text-emerald-400"
                    >
                      {site.host}
                      <ArrowUpRight className="h-3 w-3" />
                    </a>
                  </SheetDescription>
                  <p className="mt-1.5 text-xs">
                    SEO score{" "}
                    <span className={`font-semibold ${TONE_STROKE[tone].text}`}>
                      {score}/100 — {sw.word}
                    </span>
                  </p>
                </div>
              </div>

              {/* weighted breakdown */}
              <div className="mt-4 grid grid-cols-4 gap-2">
                {breakdown.map((b) => {
                  const pct = Math.round((b.got / b.max) * 100);
                  const bTone = scoreTone(pct);
                  return (
                    <div
                      key={b.label}
                      className="rounded-lg bg-white/[0.03] p-2 ring-1 ring-white/5"
                    >
                      <div className="mb-1 flex items-baseline justify-between gap-1">
                        <span className="text-[9px] font-medium uppercase tracking-wide text-zinc-500">
                          {b.label}
                        </span>
                        <span
                          className={`text-[10px] font-bold tabular-nums ${TONE_STROKE[bTone].text}`}
                        >
                          {b.got}
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-white/5">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            bTone === "emerald"
                              ? "bg-emerald-400"
                              : bTone === "amber"
                                ? "bg-amber-400"
                                : "bg-rose-400"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[9px] tabular-nums text-zinc-600">
                        / {b.max} pts
                      </div>
                    </div>
                  );
                })}
              </div>
            </SheetHeader>

            {/* body */}
            <ScrollArea className="scrollbar-thin flex-1">
              <div className="space-y-5 p-5">
                {site.blocker ? (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-400/90 ring-1 ring-amber-500/15">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {site.blocker}
                  </p>
                ) : null}

                {/* social share preview */}
                <section>
                  <SectionTitle icon={ExternalLink}>
                    Social share preview
                  </SectionTitle>
                  <div className="overflow-hidden rounded-xl bg-black/30 ring-1 ring-white/10 transition-colors hover:ring-white/15">
                    {a.ogImageUrl ? (
                      <img
                        src={a.ogImageUrl}
                        alt={`OpenGraph preview image for ${site.label}`}
                        loading="lazy"
                        className="aspect-[1.91/1] w-full bg-white/[0.03] object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex aspect-[1.91/1] w-full flex-col items-center justify-center gap-1.5 bg-white/[0.02] text-center">
                        <ImageIcon className="h-5 w-5 text-zinc-700" />
                        <p className="px-6 text-[11px] leading-relaxed text-zinc-600">
                          No og:image — chat apps show a blank card when this
                          link is shared
                        </p>
                      </div>
                    )}
                    <div className="space-y-1 border-t border-white/5 p-3">
                      <p className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
                        {site.host}
                      </p>
                      <p className="truncate text-sm font-medium text-zinc-200">
                        {a.ogTitleText ?? a.title ?? site.label}
                      </p>
                      {a.ogDescText || a.description ? (
                        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">
                          {a.ogDescText ?? a.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </section>

                {/* on-page */}
                <section>
                  <SectionTitle
                    icon={Gauge}
                    right={
                      <span className="text-[10px] tabular-nums text-zinc-600">
                        {breakdown[0].got + breakdown[1].got} / 50 pts
                      </span>
                    }
                  >
                    On-page & social
                  </SectionTitle>
                  <div className="space-y-1.5">
                    <AuditRow
                      state={
                        a.titleOk ? "ok" : a.title ? "warn" : "fail"
                      }
                      icon={Type}
                      label="Title tag"
                      value={
                        a.title
                          ? `${a.titleLength} chars · ${a.titleOk ? "ideal" : "off-range"}`
                          : "missing"
                      }
                      hint={
                        a.title
                          ? "Keep the title between 15–60 characters — it gets truncated in SERPs outside this range."
                          : "Add metadata.title (or per-page generateMetadata) in the root layout."
                      }
                    />
                    <AuditRow
                      state={
                        a.descriptionOk
                          ? "ok"
                          : a.description
                            ? "warn"
                            : "fail"
                      }
                      icon={FileCode2}
                      label="Meta description"
                      value={
                        a.description
                          ? `${a.descriptionLength} chars · ${a.descriptionOk ? "ideal" : "off-range"}`
                          : "missing"
                      }
                      hint={
                        a.description
                          ? "Keep the description between 50–160 characters for full SERP display."
                          : "Add metadata.description — Google uses it as the snippet fallback."
                      }
                    />
                    <AuditRow
                      state={a.canonicalOk ? "ok" : "fail"}
                      icon={Link2}
                      label="Canonical URL"
                      value={a.canonicalOk ? "present" : "missing"}
                      hint="Add alternates: { canonical: '/' } to metadata (Next.js App Router)."
                    />
                    <AuditRow
                      state={
                        a.ogTitleOk && a.ogImageOk
                          ? "ok"
                          : a.ogTitleOk || a.ogImageOk
                            ? "warn"
                            : "fail"
                      }
                      icon={ImageIcon}
                      label="OpenGraph (title + image)"
                      value={`${a.ogTitleOk ? "title ✓" : "title ✗"} · ${a.ogImageOk ? "image ✓" : "image ✗"}`}
                      hint="Add openGraph: { title, images: ['/opengraph-image'] } — 1200×630 recommended."
                    />
                    <AuditRow
                      state={a.twitterOk ? "ok" : "fail"}
                      icon={Send}
                      label="Twitter card"
                      value={a.twitterOk ? "present" : "missing"}
                      hint="Add twitter: { card: 'summary_large_image' } to metadata."
                    />
                    <AuditRow
                      state={a.h1Count === 1 ? "ok" : "warn"}
                      icon={Type}
                      label="H1 heading"
                      value={`${a.h1Count} found`}
                      hint="Use exactly one <h1> per page — crawlers weight it heavily."
                    />
                  </div>
                </section>

                <Separator className="bg-white/5" />

                {/* indexing */}
                <section>
                  <SectionTitle
                    icon={ShieldCheck}
                    right={
                      <span className="text-[10px] tabular-nums text-zinc-600">
                        {breakdown[2].got + breakdown[3].got} / 50 pts
                      </span>
                    }
                  >
                    Indexing & technical
                  </SectionTitle>
                  <div className="space-y-1.5">
                    <AuditRow
                      state={h.httpStatus === 200 ? "ok" : "fail"}
                      icon={Globe}
                      label="HTTP status"
                      value={h.httpStatus ? String(h.httpStatus) : (h.error ?? "no response")}
                    />
                    <AuditRow
                      state={h.robotsOk ? "ok" : "fail"}
                      icon={ShieldCheck}
                      label="robots.txt"
                      value={
                        h.robotsOk
                          ? h.robotsHasSitemap
                            ? "200 · sitemap declared"
                            : "200 · no Sitemap line"
                          : "missing"
                      }
                      hint={
                        h.robotsOk && !h.robotsHasSitemap
                          ? 'Append "Sitemap: https://<host>/sitemap.xml" to robots.txt.'
                          : "Push a robots.txt into public/ and redeploy."
                      }
                    />
                    <AuditRow
                      state={h.sitemapOk ? "ok" : "fail"}
                      icon={FileCode2}
                      label="sitemap.xml"
                      value={h.sitemapOk ? `${h.sitemapUrls} URLs` : "missing"}
                      hint="Add app/sitemap.ts and redeploy — it regenerates automatically."
                    />
                    <AuditRow
                      state={h.keyOk ? "ok" : "fail"}
                      icon={KeyRound}
                      label="IndexNow key file"
                      value={h.keyOk ? "live" : "not live"}
                      hint="Push public/<key>.txt with the IndexNow key, then hit Recheck."
                    />
                    <AuditRow
                      state={a.viewportOk ? "ok" : "fail"}
                      icon={Moon}
                      label="Viewport meta"
                      value={a.viewportOk ? "present" : "missing"}
                      hint="Next.js sets it by default — a missing viewport means a custom <head> may be overriding it."
                    />
                    <AuditRow
                      state={a.faviconOk ? "ok" : "fail"}
                      icon={ImageIcon}
                      label="Favicon"
                      value={a.faviconOk ? "present" : "missing"}
                      hint="Drop app/icon.png into the repo — Next.js emits the icon links."
                    />
                    <AuditRow
                      state={a.langOk ? "ok" : "fail"}
                      icon={Languages}
                      label="html lang attribute"
                      value={a.lang ? a.lang : "missing"}
                      hint='Set lang on <html> in the root layout (e.g. <html lang="en">).'
                    />
                  </div>
                </section>
              </div>
            </ScrollArea>

            {/* footer actions */}
            <div className="flex items-center gap-2 border-t border-white/5 bg-[#0b0e13] p-4">
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-8 flex-1 gap-1.5 border-white/10 bg-transparent text-xs hover:bg-white/5 hover:text-zinc-100"
              >
                <a href={`https://${site.host}`} target="_blank" rel="noreferrer">
                  <Globe className="h-3.5 w-3.5" /> Live
                </a>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-8 flex-1 gap-1.5 border-white/10 bg-transparent text-xs hover:bg-white/5 hover:text-zinc-100"
              >
                <a
                  href={`https://github.com/abbdelhadylh30-art/${site.repo}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Github className="h-3.5 w-3.5" /> Repo
                </a>
              </Button>
              <Button
                size="sm"
                disabled={busy || !h.keyOk}
                onClick={() => onSubmit(site.host)}
                title={h.keyOk ? undefined : "Key file not live — blocked site"}
                className="h-8 flex-1 gap-1.5 rounded-lg bg-emerald-500/15 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/25 transition-all hover:bg-emerald-500/25 hover:text-emerald-300 disabled:opacity-40"
              >
                {busy ? (
                  <Send className="h-3.5 w-3.5 animate-pulse" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                IndexNow
              </Button>
              {seoReady ? (
                <Badge
                  variant="outline"
                  className="hidden border-emerald-500/20 bg-emerald-500/5 px-2 text-[10px] text-emerald-400 lg:inline-flex"
                >
                  armed
                </Badge>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
            Loading audit…
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
