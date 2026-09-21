"use client";

import { AppFooter } from "@/components/app-footer";
import { AppNav } from "@/components/app-nav";

/**
 * Shared page chrome: nav on top, sticky footer at the bottom. The min-h-screen
 * flex-col wrapper keeps the footer pinned to the viewport bottom on short
 * pages and pushed down on long ones.
 *
 * NOTE (2026-09-21): AuthGate used to wrap children HERE. That was structural
 * security theater — the gate only hid the page's JSX while the page component
 * itself already mounted and fired its fetch effects (pre-auth fetch storm,
 * live crash on the anonymous fleet payload). The gate now lives in the root
 * LAYOUT so entire pages (hooks included) mount only after authentication.
 */
export function AppShell({
  children,
  footerExtra,
}: {
  children: React.ReactNode;
  footerExtra?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#0a0c10] text-zinc-100">
      <AppNav />
      {children}
      <AppFooter extra={footerExtra} />
    </div>
  );
}
