// One source of truth for absolute URLs and the shared metadata defaults.
//
// The app has two root layouts (app/(globe) and app/(docs)) and neither sits
// under the other, so there is no inherited metadataBase to lean on: the
// sitemaps, robots.txt, feeds and JSON-LD all have to build absolute URLs from
// the same constant or they will disagree with each other. Everything here is
// pure and environment-only, so it is safe to import from a route handler, a
// server component and a build-time sitemap alike.
//
// BASE_METADATA deliberately carries no title. A title set here would be
// inherited as a plain string by both roots, and the docs root needs a title
// template while the globe root needs a bare string that keeps the home page's
// rendered <title> byte-identical to what it was before the split.

import type { Metadata } from "next";

/** Canonical origin. Set NEXT_PUBLIC_SITE_URL in any deployment that is not production. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://eye.jcamd.com";

export const SITE_NAME = "Embedding Atlas";

/**
 * The promise: what eye is for, in one sentence. It is the meta, Open Graph,
 * Twitter and manifest description, the title card's line and the home page's
 * search label, so a stranger and a crawler read the same thing.
 */
export const PROMISE =
  "Ask eye about a US place and get a cited, dated public record: where it comes from, when it was read, and what it leaves out.";

export const BASE_DESCRIPTION = PROMISE;

/**
 * Join SITE_URL with a site-relative path. Accepts a path with or without the
 * leading slash and never emits a double slash; an absolute URL is returned
 * unchanged so callers can pass a citation URL through without branching.
 */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = SITE_URL.replace(/\/+$/, "");
  if (path === "" || path === "/") return `${base}/`;
  return `${base}/${path.replace(/^\/+/, "")}`;
}

/** Shared metadata for both root layouts. No title: each root sets its own. */
export const BASE_METADATA: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Atlas" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: SITE_NAME,
    description: BASE_DESCRIPTION,
    type: "website",
    siteName: SITE_NAME,
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "The Embedding Atlas globe over the Americas with live satellites and earthquakes, under the title",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: BASE_DESCRIPTION,
    images: ["/og.jpg"],
  },
};
