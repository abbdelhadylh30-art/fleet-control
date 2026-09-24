import { NextResponse } from "next/server";

import {
  appendGscLog,
  gscListSitemaps,
  gscSearchPerformance,
  gscSubmitSitemaps,
  isFleetSitemap,
  readGscLog,
  type GscLogEntry,
} from "@/lib/gsc";
import {
  disconnectGscAuth,
  getStoredAccessToken,
  gscAuthStatus,
  refreshAccessProbe,
  saveGscAuth,
} from "@/lib/gsc-auth";
import { GSC_OWNER_EMAIL } from "@/lib/gsc-types";
import { requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";

// GET → submission history + connect-once status — admin-gated since
//        2026-09-21 (search-console telemetry + auth status are recon when anonymous)
export async function GET(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  const [entries, auth] = await Promise.all([readGscLog(), gscAuthStatus()]);
  return NextResponse.json({ entries, auth }, { headers: { "cache-control": "no-store" } });
}

// POST actions (admin-gated):
//   { action: "save-auth", clientId, clientSecret, refreshToken } → connect once
//   { action: "disconnect" }                                      → forget stored auth (one-click, reversible)
//   { token?, action: "status" }                                  → list sitemaps in GSC
//   { token?, action: "submit", sitemaps: [] }                    → bulk-PUT sitemaps
// status/submit use the manual token when provided, else the stored refresh token.
export async function POST(req: Request) {
  const gate = requireAdmin(req);
  if (gate) return gate;

  let body: {
    token?: string;
    action?: string;
    sitemaps?: string[];
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    confirmToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── connect once: validate + persist the OAuth credential triple ─────────
  if (body.action === "save-auth") {
    const clientId = (body.clientId ?? "").trim();
    const clientSecret = (body.clientSecret ?? "").trim();
    const refreshToken = (body.refreshToken ?? "").trim();
    if (!clientId || !clientSecret || !refreshToken) {
      return NextResponse.json(
        {
          error:
            "Missing values — need clientId, clientSecret and refreshToken (all three, from the consent-link + Playground steps).",
        },
        { status: 400 },
      );
    }
    const result = await saveGscAuth({ clientId, clientSecret, refreshToken });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    // wrong-account tripwire (2026-09-21): the property lives under a SPECIFIC
    // Google account — tell the user IMMEDIATELY if this connection can't see it.
    const access = await gscAuthStatus();

    // sanity: confirm the fresh token actually reads the Domain property
    const token = await getStoredAccessToken();
    const probe = token ? await gscListSitemaps(token) : null;
    await appendGscLog([
      {
        ts: new Date().toISOString(),
        action: "status",
        host: "sc-domain:abdelhadygabriel.me",
        http: probe?.status ?? 0,
        ok: !!probe?.ok,
        reason: probe?.ok
          ? `connect-once saved · ${probe.sitemaps?.length ?? 0} sitemaps already registered`
          : (probe?.error ?? "saved — token refresh OK"),
      },
    ]);
    return NextResponse.json({
      ok: true,
      connected: true,
      access: {
        connectedEmail: access.connectedEmail,
        propertyAccessible: access.propertyAccessible,
        ownerEmail: GSC_OWNER_EMAIL,
      },
      probe: probe
        ? { ok: probe.ok, status: probe.status, error: probe.error, sitemaps: probe.sitemaps }
        : { ok: false, status: 0, error: "token saved but probe failed" },
    });
  }

  // ── force the account-identity probe ("which Google account is this?") ────
  if (body.action === "probe-access") {
    await refreshAccessProbe(true);
    const access = await gscAuthStatus();
    return NextResponse.json({
      ok: true,
      connectedEmail: access.connectedEmail,
      propertyAccessible: access.propertyAccessible,
      accessCheckedAt: access.accessCheckedAt,
      ownerEmail: GSC_OWNER_EMAIL,
    });
  }

  // ── forget stored credentials (one-click — reversible by re-running OAuth) ─
  if (body.action === "disconnect") {
    await disconnectGscAuth();
    return NextResponse.json({ ok: true, connected: false });
  }

  // ── status / submit — resolve token: manual override or stored auth ──────
  const manualToken = (body.token ?? "").trim();
  let token = manualToken || null;
  if (!token) token = await getStoredAccessToken();

  if (!token) {
    const auth = await gscAuthStatus();
    return NextResponse.json(
      {
        error: auth.connected && auth.needsReauth
          ? "Stored Google connection expired (invalid_grant) — re-run the connect-once steps to refresh it."
          : "No Google connection yet — either connect once (recommended) or paste a short-lived access token.",
        needsReauth: auth.needsReauth,
      },
      { status: 401 },
    );
  }

  // manual pasted access tokens are long JWT-ish strings; reject paste errors
  if (manualToken && (manualToken.length < 20 || /\s/.test(manualToken))) {
    return NextResponse.json(
      { error: "That doesn't look like an access token (too short / contains spaces)." },
      { status: 400 },
    );
  }

  // ── status: what has Google already got? ──────────────────────────────────
  if (body.action === "status") {
    const result = await gscListSitemaps(token);
    if (result.ok) {
      await appendGscLog([
        {
          ts: new Date().toISOString(),
          action: "status",
          host: "sc-domain:abdelhadygabriel.me",
          http: 200,
          ok: true,
          reason: `${result.sitemaps?.length ?? 0} sitemaps registered in GSC`,
        },
      ]);
    }
    return NextResponse.json(result);
  }

  // ── submit: bulk-PUT every sitemap ────────────────────────────────────────
  if (body.action === "submit") {
    const sitemaps = (body.sitemaps ?? []).filter(
      (u): u is string => typeof u === "string" && isFleetSitemap(u),
    );
    if (sitemaps.length === 0) {
      return NextResponse.json(
        {
          error:
            "No valid fleet sitemap URLs provided (expected https://<sub>.abdelhadygabriel.me/sitemap.xml).",
        },
        { status: 400 },
      );
    }
    const result = await gscSubmitSitemaps(token, sitemaps);
    const entries: GscLogEntry[] = (result.results ?? []).map((r) => ({
      ts: new Date().toISOString(),
      action: "submit" as const,
      host: r.host,
      http: r.http,
      ok: r.ok,
      reason: r.reason,
    }));
    await appendGscLog(entries);
    return NextResponse.json(result);
  }

  // ── performance: last-28-days clicks / impressions from Search Analytics ──
  if (body.action === "performance") {
    const result = await gscSearchPerformance(token);
    return NextResponse.json(result);
  }

  return NextResponse.json(
    { error: 'Unknown action — expected "save-auth", "disconnect", "probe-access", "status", "submit" or "performance".' },
    { status: 400 },
  );
}
