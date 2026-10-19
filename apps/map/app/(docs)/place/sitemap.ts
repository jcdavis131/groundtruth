import type { MetadataRoute } from "next";

import { MANIFEST, allCountyFips } from "@/lib/places/registry";
import { absoluteUrl } from "@/lib/seo/base";

// Every county the manifest can name, sharded a thousand at a time.
//
// Two version traps live in this file and both are handled explicitly.
//
// First, as of v16 the shard id arrives as a Promise that resolves to a
// STRING. The official example then writes `id * 50000` on the awaited value,
// which works only because JavaScript coerces — and silently produces NaN the
// moment anything else is done with it first. `Number(await props.id)` is the
// version that means what it says.
//
// Second, since v15 the shards are served at /place/sitemap/0.xml, not at
// /place/sitemap.xml/0. app/robots.ts lists them in that form; the two files
// must agree or the shards are published and never fetched.
//
// The shard count is derived, not written down: Math.ceil over the county
// count with a floor of one, so the seed manifest yields a single shard and a
// full pull yields four, with no edit here. A floor of one matters because
// generateSitemaps returning [] would publish no sitemap at all while
// robots.txt still advertised one.

/** Must match COUNTY_SHARD_SIZE in app/robots.ts. */
const COUNTY_SHARD_SIZE = 1000;

/** Fixed at module evaluation; see app/sitemap.ts for why this is not a per-request clock. */
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const LAST_MODIFIED = MANIFEST.pulled ?? BUILD_DATE;

export async function generateSitemaps(): Promise<Array<{ id: number }>> {
  const shards = Math.max(1, Math.ceil(allCountyFips().length / COUNTY_SHARD_SIZE));
  return Array.from({ length: shards }, (_, i) => ({ id: i }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const raw = Number(await props.id);
  const id = Number.isInteger(raw) && raw >= 0 ? raw : 0;
  const start = id * COUNTY_SHARD_SIZE;
  return allCountyFips()
    .slice(start, start + COUNTY_SHARD_SIZE)
    .map((fips) => ({
      url: absoluteUrl(`/place/${fips}`),
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
}
