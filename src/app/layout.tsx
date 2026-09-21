import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { Toaster } from "@/components/ui/toaster";
import { FLEET } from "@/lib/fleet";

// M8: the per-request CSP nonce (middleware) must reach the rendered script
// tags — a statically prerendered shell is baked WITHOUT nonces at build
// time, which would get every script blocked under 'strict-dynamic'. The
// whole tree renders per request (it's an admin dashboard behind auth —
// there is nothing meaningful to cache anyway).
export const dynamic = "force-dynamic";

// M2 (2026-09-21): single source of truth — the fleet count is derived from
// the FLEET registry, never hand-typed. It was "14" here and "13" in the
// manifest before.
const FLEET_COUNT = FLEET.length;
const SITE_DESCRIPTION = `Live status, SEO readiness and IndexNow indexing pipeline for the ${FLEET_COUNT}-site fleet on abdelhadygabriel.me.`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://fleet.abdelhadygabriel.me"),
  title: "Fleet Control — abdelhadygabriel.me",
  description: SITE_DESCRIPTION,
  keywords: ["fleet control", "IndexNow", "SEO", "abdelhadygabriel.me", "site status", "Next.js"],
  authors: [{ name: "Z.ai Team" }],
  applicationName: "Fleet Control",
  alternates: { canonical: "/" },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Fleet Control — abdelhadygabriel.me",
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "Fleet Control",
    type: "website",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Fleet Control" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Fleet Control — abdelhadygabriel.me",
    description: SITE_DESCRIPTION,
    images: ["/icon-512.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* AuthGate lives in the LAYOUT (2026-09-21 fix): pages used to wrap
            themselves in AppShell → AuthGate, which only gated their JSX — the
            page component still MOUNTED pre-auth, firing its fetch effects
            (the “fixed” pre-auth fetch storm) and crashing on render when the
            anonymous /api/fleet payload (no summary.attention) landed. With
            the gate at the layout level, the page tree never mounts until the
            admin is authenticated — no effects, no fetches, no render. */}
        <AuthGate>{children}</AuthGate>
        <Toaster />
      </body>
    </html>
  );
}
