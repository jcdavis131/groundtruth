import type { MetadataRoute } from "next";

import { MANIFEST, allUsps } from "@/lib/places/registry";
import { absoluteUrl } from "@/lib/seo/base";

// The 52 states, the District of Columbia and Puerto Rico included.
//
// Priority 0.7 rather than the 0.8 counties and metros carry: a state page is
// a real document, but it is also the node every county page already links up
// to, so it needs the least help being found of anything in the tree.
//
// Served at /state/sitemap.xml. No brief URL is listed; see app/sitemap.ts.

/** Fixed at module evaluation; see app/sitemap.ts for why this is not a per-request clock. */
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const LAST_MODIFIED = MANIFEST.pulled ?? BUILD_DATE;

export default function sitemap(): MetadataRoute.Sitemap {
  return allUsps().map((usps) => ({
    url: absoluteUrl(`/state/${usps}`),
    lastModified: LAST_MODIFIED,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
}
