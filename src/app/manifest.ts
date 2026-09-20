import type { MetadataRoute } from "next";

// PWA manifest — makes Fleet Control installable as a Windows/Mac/Linux
// desktop app (Edge/Chrome: "Install app") and as an Android/iOS icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fleet Control — abdelhadygabriel.me",
    short_name: "Fleet Control",
    description:
      "Live status, SEO readiness, IndexNow indexing pipeline and agent access for the 13-site fleet on abdelhadygabriel.me.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0c10",
    theme_color: "#0a0c10",
    categories: ["developer", "productivity", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
