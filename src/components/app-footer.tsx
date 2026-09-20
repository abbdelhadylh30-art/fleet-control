import Link from "next/link";

/**
 * Shared sticky footer. Sticks to the bottom on short pages (parent is
 * min-h-screen flex-col, footer uses mt-auto) and pushes down naturally
 * when content overflows.
 */
export function AppFooter({
  extra,
}: {
  /** page-specific live info (e.g. auto-refresh cadence) */
  extra?: React.ReactNode;
}) {
  return (
    <footer className="mt-auto border-t border-white/5 bg-[#0a0c10]/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-zinc-600 sm:px-6">
        <span className="flex flex-wrap items-center gap-2">
          <span>
            Fleet Control <span className="text-zinc-700">v15</span> · built with{" "}
            <span className="text-zinc-400">Z.ai Code</span>
          </span>
          {extra}
          <span className="hidden items-center gap-1.5 md:flex">
            <span className="text-zinc-700">shortcuts:</span>
            <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400" role="kbd" aria-label="Press slash to focus search">/</kbd>
            <span className="text-zinc-700">search</span>
            <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400" role="kbd" aria-label="Press R to force recheck">R</kbd>
            <span className="text-zinc-700">recheck</span>
          </span>
        </span>
        <span className="font-mono">
          IndexNow key 11e7…c49b ·{" "}
          <Link
            href="https://abdelhadygabriel.me"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-zinc-400"
          >
            abdelhadygabriel.me
          </Link>
        </span>
      </div>
    </footer>
  );
}
