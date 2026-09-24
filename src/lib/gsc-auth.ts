// ─── GSC OAuth "connect once" credential store ───────────────────────────────
// The user authorizes ONCE via the consent link generated in the dashboard.
// We store the resulting refresh token server-side and the backend
// auto-refreshes short-lived access tokens from then on — no more hourly
// token pasting.
//
// STORAGE: Postgres via pg-state (durable across serverless cold starts and
// redeploys) with the classic db/gsc-auth.json file as transparent fallback
// when no DATABASE_URL is configured.
//
// SECURITY: secrets live only in the server-side store and are
// NEVER returned to the client, never logged. The API only exposes booleans
// (connected / needsReauth) and timestamps.

import { mutateState, readState, writeState, deleteState } from "@/lib/pg-state";
import {
  DOMAIN_PROPERTY,
  GSC_OWNER_EMAIL,
} from "@/lib/gsc-types";

const KEY = "gsc-auth";
const PROPERTY_RESOURCE = `sc-domain:${DOMAIN_PROPERTY}`;
const ACCESS_PROBE_TTL = 60 * 60 * 1000; // re-check account/property at most hourly

export { GSC_OWNER_EMAIL };

export interface GscAuthStore {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  savedAt: string; // ISO
  lastRefreshAt?: string; // ISO
  lastAccessTokenExpiry?: number; // epoch ms
  needsReauth?: boolean; // set when Google returns invalid_grant
  lastError?: string;
  // account-identity probe (2026-09-21): WHICH Google account is connected
  // and can it actually see the Domain property? Catches the "connected the
  // wrong Gmail" mistake the moment it happens.
  connectedEmail?: string; // when Google tells us (userinfo scope)
  propertyAccessible?: boolean | null; // null = unknown / probe failed
  accessCheckedAt?: string; // ISO
}

export interface GscAuthStatus {
  connected: boolean;
  needsReauth: boolean;
  savedAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
  connectedEmail: string | null;
  propertyAccessible: boolean | null;
  accessCheckedAt: string | null;
}

let memCache: { token: string; expiresAt: number } | null = null;

async function readAuth(): Promise<GscAuthStore | null> {
  const parsed = await readState<GscAuthStore>(KEY);
  return parsed?.refreshToken && parsed?.clientId && parsed?.clientSecret
    ? parsed
    : null;
}

async function writeAuth(store: GscAuthStore | null): Promise<void> {
  if (store === null) {
    await deleteState(KEY);
    return;
  }
  await writeState(KEY, store);
}

/**
 * Merge field updates into the CURRENT auth store under optimistic-CAS
 * (H1, 2026-09-21). Fixes the stale-refresh clobber: a slow token refresh
 * that read an OLD store can no longer write it back over a NEWER
 * credential saved by a reconnect in between — and it never resurrects a
 * store that was disconnected while the refresh was in flight.
 */
async function mutateAuthFields(fields: Partial<GscAuthStore>): Promise<void> {
  await mutateState<GscAuthStore>(KEY, (cur) =>
    cur ? { ...cur, ...fields } : null,
  );
}

/** Public-safe status for the dashboard — no secret material. */
export async function gscAuthStatus(): Promise<GscAuthStatus> {
  const store = await readAuth();
  if (store) {
    // best-effort identity probe — fire-and-forget so status stays fast;
    // the NEXT poll picks up the refreshed fields (throttled to 1/hour).
    void refreshAccessProbe(false).catch(() => undefined);
  }
  return {
    connected: !!store,
    needsReauth: !!store?.needsReauth,
    savedAt: store?.savedAt ?? null,
    lastRefreshAt: store?.lastRefreshAt ?? null,
    lastError: store?.lastError ?? null,
    connectedEmail: store?.connectedEmail ?? null,
    propertyAccessible: store?.propertyAccessible ?? null,
    accessCheckedAt: store?.accessCheckedAt ?? null,
  };
}

export async function disconnectGscAuth(): Promise<void> {
  memCache = null;
  await writeAuth(null);
}

/**
 * Returns a fresh access token using the stored refresh token, or null when
 * no stored auth / refresh rejected. Refresh failures flip needsReauth so the
 * UI can prompt for a one-time re-connect instead of failing silently.
 */
export async function getStoredAccessToken(): Promise<string | null> {
  const store = await readAuth();
  if (!store) return null;

  if (memCache && memCache.expiresAt > Date.now() + 60_000) {
    return memCache.token;
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: store.clientId,
        client_secret: store.clientSecret,
        refresh_token: store.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !body.access_token) {
      const invalidGrant =
        body.error === "invalid_grant" ||
        /invalid_grant|expired|revoked/i.test(body.error_description ?? "");
      await mutateAuthFields({
        needsReauth: invalidGrant || store.needsReauth || false,
        lastError: `${body.error ?? res.status}: ${(body.error_description ?? "refresh failed").slice(0, 160)}`,
      });
      memCache = null;
      return null;
    }

    const ttl = (body.expires_in ?? 3600) * 1000;
    memCache = { token: body.access_token, expiresAt: Date.now() + ttl };
    await mutateAuthFields({
      needsReauth: false,
      lastError: undefined,
      lastRefreshAt: new Date().toISOString(),
      lastAccessTokenExpiry: memCache.expiresAt,
    });
    return memCache.token;
  } catch (e) {
    await mutateAuthFields({
      lastError: `network: ${e instanceof Error ? e.message : "refresh failed"}`,
    });
    memCache = null;
    return null;
  }
}

// ─── account-identity probe (2026-09-21) ────────────────────────────────────

/** Ask Google WHO this token belongs to and WHAT it can see in Search Console. */
async function probeAccess(token: string): Promise<{
  email: string | null;
  propertyAccessible: boolean | null;
}> {
  let email: string | null = null;
  let propertyAccessible: boolean | null = null;

  // identity — only answers when the consent included userinfo.email;
  // older connections (webmasters-only) 403 here and we stay silent.
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.ok) {
      const j = (await res.json()) as { email?: string };
      if (j.email) email = j.email;
    }
  } catch {
    /* cosmetic only — fall through */
  }

  // the AUTHORITATIVE signal: does the sites list contain our Domain property?
  try {
    const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (res.ok) {
      const j = (await res.json()) as { siteUrl?: string[] };
      propertyAccessible = (j.siteUrl ?? []).includes(PROPERTY_RESOURCE);
    } else if (res.status === 403) {
      // token valid but sees NO Search Console properties at all
      propertyAccessible = false;
    }
  } catch {
    /* leave unknown */
  }

  return { email, propertyAccessible };
}

/**
 * Refresh the stored identity probe. Throttled to 1/hour unless forced
 * (connect time / explicit re-check). Never throws into the caller.
 */
export async function refreshAccessProbe(force: boolean): Promise<void> {
  const store = await readAuth();
  if (!store) return;
  if (!force && store.accessCheckedAt) {
    const age = Date.now() - new Date(store.accessCheckedAt).getTime();
    if (age < ACCESS_PROBE_TTL) return;
  }
  const token = await getStoredAccessToken();
  if (!token) return;
  const probe = await probeAccess(token);
  await mutateState<GscAuthStore>(KEY, (cur) =>
    cur
      ? {
          ...cur,
          connectedEmail: probe.email ?? cur.connectedEmail,
          propertyAccessible: probe.propertyAccessible ?? cur.propertyAccessible ?? null,
          accessCheckedAt: new Date().toISOString(),
        }
      : null,
  );
}

/**
 * Validate + persist a new "connect once" credential triple.
 * Proves it works by refreshing immediately — returns { ok, error? }.
 */
export async function saveGscAuth(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ ok: boolean; error?: string }> {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  const refreshToken = input.refreshToken.trim();

  if (
    clientId.length < 20 ||
    clientSecret.length < 10 ||
    refreshToken.length < 20 ||
    /\s/.test(refreshToken)
  ) {
    return { ok: false, error: "Values look malformed — paste each value exactly as Google/Playground showed it." };
  }

  // prove the triple works BEFORE storing anything
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const body = (await res.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      const desc = (body.error_description ?? body.error ?? `HTTP ${res.status}`).slice(0, 200);
      return {
        ok: false,
        error:
          body.error === "invalid_grant"
            ? `Google rejected the refresh token (${desc}). Generate a new one: consent link → Playground → Exchange → copy the refresh_token.`
            : `Google rejected the credentials — ${desc}`,
      };
    }
  } catch (e) {
    return { ok: false, error: `Could not reach Google: ${e instanceof Error ? e.message : "network error"}` };
  }

  memCache = null;
  await writeAuth({
    clientId,
    clientSecret,
    refreshToken,
    savedAt: new Date().toISOString(),
    needsReauth: false,
  });
  // connect time is exactly when the wrong-account mistake happens —
  // probe synchronously so the UI can warn immediately.
  try {
    await refreshAccessProbe(true);
  } catch {
    /* non-fatal — status shows unknown until next poll */
  }
  return { ok: true };
}
