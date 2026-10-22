import type { MetadataRoute } from "next";
import { DOC_PAGES } from "@/lib/docs/registry";

const BASE = "https://diplensrepo.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/docs`, changeFrequency: "weekly", priority: 0.9 },
    ...DOC_PAGES.map((p) => ({
      url: `${BASE}/docs/${p.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
