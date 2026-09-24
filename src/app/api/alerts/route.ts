import { NextResponse } from "next/server";

import {
  ALERT_KINDS,
  maskBotToken,
  maskUrl,
  readAlertConfig,
  readAlertLog,
  saveAlertConfig,
  sendTestAlert,
  type AlertChannel,
  type AlertConfig,
  type AlertKind,
} from "@/lib/alerts";
import { clientIp, rateLimit, requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";

/** Public-safe view of a channel — secrets masked. */
function safeChannel(ch: AlertChannel) {
  return {
    id: ch.id,
    type: ch.type,
    label: ch.label,
    enabled: ch.enabled,
    createdAt: ch.createdAt,
    botTokenMasked: maskBotToken(ch.botToken),
    chatId: ch.chatId ?? null,
    urlMasked: maskUrl(ch.url),
  };
}

/** GET → channels (masked) + event switches + cooldown + recent delivery log. */
export async function GET(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  const [config, log] = await Promise.all([readAlertConfig(), readAlertLog(30)]);
  return NextResponse.json(
    {
      channels: config.channels.map(safeChannel),
      events: config.events,
      cooldownMin: config.cooldownMin,
      legacyEnvWebhook: Boolean((process.env.FLEET_ALERT_WEBHOOK ?? "").trim()),
      log,
      kinds: ALERT_KINDS,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

// POST actions (admin-gated):
//   { action: "save-telegram", id?, label, botToken, chatId }
//   { action: "save-webhook",  id?, label, url }
//   { action: "delete-channel", id }
//   { action: "toggle-channel", id, enabled }
//   { action: "set-events", events: Partial<Record<AlertKind, boolean>> }
//   { action: "set-cooldown", minutes }
//   { action: "test", id? }  → sends a test message, returns per-channel result
export async function POST(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  // management mutations are cheap but abusable — light limiter
  const rl = rateLimit(`alerts:${clientIp(req)}`, 40, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many alert config changes — slow down." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } },
    );
  }

  let body: {
    action?: string;
    id?: string;
    label?: string;
    botToken?: string;
    chatId?: string;
    url?: string;
    enabled?: boolean;
    events?: Partial<Record<AlertKind, boolean>>;
    minutes?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const config = await readAlertConfig();

  if (body.action === "save-telegram") {
    const label = (body.label ?? "").trim().slice(0, 60) || "Telegram";
    const botToken = (body.botToken ?? "").trim();
    const chatId = (body.chatId ?? "").trim();
    if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
      return NextResponse.json(
        {
          error:
            "That doesn't look like a bot token — create a bot with @BotFather and paste the full token (looks like 123456789:AA…).",
        },
        { status: 400 },
      );
    }
    if (!/^-?\d{3,}$/.test(chatId)) {
      return NextResponse.json(
        {
          error:
            "Chat ID must be numeric (your user id from @userinfobot, or a negative -100… id for a group).",
        },
        { status: 400 },
      );
    }
    const existingIdx = config.channels.findIndex((c) => c.id === body.id);
    const channel: AlertChannel = {
      id: body.id ?? `tg_${Date.now().toString(36)}`,
      type: "telegram",
      label,
      enabled: true,
      createdAt: existingIdx >= 0 ? config.channels[existingIdx].createdAt : new Date().toISOString(),
      botToken,
      chatId,
    };
    if (existingIdx >= 0) config.channels[existingIdx] = channel;
    else config.channels.push(channel);
    await saveAlertConfig(config);
    return NextResponse.json({ ok: true, channel: safeChannel(channel) });
  }

  if (body.action === "save-webhook") {
    const label = (body.label ?? "").trim().slice(0, 60) || "Webhook";
    const url = (body.url ?? "").trim();
    if (!/^https:\/\/.+/i.test(url)) {
      return NextResponse.json(
        { error: "Webhook URL must be an https:// URL (Slack / Discord / your own endpoint)." },
        { status: 400 },
      );
    }
    const existingIdx = config.channels.findIndex((c) => c.id === body.id);
    const channel: AlertChannel = {
      id: body.id ?? `wh_${Date.now().toString(36)}`,
      type: "webhook",
      label,
      enabled: true,
      createdAt: existingIdx >= 0 ? config.channels[existingIdx].createdAt : new Date().toISOString(),
      url,
    };
    if (existingIdx >= 0) config.channels[existingIdx] = channel;
    else config.channels.push(channel);
    await saveAlertConfig(config);
    return NextResponse.json({ ok: true, channel: safeChannel(channel) });
  }

  if (body.action === "delete-channel") {
    const before = config.channels.length;
    config.channels = config.channels.filter((c) => c.id !== body.id);
    if (config.channels.length === before) {
      return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    }
    await saveAlertConfig(config);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "toggle-channel") {
    const ch = config.channels.find((c) => c.id === body.id);
    if (!ch) return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    ch.enabled = Boolean(body.enabled);
    await saveAlertConfig(config);
    return NextResponse.json({ ok: true, channel: safeChannel(ch) });
  }

  if (body.action === "set-events") {
    const incoming = body.events ?? {};
    for (const kind of ALERT_KINDS) {
      if (typeof incoming[kind] === "boolean") config.events[kind] = incoming[kind] as boolean;
    }
    await saveAlertConfig(config);
    return NextResponse.json({ ok: true, events: config.events });
  }

  if (body.action === "set-cooldown") {
    const minutes = Math.round(Number(body.minutes));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
      return NextResponse.json(
        { error: "Cooldown must be between 0 and 1440 minutes." },
        { status: 400 },
      );
    }
    config.cooldownMin = minutes;
    await saveAlertConfig(config);
    return NextResponse.json({ ok: true, cooldownMin: config.cooldownMin });
  }

  if (body.action === "test") {
    const results = await sendTestAlert(body.id);
    if (results.length === 0) {
      return NextResponse.json(
        { error: "No channel matched — add a channel first." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: results.some((r) => r.ok), results });
  }

  return NextResponse.json(
    {
      error:
        'Unknown action — expected "save-telegram", "save-webhook", "delete-channel", "toggle-channel", "set-events", "set-cooldown" or "test".',
    },
    { status: 400 },
  );
}

// keep the config type import referenced for consumers typing against this route
export type { AlertConfig };
