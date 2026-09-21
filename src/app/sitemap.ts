import type { MetadataRoute } from "next";

// The dashboard is a member of its own fleet — expose a crawlable sitemap
// so fleet.abdelhadygabriel.me can be armed in the IndexNow pipeline + GSC.
const BASE = "https://fleet.abdelhadygabriel.me";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // 2026-09-21: only the lock screen is public — /integrations and
  // /activity sit behind the admin gate, so advertising them to crawlers
  // (priority 0.7!) made no sense and leaked the admin surface in sitemap.xml.
  return [
    { url: `${BASE}/`, lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
  ];
}
