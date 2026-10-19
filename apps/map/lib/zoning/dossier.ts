// A zoning answer at a clicked point as a globe feature, for the dossier.
// Pure, so what the panel says for each state is tested without a globe.

import type { LayerFeature } from "@/lib/layers/types";
import type { ZoningRecord, ZoningState } from "./features";

export const ZONING_POINT_KIND = "zoning-point";

/** Plain words for each state, as the dossier's first line. */
export const STATE_WORDS: Record<ZoningState, string> = {
  district: "zoning district",
  "right-of-way": "street right-of-way (the city's map leaves it unzoned)",
  "no-district": "no district polygon at this point (a street, water or a gap; not \"unzoned\")",
  "no-ordinance": "no zoning ordinance",
  "not-covered": "not covered: no zoning source wired here",
};

export function zoningPointId(lon: number, lat: number): string {
  return `zoning:point:${lat.toFixed(5)},${lon.toFixed(5)}`;
}

function title(r: ZoningRecord): string {
  const where = r.cityName ?? r.place?.name ?? "outside any incorporated place";
  switch (r.state) {
    case "district":
      return `${r.code} · ${where}`;
    case "right-of-way":
      return `Right-of-way · ${where}`;
    case "no-district":
      return `No district polygon · ${where}`;
    case "no-ordinance":
      return `No zoning ordinance · ${where}`;
    case "not-covered":
      return `Zoning not covered · ${where}`;
  }
}

/**
 * The feature the dossier shows. Keys are chosen so the palette never
 * searches the ordinance or the city's prose: "zoning" (the district code) is
 * on the search allowlist, the rest are not (lib/search/allowlist.ts).
 */
export function zoningPointFeature(r: ZoningRecord, fetchedAt: number): LayerFeature {
  const d: NonNullable<LayerFeature["properties"]["details"]> = {
    answer: STATE_WORDS[r.state],
    zoning: r.code,
    description: r.label,
    "category (city's words)": r.category && r.category !== r.label ? r.category : undefined,
    overlays: r.overlays.length ? r.overlays.join("; ") : undefined,
    "also at this point": r.alsoHere?.length ? r.alsoHere.join(", ") : undefined,
    ordinance: r.ordinance,
    effective: r.effective,
    "zoning case": r.caseNumber,
    "last edited": r.editedAt,
    "tax lot (BBL)": r.lot?.bbl,
  };
  for (const [k, v] of Object.entries(r.published)) d[k] = v;
  d["code (city link)"] = r.codeUrl;
  d["ordinance record"] = r.recordUrl;
  d.city = r.cityName;
  d.publisher = r.publisher;
  d["Census place"] = r.place ? `${r.place.name} (${r.place.geoid})` : "none (unincorporated)";
  d.note = r.note;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lon, r.lat] },
    properties: {
      id: zoningPointId(r.lon, r.lat),
      layer: "zoning",
      name: title(r),
      kind: ZONING_POINT_KIND,
      source: r.publisher ? `${r.publisher} zoning` : "Census TIGERweb (place only)",
      observedAt: fetchedAt,
      details: d,
      extra: { state: r.state, city: r.city, family: r.family },
    },
  };
}

/** What the dossier shows when the lookup itself failed: said, not hidden. */
export function zoningErrorFeature(lon: number, lat: number, message: string, fetchedAt: number): LayerFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      id: zoningPointId(lon, lat),
      layer: "zoning",
      name: "Zoning lookup failed",
      kind: ZONING_POINT_KIND,
      source: "this app",
      observedAt: fetchedAt,
      details: {
        answer: "the zoning service did not answer; nothing is known about this point",
        error: message.slice(0, 160),
      },
      extra: { state: "error" },
    },
  };
}
