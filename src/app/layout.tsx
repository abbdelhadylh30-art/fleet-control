import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fleet Control — abdelhadygabriel.me",
  description: "Live status, SEO readiness and IndexNow indexing pipeline for the 13-site fleet on abdelhadygabriel.me.",
  keywords: ["fleet control", "IndexNow", "SEO", "abdelhadygabriel.me", "site status", "Next.js"],
  authors: [{ name: "Z.ai Team" }],
  applicationName: "Fleet Control",
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Fleet Control — abdelhadygabriel.me",
    description: "Live status, SEO readiness and IndexNow indexing pipeline for the 13-site fleet.",
    siteName: "Fleet Control",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fleet Control — abdelhadygabriel.me",
    description: "Live status, SEO readiness and IndexNow indexing pipeline for the 13-site fleet.",
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
        {children}
        <Toaster />
      </body>
    </html>
  );
}
