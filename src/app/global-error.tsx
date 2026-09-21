"use client";

// ─── Global error boundary — the last resort above the root layout ──────────
// Only fires when the ROOT LAYOUT itself throws (a step below error.tsx).
// Must render its own <html>/<body> because the layout is gone. Keep it
// dependency-free: if the layout crashed, assume nothing else is safe.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0c10",
          color: "#e4e4e7",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
          padding: "1rem",
        }}
      >
        <h1 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
          Fleet Control failed to boot
        </h1>
        <p
          style={{
            fontSize: "0.8rem",
            color: "#71717a",
            maxWidth: "42ch",
            lineHeight: 1.6,
            margin: "0.5rem 0 0",
          }}
        >
          A root-level error stopped the dashboard from rendering. The fleet
          itself is unaffected — this is a UI failure only.
        </p>
        {error.digest && (
          <p
            style={{
              fontSize: "0.7rem",
              color: "#52525b",
              fontFamily: "monospace",
              margin: "0.75rem 0 0",
            }}
          >
            digest: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            marginTop: "1.25rem",
            height: "2.75rem",
            padding: "0 1.25rem",
            borderRadius: "0.625rem",
            border: "none",
            background: "#10b981",
            color: "#052e21",
            fontWeight: 600,
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
