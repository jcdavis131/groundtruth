import type { MetadataRoute } from "next";

import { MANIFEST } from "@/lib/places/registry";
import { absoluteUrl } from "@/lib/seo/base";

// The top of the sitemap tree: the globe, the three hubs and the catalogue, by hand.
//
// Everything else is sharded into its own segment — /place/sitemap/N.xml,
// /metro/sitemap.xml, /state/sitemap.xml — and enumerated from app/robots.ts.
// This file stays five lines long on purpose, because it is the one a person
// opens to check the deployment is pointing at the right origin.
//
// No brief URL appears in any sitemap, here or in a shard. A brief with no
// findings renders noindex, and listing URLs that answer noindex is the
// fastest way to teach a crawler to stop believing the file. Briefs are
// discovered by the in-content link on their place page instead.
//
// lastModified is never new Date() per request. At build time we genuinely do
// not know when a place's content last changed — the numbers arrive at render
// time from upstreams with their own release calendars — so the honest stamp
// is the manifest pull, and the build date only when there has been no pull.

/** Fixed at module evaluation, so every entry in one deploy carries one stamp. */
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const LAST_MODIFIED = MANIFEST.pulled ?? BUILD_DATE;

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl("/"), lastModified: LAST_MODIFIED, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/place"), lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/metro"), lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/state"), lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/catalog"), lastModified: BUILD_DATE, changeFrequency: "weekly", priority: 0.6 },
  ];
}
