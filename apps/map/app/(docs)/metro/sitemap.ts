import type { MetadataRoute } from "next";

import { MANIFEST, allCbsa } from "@/lib/places/registry";
import { absoluteUrl } from "@/lib/seo/base";

// The 393 metropolitan areas, in one file.
//
// The metro table is complete offline — it is derived from the committed BLS
// OEWS metro index — so this shard is the same length in every build, with or
// without egress, and no generateSitemaps is needed for it.
//
// Served at /metro/sitemap.xml. No brief URL is listed; see app/sitemap.ts.

/** Fixed at module evaluation; see app/sitemap.ts for why this is not a per-request clock. */
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const LAST_MODIFIED = MANIFEST.pulled ?? BUILD_DATE;

export default function sitemap(): MetadataRoute.Sitemap {
  return allCbsa().map((cbsa) => ({
    url: absoluteUrl(`/metro/${cbsa}`),
    lastModified: LAST_MODIFIED,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));
}
