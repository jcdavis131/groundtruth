// Layer: Wikipedia. Geotagged articles within 10 km of the camera target,
// from the MediaWiki geosearch API (keyless), with a short extract and the
// article link on each pin.
//
// The articles are shown as written today: Wikipedia is a living text, so
// the time machine does not rewind this layer. Dated history lives in the
// sibling layer, On this day (lib/layers/wikiday.ts).

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import type { WikiArticle } from "@/lib/wiki/types";

/** First `max` characters of a text, with an ellipsis when it was cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function formatDistance(distM: number): string {
  if (distM < 1000) return `${Math.round(distM)} m`;
  return `${(distM / 1000).toFixed(1)} km`;
}

export function wikiArticlesToFeatures(articles: WikiArticle[]): LayerFeature<Point>[] {
  const features: LayerFeature<Point>[] = [];
  for (const a of articles) {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !a.title) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lon, a.lat, 0] },
      properties: {
        id: `wp-${a.pageid}`,
        layer: "wikipedia",
        name: a.title,
        kind: "article",
        altitude: 0,
        source: "Wikipedia",
        details: {
          extract: a.extract ? truncate(a.extract, 320) : null,
          distance: a.distM != null && Number.isFinite(a.distM) ? formatDistance(a.distM) : null,
          "wikipedia page": a.url,
        },
      },
    });
  }
  return features;
}

async function fetchWikipedia(ctx: FetchContext): Promise<FetchResult> {
  const limit = ctx.view.height < 100_000 ? 50 : ctx.view.height < 1_000_000 ? 75 : 100;
  const env = await proxy<WikiArticle[]>(
    `/api/wikipedia?lat=${ctx.view.lat}&lon=${ctx.view.lon}&radius=10000&limit=${limit}`,
    ctx,
  );
  const features = wikiArticlesToFeatures(env.data ?? []);
  let note = `${features.length} articles within 10 km of the camera target`;
  if (ctx.playbackYear != null) note += ` · shown as written today; Wikipedia is not rewound to ${ctx.playbackYear}`;
  return {
    collection: { type: "FeatureCollection", features },
    source: env.source,
    fetchedAt: Date.now(),
    note,
  };
}

export const wikipediaLayer: LayerDefinition = {
  id: "wikipedia",
  label: "Wikipedia",
  description:
    "Geotagged Wikipedia articles within 10 km of the camera target, with extracts and links. The articles are shown as written today — the time machine does not rewind this layer (see On this day for dated history).",
  color: "#EDE9E3",
  updateIntervalMs: 300_000,
  defaultEnabled: false,
  viewDependent: true,
  attribution: "Wikipedia (CC BY-SA)",
  fetch: fetchWikipedia,
};
