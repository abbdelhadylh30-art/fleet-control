"use client";

// Small OK/missing badge for per-site SEO signals (L4 split).

export function SeoBadge({
  ok,
  icon: Icon,
  label,
  detail,
}: {
  ok: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: string;
}) {
  return (
    <span
      title={ok ? `${label}: OK` : `${label}: missing`}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 transition-colors ${
        ok
          ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
          : "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20"
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
      {detail ? <span className="text-zinc-500">{detail}</span> : null}
    </span>
  );
}
