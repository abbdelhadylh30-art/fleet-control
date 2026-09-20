import { AppFooter } from "@/components/app-footer";
import { AppNav } from "@/components/app-nav";

/**
 * Shared page chrome: nav on top, sticky footer at the bottom.
 * The min-h-screen flex-col wrapper keeps the footer pinned to the
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
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#0a0c10] text-zinc-100">
      <AppNav />
      {children}
      <AppFooter extra={footerExtra} />
    </div>
  );
}
