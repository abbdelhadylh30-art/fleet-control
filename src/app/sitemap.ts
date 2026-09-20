import type { MetadataRoute } from "next";

// The dashboard is a member of its own fleet — expose a crawlable sitemap
// so fleet.abdelhadygabriel.me can be armed in the IndexNow pipeline + GSC.
const BASE = "https://fleet.abdelhadygabriel.me";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
    { url: `${BASE}/integrations`, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE}/activity`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.7 },
  ];
}
