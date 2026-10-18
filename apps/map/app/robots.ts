import type { MetadataRoute } from "next";

import { allCountyFips } from "@/lib/places/registry";
import { absoluteUrl } from "@/lib/seo/base";

// robots.txt, and the closest thing this app has to a sitemap index.
//
// Next has no sitemap-index convention: generateSitemaps produces shards at
// /place/sitemap/0.xml but nothing that enumerates them. The MetadataRoute.Robots
// type accepts a string[] for `sitemap`, and a robots.txt that lists every
// sitemap file is what the Sitemaps protocol calls a discovery mechanism —
// Google treats that list as equivalent to an index. So the shard list is
// built here, from the same county count and the same shard size the place
// sitemap slices with.
//
// Every URL is absolute and built from SITE_URL. This file sits at the app
// root with no root layout above it (app/layout.tsx is gone, there are two
// root layouts in route groups instead), so there is no metadataBase to
// inherit and a relative sitemap URL would be invalid anyway.
//
// /compare is disallowed rather than merely noindexed: a compare URL exists
// for every ordered pair of places, which is roughly ten million addresses,
// and a crawler that discovers one discovers all of them. The pages
// themselves also send index:false follow:true, so a link that is followed
// from elsewhere still passes its equity inward.

/** Counties per sitemap shard. Google's ceiling is 50,000; 1,000 keeps each shard small enough to fetch and diff by hand. */
const COUNTY_SHARD_SIZE = 1000;

export default function robots(): MetadataRoute.Robots {
  const shards = Math.max(1, Math.ceil(allCountyFips().length / COUNTY_SHARD_SIZE));
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/compare"],
      },
    ],
    sitemap: [
      absoluteUrl("/sitemap.xml"),
      absoluteUrl("/metro/sitemap.xml"),
      absoluteUrl("/state/sitemap.xml"),
      ...Array.from({ length: shards }, (_, i) => absoluteUrl(`/place/sitemap/${i}.xml`)),
    ],
  };
}
