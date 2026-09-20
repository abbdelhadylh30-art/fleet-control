import type { MetadataRoute } from "next";

const BASE = "https://fleet.abdelhadygabriel.me";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
