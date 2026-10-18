import type { NextConfig } from "next";
import path from "node:path";

// Cesium pulls @spz-loader/core (Gaussian-splat decoder with ~250 KB of
// WebAssembly inlined as a JS string) into the client bundle. Turbopack's
// production minifier rewrites that string as a template literal whose
// legacy octal escapes are illegal, so the Cesium chunk fails to parse in
// production. Splats are never used here; alias the package to a stub.
// See lib/vendor/spz-loader-stub.ts.
const SPZ_STUB = "./lib/vendor/spz-loader-stub.ts";

const nextConfig: NextConfig = {
  // app/global-not-found.tsx: the app has two root layouts, so an unmatched
  // URL needs its own themed 404 rather than the framework's white default.
  experimental: {
    globalNotFound: true,
  },
  turbopack: {
    resolveAlias: {
      "@spz-loader/core": SPZ_STUB,
    },
  },
  // The insight PNGs (lib/insights/render/raster.ts) are drawn by resvg's
  // WebAssembly build with the vendored Geist files as its only fonts. Both
  // are read from disk at run time, relative to the project root, so nothing
  // imports them and the file tracer would leave them out of the functions
  // that serve /insights/**. These are the paths raster.ts reads; keep the
  // two in step.
  outputFileTracingIncludes: {
    "/insights/**": ["./node_modules/@resvg/resvg-wasm/index_bg.wasm", "./lib/insights/render/fonts/*.ttf"],
    // /api/catalog?op=search embeds the query with the pinned potion-base-8M, read from
    // public/embed by lib/embed/loadNode.ts (the browser fetches the same files). About 8 MB.
    "/api/catalog": ["./public/embed/**"],
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@spz-loader/core": path.resolve(process.cwd(), SPZ_STUB),
    };
    return config;
  },
  async headers() {
    // Security headers. The Atlas pulls live data from many third-party feeds
    // (aircraft, ships, quakes, tiles), so connect/img allow any HTTPS host —
    // this still blocks the dangerous vectors: http downgrade, data: exfil,
    // plugins, framing, and cross-origin form/base hijack. script-src keeps
    // 'unsafe-inline' because the Next.js App Router emits inline bootstrap
    // scripts, and 'wasm-unsafe-eval' because Cesium instantiates WebAssembly
    // to draw the globe — without it the map never renders. That keyword
    // permits WebAssembly only; plain eval() and new Function() stay blocked.
    const csp = (frameAncestors: string) =>
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https:",
        "style-src 'self' 'unsafe-inline' https:",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        "connect-src 'self' https: wss:",
        "media-src 'self' blob: https:",
        "worker-src 'self' blob:",
        // The one frame the app embeds: NASA's ISS stream in YouTube's
        // privacy-enhanced player (components/hud/InfoPanel.tsx), shown only
        // after /api/space checks it through oEmbed.
        "frame-src 'self' https://www.youtube-nocookie.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        `frame-ancestors ${frameAncestors}`,
        "upgrade-insecure-requests",
      ].join("; ");
    // Voice control asks for the microphone on this origin, so `microphone`
    // is self rather than closed; everything else stays denied.
    const permissions =
      "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()";
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: permissions },
    ];
    // `?embed=1` is the documented iframe view (README shows the embed code),
    // so that one request may be framed; every other request may not. The two
    // rules are exact complements — `missing` matches whenever the `has` would
    // not — so a request always gets one of them and never both.
    const embedQuery = [{ type: "query" as const, key: "embed", value: "1" }];
    return [
      // The embedder's weights (public/embed/<model>-<commit8>/, lib/embed/pins.ts) carry their
      // pin in the path, and the loader checks each file's sha256, so they never change in place.
      // public/ defaults to max-age=0; these may be cached for good.
      {
        source: "/embed/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/:path*",
        missing: embedQuery,
        headers: [
          { key: "Content-Security-Policy", value: csp("'none'") },
          { key: "X-Frame-Options", value: "DENY" },
          ...common,
        ],
      },
      {
        source: "/:path*",
        has: embedQuery,
        // No X-Frame-Options here: it has no "any origin" value, and
        // frame-ancestors is the control browsers honour when both are set.
        headers: [{ key: "Content-Security-Policy", value: csp("https:") }, ...common],
      },
    ];
  }
};

export default nextConfig;
