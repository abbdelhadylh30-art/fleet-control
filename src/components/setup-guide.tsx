"use client";

import {
  BookOpenCheck,
  CheckCircle2,
  Copy,
  Timer,
} from "lucide-react";

import { copyText } from "@/lib/copy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FleetSiteStatus, VerifyStatus } from "@/lib/fleet";

const DOMAIN_PROPERTY = "abdelhadygabriel.me";

/** Google / Bing one-go indexing walkthrough (lives on /integrations). */
export function SetupGuide({
  sites,
  gsc,
  bing,
}: {
  sites: FleetSiteStatus[];
  gsc: VerifyStatus;
  bing: VerifyStatus;
}) {
  const withSitemap = sites.filter((s) => s.health.sitemapOk);
  const allSitemaps = withSitemap
    .map((s) => `https://${s.host}/sitemap.xml`)
    .join("\n");
  const gscDone = gsc.verified;

  return (
    <Card className="fade-up-item border-white/5 bg-zinc-900/60 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <BookOpenCheck className="h-4 w-4 text-emerald-400" />
          Google &amp; Bing — finish indexing in one go
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={`gap-1 px-2 py-0.5 text-[10px] ring-1 ${
                  gscDone
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
                    : "border-amber-500/25 bg-amber-500/10 text-amber-400 ring-amber-500/20"
                }`}
              >
                {gscDone ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Timer className="h-3 w-3" />
                )}
                GSC TXT {gsc.checked ? (gscDone ? "verified" : "not found") : "checking…"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-64 border border-white/10 bg-zinc-900 text-zinc-200">
              {gscDone ? (
                <span className="font-mono text-[10px] break-all">{gsc.record}</span>
              ) : (
                <span>
                  No google-site-verification TXT on {DOMAIN_PROPERTY} yet — add it in Vercel → Domains → DNS.
                </span>
              )}
            </TooltipContent>
          </Tooltip>
          <Badge
            variant="outline"
            className={`gap-1 px-2 py-0.5 text-[10px] ring-1 ${
              bing.verified
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
                : "border-white/10 bg-white/[0.03] text-zinc-500 ring-white/10"
            }`}
          >
            {bing.verified ? <CheckCircle2 className="h-3 w-3" /> : <Timer className="h-3 w-3" />}
            Bing {bing.verified ? "verified" : "optional"}
          </Badge>
        </div>
      </div>
      <CardContent className="grid gap-6 p-5 lg:grid-cols-[1fr_1.2fr]">
        {/* Google steps */}
        <ol className="space-y-3.5">
          {[
            {
              t: "Open Google Search Console → Add property → Domain",
              d: "chooses the DOMAIN type, not URL prefix",
            },
            {
              t: `Enter ${DOMAIN_PROPERTY}`,
              d: "covers the apex + all 13 subdomains in one property",
              copy: DOMAIN_PROPERTY,
            },
            {
              t: "Paste the TXT record into Vercel → Domains → DNS",
              d: gscDone
                ? "TXT already detected on the domain — just click Verify in GSC"
                : "then click Verify — done forever",
            },
            {
              t: "Submit the sitemaps — NOT one by one",
              d: "connect Google once below (auto-refreshing), then it's one click — or copy the whole list",
            },
          ].map((s, i) => {
            const done = gscDone && i < 3;
            return (
              <li key={i} className="flex gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ${
                    done
                      ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/40"
                      : "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25"
                  }`}
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <div className="min-w-0 text-sm leading-relaxed">
                  <span className={done ? "text-zinc-400" : "text-zinc-200"}>
                    {s.t}
                  </span>{" "}
                  <span className="text-zinc-500">— {s.d}</span>
                  {s.copy ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copyText(s.copy!)}
                      className="ml-1 h-6 gap-1 px-1.5 text-[11px] text-emerald-400 hover:bg-emerald-500/10"
                    >
                      <Copy className="h-3 w-3" /> copy
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
          <li className="rounded-xl bg-white/[0.03] p-3 text-xs leading-relaxed text-zinc-400 ring-1 ring-white/5">
            <span className="font-semibold text-zinc-300">Bing:</span> IndexNow
            submissions already flow into Bing automatically. Optionally sign in
            at bing.com/webmasters → import sites from Google Search Console
            {gscDone ? " (GSC is verified, so import works instantly)" : ""}.
          </li>
        </ol>

        {/* sitemap copy list */}
        <div className="rounded-xl border border-white/5 bg-black/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Verified sitemaps ({withSitemap.length})
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void copyText(allSitemaps, `Copied ${withSitemap.length} sitemap URLs`)
              }
              className="h-7 gap-1 px-2 text-[11px] text-emerald-400 hover:bg-emerald-500/10"
            >
              <Copy className="h-3 w-3" /> copy all
            </Button>
          </div>
          <ScrollArea className="scrollbar-thin max-h-64">
            <div className="space-y-1 pr-2">
              {withSitemap.map((s) => (
                <button
                  key={s.id}
                  onClick={() =>
                    void copyText(
                      `https://${s.host}/sitemap.xml`,
                      "Sitemap URL copied",
                    )
                  }
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                >
                  <span className="truncate font-mono text-[11px] text-zinc-400">
                    https://{s.host}/sitemap.xml
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] tabular-nums text-zinc-600">
                      {s.health.sitemapUrls} URLs
                    </span>
                    <Copy className="h-3 w-3 text-zinc-600" />
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
