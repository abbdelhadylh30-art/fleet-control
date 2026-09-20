"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, LogOut, Radar, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-gate";

const LINKS = [
  { href: "/", label: "Overview", hint: "fleet status" },
  { href: "/integrations", label: "Integrations", hint: "tokens & setup" },
  { href: "/activity", label: "Activity", hint: "submissions log" },
];

/** Global top navigation across the dashboard pages. */
export function AppNav() {
  const pathname = usePathname();
  const auth = useAuth();

  const signOut = async () => {
    await auth.logout();
  };

  return (
    <nav
      aria-label="Main navigation"
      className="sticky top-0 z-40 border-b border-white/5 bg-[#0a0c10]/85 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-2.5 sm:gap-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg px-1 py-1 transition-opacity hover:opacity-80"
          aria-label="Fleet Control home"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/25">
            <Radar className="h-4 w-4 text-emerald-400" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-zinc-100">
            Fleet Control
          </span>
          <span className="hidden rounded border border-white/10 bg-white/5 px-1 py-px font-mono text-[9px] text-zinc-500 sm:inline">
            v14
          </span>
          {auth.ready && auth.openMode && (
            <span
              title="No admin password set — management plane is open (local/dev mode)"
              className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-medium text-amber-400"
            >
              <ShieldAlert className="h-2.5 w-2.5" /> open mode
            </span>
          )}
        </Link>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.02] p-1">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  title={l.hint}
                  className={`relative rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all duration-300 sm:px-3.5 sm:text-xs ${
                    active
                      ? "scale-[1.03] bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                      : "text-zinc-500 hover:scale-[1.02] hover:bg-white/5 hover:text-zinc-200"
                  }`}
                >
                  {l.label}
                  <span
                    aria-hidden="true"
                    className={`absolute -bottom-0.5 left-1/2 h-0.5 -translate-x-1/2 rounded-full bg-emerald-400 transition-all duration-300 ${
                      active ? "w-1/2 opacity-90 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "w-0 opacity-0"
                    }`}
                  />
                </Link>
              );
            })}
          </div>

          {auth.ready && auth.authenticated && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              title="End the admin session (management plane re-locks)"
              aria-label="Sign out"
              className="h-8 gap-1.5 rounded-xl border border-white/5 bg-white/[0.02] px-2.5 text-[11px] text-zinc-400 transition-colors hover:border-rose-500/25 hover:bg-rose-500/10 hover:text-rose-300"
            >
              <Lock className="h-3 w-3" />
              <span className="hidden sm:inline">Sign out</span>
              <LogOut className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </nav>
  );
}
