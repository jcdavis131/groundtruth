// Layer: top US employers. Where the largest employers are headquartered,
// ranked by headcount.
//
//   Forbes         Global 2000 2025 + America's Top Private Companies 2025
//   DBpedia        Wikipedia infoboxes (HQ country = US)
//   Wikidata       SEC-ticker-matched entities with P1128 (employees)
//   OSM Nominatim  HQ city -> ZIP + coordinates
//
// Bundled as lib/companies/data/employers_ranked.json by
// scripts/employers-build.py. Headcounts are organization-wide as reported,
// not US-only. Selecting an employer opens the compensation dossier via
// /api/employers (op=equity&ticker= serves the RSU/vesting dossier, pilot batch).

import type { Point, FeatureCollection } from "geojson";
import type { BaseProps, FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";

/** Above this camera height the layer shows nothing and says why. */
export const EMPLOYERS_MAX_HEIGHT_M = 3_000_000;

interface Env {
  data: FeatureCollection<Point, BaseProps>;
  count?: number;
}

async function fetchEmployers(ctx: FetchContext): Promise<FetchResult> {
  const h = ctx.view.height;
  if (h > EMPLOYERS_MAX_HEIGHT_M) {
    return { collection: { type: "FeatureCollection", features: [] }, source: "Forbes / DBpedia / Wikidata", fetchedAt: ctx.now, note: "descend below 3,000 km for employer headquarters" };
  }
  const env = await proxy<Env["data"]>(`/api/employers?op=placed`, ctx);
  const e = env as unknown as Env;
  let features = e.data.features as LayerFeature<Point>[];

  // If a bbox is in view, filter to it (the placed endpoint returns all)
  if (ctx.view.bbox) {
    const [w, s, ee, n] = ctx.view.bbox;
    features = features.filter((f) => {
      const [lon, lat] = f.geometry.coordinates;
      return lon >= w && lon <= ee && lat >= s && lat <= n;
    });
  }

  // Tag the layer id on each feature for InfoPanel
  for (const f of features) {
    f.properties.layer = "employers";
  }

  const notes: string[] = [`${features.length} employer HQs in view`];
  notes.push("ranked by headcount; org-wide totals per source");
  return {
    collection: { type: "FeatureCollection", features },
    source: "Forbes / DBpedia / Wikidata",
    fetchedAt: ctx.now,
    note: notes.join(" · "),
    meta: { count: features.length },
  };
}

export const employersLayer: LayerDefinition = {
  id: "employers",
  label: "Top employers",
  description:
    "Largest US employers at their headquarters city, ranked by headcount (organization-wide per Forbes, Wikipedia, Wikidata), with ZIP, metro, and a compensation dossier on selection. Headcounts are not US-only.",
  color: "#FFB84D",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  attribution: "Forbes · DBpedia (Wikipedia) · Wikidata · OpenStreetMap Nominatim",
  fetch: fetchEmployers,
};
