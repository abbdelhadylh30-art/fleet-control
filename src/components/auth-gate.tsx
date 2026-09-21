"use client";

// ─── AuthGate — the admin lock on the dashboard shell ────────────────────────
// Wraps AppShell: when FLEET_ADMIN_PASSWORD is set and there is no valid
// session cookie, every page renders the login screen instead of the
// dashboard. Signed-in state (and open mode) flows to AppNav via context.
// The capability plane (agent links) is intentionally NOT cookie-gated —
// AI agents can't hold cookies — this gate protects the human management UI.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Eye, EyeOff, Loader2, LockKeyhole, Radar, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AuthState {
  authRequired: boolean;
  authenticated: boolean;
  expiresAt: string | null;
  openMode: boolean;
}

interface AuthContextValue extends AuthState {
  ready: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  authRequired: false,
  authenticated: false,
  expiresAt: null,
  openMode: true,
  ready: false,
  logout: async () => {},
  refresh: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    authRequired: false,
    authenticated: false,
    expiresAt: null,
    openMode: true,
  });
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth", { cache: "no-store" });
      if (res.ok) setState((await res.json()) as AuthState);
    } catch {
      /* network hiccup — keep last known state */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "login", password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setPassword("");
        toast.success("Dashboard unlocked", { description: "Admin session valid for 12 hours." });
        await refresh();
      } else {
        setError(data.error ?? "Sign-in failed.");
        setShake((s) => s + 1);
      }
    } catch {
      setError("Network error — try again.");
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  }, [busy, password, refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } finally {
      toast("Locked — management plane sealed.", {
        description: "Agent links keep working; the dashboard UI needs sign-in again.",
      });
      await refresh();
    }
  }, [refresh]);

  // boot: hold children until the auth state is known. Pages mount their
  // data fetches on mount, and rendering them pre-auth used to fire
  // /api/fleet + /api/indexnow before the lock screen took over (the
  // 3-requests-in-400ms storm from the 2026-09-20 audit) and flashed the
  // dashboard chrome at anonymous visitors.
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0c10]">
        <Loader2 aria-label="Loading dashboard" className="h-5 w-5 animate-spin text-emerald-400" />
      </div>
    );
  }

  // locked → full-screen login (nav/footer intentionally hidden)
  if (state.authRequired && !state.authenticated) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0a0c10] px-4 text-zinc-100">
        {/* ambient pulse rings */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[560px] w-[560px] rounded-full border border-emerald-500/10" />
          <div className="absolute h-[380px] w-[380px] rounded-full border border-emerald-500/15" />
          <div className="absolute h-[220px] w-[220px] rounded-full border border-emerald-500/20" />
        </div>

        <div
          key={shake}
          className={`relative w-full max-w-sm ${shake > 0 ? "animate-[shake_0.4s_ease-in-out]" : ""}`}
        >
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-emerald-950/30 backdrop-blur">
            <div className="mb-5 flex items-center gap-3">
              <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30">
                <span aria-hidden className="absolute inset-0 rounded-xl bg-emerald-500/20 blur-md" />
                <LockKeyhole className="relative h-5 w-5 text-emerald-400" />
              </span>
              <div>
                <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
                  <Radar className="h-3.5 w-3.5 text-emerald-400" />
                  Fleet Control
                </div>
                <p className="text-xs text-zinc-500">Management plane locked</p>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void login();
              }}
              className="space-y-3"
            >
              <label htmlFor="admin-password" className="sr-only">
                Admin password
              </label>
              <div className="relative">
                <Input
                  ref={inputRef}
                  id="admin-password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="admin password"
                  autoComplete="current-password"
                  autoFocus
                  className="h-11 border-white/10 bg-black/30 pr-10 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/40"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {error && (
                <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-400">
                  <span aria-hidden>✕</span> {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={busy || !password.trim()}
                className="h-11 w-full bg-emerald-500 font-semibold text-emerald-950 transition-all hover:bg-emerald-400 disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" /> Unlock dashboard
                  </>
                )}
              </Button>
            </form>

            <p className="mt-4 border-t border-white/5 pt-3 text-[11px] leading-relaxed text-zinc-600">
              Sessions expire after 12h. Agent links keep working while locked — this gate
              protects minting, vault tokens and redeploys.
            </p>
          </div>
        </div>

        <style jsx global>{`
          @keyframes shake {
            10%, 90% { transform: translateX(-1px); }
            20%, 80% { transform: translateX(2px); }
            30%, 50%, 70% { transform: translateX(-3px); }
            40%, 60% { transform: translateX(3px); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ ...state, ready, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
