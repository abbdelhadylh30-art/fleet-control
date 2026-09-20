"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar } from "lucide-react";

const LINKS = [
  { href: "/", label: "Overview", hint: "fleet status" },
  { href: "/integrations", label: "Integrations", hint: "tokens & setup" },
  { href: "/activity", label: "Activity", hint: "submissions log" },
];

/** Global top navigation across the dashboard pages. */
export function AppNav() {
  const pathname = usePathname();

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
            v11
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.02] p-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                title={l.hint}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all sm:px-3.5 sm:text-xs ${
                  active
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                    : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
