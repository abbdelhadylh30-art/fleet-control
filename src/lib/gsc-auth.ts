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

const KEY = "gsc-auth";

export interface GscAuthStore {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  savedAt: string; // ISO
  lastRefreshAt?: string; // ISO
  lastAccessTokenExpiry?: number; // epoch ms
  needsReauth?: boolean; // set when Google returns invalid_grant
  lastError?: string;
}

export interface GscAuthStatus {
  connected: boolean;
  needsReauth: boolean;
  savedAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
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
  return {
    connected: !!store,
    needsReauth: !!store?.needsReauth,
    savedAt: store?.savedAt ?? null,
    lastRefreshAt: store?.lastRefreshAt ?? null,
    lastError: store?.lastError ?? null,
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
  return { ok: true };
}
