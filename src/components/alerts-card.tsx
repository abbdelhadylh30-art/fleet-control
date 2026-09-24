"use client";

// ─── AlertsCard — notification channels, wired in the dashboard ──────────────
// Telegram bots + Slack/Discord-style webhooks, per-event-kind switches,
// cooldown dedupe and a delivery log. Replaces the M7 env-only alertWebhook
// as the user-facing way to get pinged when the fleet needs attention.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type AlertKind =
  | "site-down"
  | "site-recovered"
  | "deploy-failed"
  | "security"
  | "gsc-wrong-account";

const KIND_META: Record<AlertKind, { label: string; hint: string }> = {
  "site-down": { label: "Site down", hint: "2 consecutive failed health checks" },
  "site-recovered": { label: "Site recovered", hint: "a confirmed incident closed" },
  "deploy-failed": { label: "Deploy failed", hint: "production deploy ERROR / canceled" },
  security: { label: "Security events", hint: "failed logins, rate limits, gate denials" },
  "gsc-wrong-account": { label: "GSC wrong account", hint: "connected Google can't see the property" },
};

interface ChannelView {
  id: string;
  type: "telegram" | "webhook";
  label: string;
  enabled: boolean;
  createdAt: string;
  botTokenMasked: string | null;
  chatId: string | null;
  urlMasked: string | null;
}

interface LogRow {
  t: string;
  kind: string;
  channelType: string;
  channelLabel: string;
  ok: boolean;
  detail: string;
}

interface AlertsPayload {
  channels: ChannelView[];
  events: Record<AlertKind, boolean>;
  cooldownMin: number;
  legacyEnvWebhook: boolean;
  log: LogRow[];
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

function kindTone(kind: string): string {
  if (kind === "site-down" || kind === "deploy-failed")
    return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  if (kind === "security" || kind === "gsc-wrong-account")
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
}

export function AlertsCard() {
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showTg, setShowTg] = useState(false);
  const [showWh, setShowWh] = useState(false);
  const [tg, setTg] = useState({ label: "", botToken: "", chatId: "" });
  const [wh, setWh] = useState({ label: "", url: "" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (res.status === 401) {
        setData(null);
        return;
      }
      const json = (await res.json()) as AlertsPayload;
      setData(json);
    } catch {
      // transient — keep the previous view
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    pollRef.current = setInterval(() => void load(), 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const act = useCallback(
    async (body: Record<string, unknown>, okMsg: string) => {
      setBusy(body.action as string);
      try {
        const res = await fetch("/api/alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          results?: Array<{ ok: boolean; channelLabel: string; error?: string }>;
        };
        if (!res.ok || json.ok === false) {
          toast.error(json.error ?? "Action failed");
          return json;
        }
        toast.success(okMsg);
        await load();
        return json;
      } catch {
        toast.error("Network error");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const saveTelegram = async () => {
    const json = await act({ action: "save-telegram", ...tg }, "Telegram channel saved — send a test!");
    if (json) setTg({ label: "", botToken: "", chatId: "" });
    if (json) setShowTg(false);
  };
  const saveWebhook = async () => {
    const json = await act({ action: "save-webhook", ...wh }, "Webhook channel saved — send a test!");
    if (json) setWh({ label: "", url: "" });
    if (json) setShowWh(false);
  };

  return (
    <Card className="border-white/5 bg-zinc-900/60 backdrop-blur transition-colors hover:border-white/10">
      <CardContent className="space-y-5 p-5">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/25">
              <BellRing className="h-4.5 w-4.5 text-emerald-400" />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-zinc-100">Alert channels</h2>
              <p className="text-xs text-zinc-500">
                Get pinged on Telegram or a webhook when the fleet needs you.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <Badge
                variant="outline"
                className={
                  data.channels.some((c) => c.enabled)
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
                }
              >
                {data.channels.filter((c) => c.enabled).length}/{data.channels.length} active
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="h-8 gap-1.5 border-white/10 text-zinc-300 hover:bg-white/5"
              aria-label="Refresh alert config"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> loading channels…
          </div>
        ) : !data ? (
          <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
            Unlock the dashboard to configure alert channels.
          </p>
        ) : (
          <>
            {/* channels */}
            <div className="space-y-2">
              {data.channels.length === 0 && (
                <p className="text-xs text-zinc-500">
                  No channels yet — add Telegram for instant pings on your phone, or a webhook for
                  Slack/Discord.
                </p>
              )}
              {data.channels.map((ch) => (
                <div
                  key={ch.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-zinc-950/40 p-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 ring-1 ring-white/5">
                    {ch.type === "telegram" ? (
                      <Send className="h-4 w-4 text-sky-400" />
                    ) : (
                      <Webhook className="h-4 w-4 text-zinc-300" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-200">{ch.label}</p>
                    <p className="truncate font-mono text-[11px] text-zinc-500">
                      {ch.type === "telegram"
                        ? `${ch.botTokenMasked ?? ""}${ch.chatId ? ` → ${ch.chatId}` : ""}`
                        : ch.urlMasked}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === "test"}
                    onClick={() =>
                      void act({ action: "test", id: ch.id }, "Test sent — check the channel").then(
                        (json) => {
                          const bad = json?.results?.find((r) => !r.ok);
                          if (bad)
                            toast.error(`${bad.channelLabel}: ${bad.error ?? "delivery failed"}`);
                        },
                      )
                    }
                    className="h-8 border-white/10 text-xs text-zinc-300 hover:bg-white/5"
                  >
                    {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
                  </Button>
                  <Switch
                    checked={ch.enabled}
                    onCheckedChange={(v) => void act({ action: "toggle-channel", id: ch.id, enabled: v }, v ? "Channel enabled" : "Channel muted")}
                    aria-label={`Toggle ${ch.label}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void act({ action: "delete-channel", id: ch.id }, "Channel removed")}
                    className="h-8 px-2 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300"
                    aria-label={`Delete ${ch.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {/* add-channel rows */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowTg((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-2.5 text-xs text-zinc-300 transition-colors hover:bg-white/5"
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-3.5 w-3.5 text-sky-400" /> Add Telegram channel
                </span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTg ? "rotate-180" : ""}`} />
              </button>
              {showTg && (
                <div className="space-y-3 rounded-xl border border-white/5 bg-zinc-950/40 p-3">
                  <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-zinc-500">
                    <li>Message @BotFather → /newbot → copy the bot token.</li>
                    <li>Send your bot any message, then get your id from @userinfobot (or use a group&apos;s -100… id).</li>
                    <li>Paste both below and press Test.</li>
                  </ol>
                  <Input
                    placeholder="Label (e.g. My phone)"
                    value={tg.label}
                    onChange={(e) => setTg((s) => ({ ...s, label: e.target.value }))}
                    className="h-9 border-white/10 bg-zinc-900/60 text-sm"
                  />
                  <Input
                    placeholder="Bot token — 123456789:AA…"
                    value={tg.botToken}
                    onChange={(e) => setTg((s) => ({ ...s, botToken: e.target.value }))}
                    className="h-9 border-white/10 bg-zinc-900/60 font-mono text-sm"
                    type="password"
                    autoComplete="off"
                  />
                  <Input
                    placeholder="Chat ID — e.g. 123456789 or -100…"
                    value={tg.chatId}
                    onChange={(e) => setTg((s) => ({ ...s, chatId: e.target.value }))}
                    className="h-9 border-white/10 bg-zinc-900/60 font-mono text-sm"
                    autoComplete="off"
                  />
                  <Button
                    size="sm"
                    disabled={busy === "save-telegram" || !tg.botToken || !tg.chatId}
                    onClick={() => void saveTelegram()}
                    className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                  >
                    {busy === "save-telegram" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    Save channel
                  </Button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowWh((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-2.5 text-xs text-zinc-300 transition-colors hover:bg-white/5"
              >
                <span className="flex items-center gap-2">
                  <Plus className="h-3.5 w-3.5 text-zinc-300" /> Add webhook (Slack / Discord / custom)
                </span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showWh ? "rotate-180" : ""}`} />
              </button>
              {showWh && (
                <div className="space-y-3 rounded-xl border border-white/5 bg-zinc-950/40 p-3">
                  <Input
                    placeholder="Label (e.g. Discord #fleet)"
                    value={wh.label}
                    onChange={(e) => setWh((s) => ({ ...s, label: e.target.value }))}
                    className="h-9 border-white/10 bg-zinc-900/60 text-sm"
                  />
                  <Input
                    placeholder="https://discord.com/api/webhooks/…"
                    value={wh.url}
                    onChange={(e) => setWh((s) => ({ ...s, url: e.target.value }))}
                    className="h-9 border-white/10 bg-zinc-900/60 font-mono text-sm"
                    type="url"
                    autoComplete="off"
                  />
                  <Button
                    size="sm"
                    disabled={busy === "save-webhook" || !wh.url}
                    onClick={() => void saveWebhook()}
                    className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                  >
                    {busy === "save-webhook" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    Save channel
                  </Button>
                </div>
              )}
            </div>

            {/* event switches */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Notify me when</p>
              {data.legacyEnvWebhook && (
                <p className="text-[11px] text-zinc-500">
                  FLEET_ALERT_WEBHOOK env is set — it rides along automatically.
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(KIND_META) as AlertKind[]).map((kind) => (
                  <div
                    key={kind}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-200">{KIND_META[kind].label}</p>
                      <p className="truncate text-[11px] text-zinc-500">{KIND_META[kind].hint}</p>
                    </div>
                    <Switch
                      checked={data.events[kind]}
                      onCheckedChange={(v) =>
                        void act({ action: "set-events", events: { [kind]: v } }, v ? "Subscribed" : "Muted")
                      }
                      aria-label={`Toggle ${KIND_META[kind].label}`}
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-medium text-zinc-200">Repeat cooldown</p>
                    <p className="text-[11px] text-zinc-500">min gap between same-kind alerts</p>
                  </div>
                  <div className="flex gap-1">
                    {[5, 10, 30, 60].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => void act({ action: "set-cooldown", minutes: m }, `Cooldown ${m} min`)}
                        className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                          data.cooldownMin === m
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* delivery log */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Delivery log</p>
              {data.log.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Nothing sent yet — alerts land here with their delivery status.
                </p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
                  {data.log.map((row, i) => (
                    <div
                      key={`${row.t}-${i}`}
                      className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-zinc-950/40 px-3 py-2"
                    >
                      {row.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                      )}
                      <span
                        className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${kindTone(row.kind)}`}
                      >
                        {row.kind}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                        <span className="text-zinc-300">{row.channelLabel}</span>
                        {!row.ok && ` — ${row.detail}`}
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-600">{relativeTime(row.t)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
