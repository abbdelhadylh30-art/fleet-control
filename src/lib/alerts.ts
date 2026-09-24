// ─── Alert channels — Telegram + custom webhooks, configurable in the UI ─────
//
// Upgrades the M7 env-only alertWebhook into a full notification layer:
//   • channels stored in pg-state ("alert-config") — Telegram bots and
//     Slack/Discord-style incoming webhooks, each with an enable toggle
//   • per-event-kind switches (site down / recovered / deploy failed /
//     security / GSC wrong account)
//   • per kind+channel cooldown dedupe (default 10 min) so a flapping host
//     or a brute-force burst can't flood the chat
//   • delivery log (pg-state "alert-log") — what fired, where, did it land
//   • legacy compat: FLEET_ALERT_WEBHOOK env keeps working as an implicit
//     channel, dispatched through the same path
//
// sendAlert() is ALWAYS fire-and-forget safe: alerting must never break the
// operation it reports on.

import { mutateState, readState } from "@/lib/pg-state";

export const ALERT_KINDS = [
  "site-down",
  "site-recovered",
  "deploy-failed",
  "security",
  "gsc-wrong-account",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_KIND_META: Record<AlertKind, { label: string; hint: string }> = {
  "site-down": {
    label: "Site down",
    hint: "A fleet host failed 2 consecutive health checks",
  },
  "site-recovered": {
    label: "Site recovered",
    hint: "A confirmed incident closed (severity included)",
  },
  "deploy-failed": {
    label: "Deploy failed",
    hint: "A production deployment ended in ERROR or CANCELED",
  },
  security: {
    label: "Security events",
    hint: "Logins failed, rate limits tripped, gates denied",
  },
  "gsc-wrong-account": {
    label: "GSC wrong account",
    hint: "The connected Google account can't see the property",
  },
};

export interface AlertChannel {
  id: string;
  type: "telegram" | "webhook";
  label: string;
  enabled: boolean;
  createdAt: string;
  // telegram
  botToken?: string; // hashed-none — stored as-is (server-side pg-state only)
  chatId?: string;
  // generic incoming webhook (Slack/Discord-style)
  url?: string;
}

export interface AlertConfig {
  channels: AlertChannel[];
  events: Record<AlertKind, boolean>;
  cooldownMin: number;
}

export interface AlertLogEntry {
  t: string;
  kind: AlertKind | "test";
  channelType: AlertChannel["type"] | "env-webhook";
  channelLabel: string;
  ok: boolean;
  detail: string; // message or error snippet
}

const CONFIG_KEY = "alert-config";
const LOG_KEY = "alert-log";
const MAX_LOG = 60;
const DEFAULT_COOLDOWN_MIN = 10;

const DEFAULT_CONFIG: AlertConfig = {
  channels: [],
  events: {
    "site-down": true,
    "site-recovered": true,
    "deploy-failed": true,
    security: true,
    "gsc-wrong-account": true,
  },
  cooldownMin: DEFAULT_COOLDOWN_MIN,
};

function normalizeConfig(raw: unknown): AlertConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Partial<AlertConfig>;
  const events = { ...DEFAULT_CONFIG.events, ...(cfg.events ?? {}) };
  return {
    channels: Array.isArray(cfg.channels)
      ? cfg.channels.filter((c) => c && typeof c.id === "string")
      : [],
    events,
    cooldownMin:
      typeof cfg.cooldownMin === "number" && cfg.cooldownMin >= 0 && cfg.cooldownMin <= 1440
        ? cfg.cooldownMin
        : DEFAULT_COOLDOWN_MIN,
  };
}

export async function readAlertConfig(): Promise<AlertConfig> {
  return normalizeConfig(await readState<AlertConfig>(CONFIG_KEY));
}

export async function saveAlertConfig(config: AlertConfig): Promise<void> {
  await mutateState<AlertConfig>(CONFIG_KEY, () => config);
}

export async function readAlertLog(limit = 30): Promise<AlertLogEntry[]> {
  const list = await readState<AlertLogEntry[]>(LOG_KEY);
  return (Array.isArray(list) ? list : []).slice(0, limit);
}

async function appendAlertLog(entries: AlertLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await mutateState<AlertLogEntry[]>(LOG_KEY, (cur) =>
    [...entries, ...(Array.isArray(cur) ? cur : [])].slice(0, MAX_LOG),
  );
}

// ─── secret masking (API responses must never echo full secrets) ──────────────

export function maskBotToken(token: string | undefined): string | null {
  if (!token) return null;
  const tail = token.slice(-4);
  return `bot ••••${tail}`;
}

export function maskUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname.slice(0, 24)}…`;
  } catch {
    return "•••";
  }
}

// ─── delivery ────────────────────────────────────────────────────────────────

interface DeliveryResult {
  channelLabel: string;
  channelType: AlertChannel["type"] | "env-webhook";
  ok: boolean;
  error?: string;
}

async function deliverTelegram(
  ch: AlertChannel,
  text: string,
): Promise<DeliveryResult> {
  if (!ch.botToken || !ch.chatId) {
    return { channelLabel: ch.label, channelType: "telegram", ok: false, error: "missing bot token or chat id" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${ch.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: ch.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (res.status === 200 && body.ok) {
      return { channelLabel: ch.label, channelType: "telegram", ok: true };
    }
    return {
      channelLabel: ch.label,
      channelType: "telegram",
      ok: false,
      error: body.description?.slice(0, 140) ?? `Telegram responded ${res.status}`,
    };
  } catch (e) {
    return {
      channelLabel: ch.label,
      channelType: "telegram",
      ok: false,
      error: e instanceof Error ? e.message : "network error",
    };
  }
}

async function deliverWebhook(
  ch: AlertChannel,
  text: string,
  kind: string,
): Promise<DeliveryResult> {
  if (!ch.url) {
    return { channelLabel: ch.label, channelType: "webhook", ok: false, error: "missing webhook url" };
  }
  try {
    const res = await fetch(ch.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, kind, source: "fleet-control", at: new Date().toISOString() }),
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.status >= 200 && res.status < 300) {
      return { channelLabel: ch.label, channelType: "webhook", ok: true };
    }
    return {
      channelLabel: ch.label,
      channelType: "webhook",
      ok: false,
      error: `webhook responded ${res.status}`,
    };
  } catch (e) {
    return {
      channelLabel: ch.label,
      channelType: "webhook",
      ok: false,
      error: e instanceof Error ? e.message : "network error",
    };
  }
}

/** Legacy M7 channel — FLEET_ALERT_WEBHOOK env (kept working transparently). */
async function deliverEnvWebhook(text: string): Promise<DeliveryResult | null> {
  const url = (process.env.FLEET_ALERT_WEBHOOK ?? "").trim();
  if (!url) return null;
  const ch: AlertChannel = { id: "env", type: "webhook", label: "env webhook", enabled: true, createdAt: "", url };
  return deliverWebhook(ch, text, "env");
}

async function logResults(kind: AlertKind | "test", results: DeliveryResult[]): Promise<void> {
  await appendAlertLog(
    results.map((r) => ({
      t: new Date().toISOString(),
      kind,
      channelType: r.channelType,
      channelLabel: r.channelLabel,
      ok: r.ok,
      detail: r.ok ? "delivered" : (r.error ?? "failed").slice(0, 140),
    })),
  );
}

/**
 * Fan an alert out to every enabled channel subscribed to `kind`.
 * Cooldown: one alert per kind+channel within cooldownMin (deduped via the
 * delivery log itself — durable across cold starts).
 * Never throws; never blocks long (6s per-channel timeout, sequential).
 */
export async function sendAlert(kind: AlertKind, text: string): Promise<void> {
  try {
    const config = await readAlertConfig();
    if (!config.events[kind]) return;

    const cooldownMs = config.cooldownMin * 60_000;
    const log = await readState<AlertLogEntry[]>(LOG_KEY);
    const recent = Array.isArray(log) ? log : [];

    const targets: Array<{ ch: AlertChannel | null; env: boolean }> = config.channels
      .filter((c) => c.enabled)
      .map((ch) => ({ ch, env: false }));

    const results: DeliveryResult[] = [];
    for (const { ch } of targets) {
      const chType = ch!.type;
      const chLabel = ch!.label;
      const lastSame = recent.find(
        (e) => e.kind === kind && e.channelLabel === chLabel && e.channelType === chType,
      );
      if (lastSame && Date.now() - new Date(lastSame.t).getTime() < cooldownMs) continue;
      const r =
        ch!.type === "telegram"
          ? await deliverTelegram(ch!, text)
          : await deliverWebhook(ch!, text, kind);
      results.push(r);
    }

    // legacy env channel — respects the same kind switch + cooldown
    const envLast = recent.find((e) => e.kind === kind && e.channelType === "env-webhook");
    if (!envLast || Date.now() - new Date(envLast.t).getTime() >= cooldownMs) {
      const envRes = await deliverEnvWebhook(text);
      if (envRes) results.push(envRes);
    }

    await logResults(kind, results);
  } catch {
    // alerting must never break the operation it reports on
  }
}

/**
 * Admin "test send": bypasses the kind switch but NOT the log (so cooldown
 * state stays truthful). Sends to one channel (id) or all enabled channels.
 */
export async function sendTestAlert(channelId?: string): Promise<DeliveryResult[]> {
  const config = await readAlertConfig();
  const targets = channelId
    ? config.channels.filter((c) => c.id === channelId)
    : config.channels.filter((c) => c.enabled);
  const text = "✅ <b>Fleet Control test alert</b> — if you can read this, this channel is wired up correctly.";
  const results: DeliveryResult[] = [];
  for (const ch of targets) {
    const r =
      ch.type === "telegram" ? await deliverTelegram(ch, text) : await deliverWebhook(ch, text, "test");
    results.push(r);
  }
  await logResults("test", results);
  return results;
}
