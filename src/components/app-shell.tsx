"use client";

import { AppFooter } from "@/components/app-footer";
import { AppNav } from "@/components/app-nav";
import { AuthGate } from "@/components/auth-gate";

/**
 * Shared page chrome: auth gate on the outside (locked dashboard renders the
 * login screen instead of nav/content), nav on top, sticky footer at the
 * bottom. The min-h-screen flex-col wrapper keeps the footer pinned to the
 * viewport bottom on short pages and pushed down on long ones.
 */
export function AppShell({
  children,
  footerExtra,
}: {
  children: React.ReactNode;
  footerExtra?: React.ReactNode;
}) {
  return (
    <AuthGate>
      <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#0a0c10] text-zinc-100">
        <AppNav />
        {children}
        <AppFooter extra={footerExtra} />
      </div>
    </AuthGate>
  );
}
