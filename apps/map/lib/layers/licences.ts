// Layer: business licences. Licensed premises as five public registries
// publish them, as points, below LICENCES_MAX_M inside a dashed box of about
// 1.1 km: New York State liquor licences, Chicago business licences, San
// Francisco registered business locations, Los Angeles active businesses and
// New York City premises licences.
//
// Trade names, except one that is a non-company registrant's own name; a
// registrant's legal name is never shown unless it is a company's. A licence
// at an apartment or unit address is withheld (a home-business heuristic,
// counted in the note). Nothing searches a licensee or an address.

import type { FetchContext, FetchResult, LayerDefinition, ViewState } from "./types";
import { proxy } from "./aircraft";
import { civicLoadedBox, gridBox } from "./civicBox";
import { LICENCE_SOURCE_IDS, LICENCE_SOURCES, licenceSourcesInBox, type LicenceRecord } from "@/lib/permits/licences";
import { licenceFeature } from "@/lib/permits/dossier";
import type { RecordFeature } from "@/lib/permits/geojson";
import { coverageNote, type CoverageLike } from "@/lib/permits/notes";
import type { Bbox } from "@/lib/zoning/features";

export const LICENCES_MAX_M = 3_000;
const HALF_LAT = 0.005;
/** A new box every ~500 m of pan; the target stays at least 250 m inside the 1.1 km box. */
const KEY_GRID = 0.005;

export function licencesBox(v: Pick<ViewState, "lon" | "lat">): Bbox {
  return gridBox(v.lon, v.lat, HALF_LAT, KEY_GRID, 0.0025);
}

const covered = LICENCE_SOURCE_IDS.map((id) => LICENCE_SOURCES[id].name).join(", ");

async function fetchLicences(ctx: FetchContext): Promise<FetchResult> {
  if (ctx.view.height > LICENCES_MAX_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "business licence registries",
      fetchedAt: ctx.now,
      note: `descend below ${LICENCES_MAX_M / 1000} km for licensed premises · ${covered}`,
      meta: { count: 0 },
    };
  }
  const want = licencesBox(ctx.view);
  if (!licenceSourcesInBox(want).length) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "business licence registries",
      fetchedAt: ctx.now,
      note: `no licence registry wired here · covered: ${covered}`,
      meta: { count: 0 },
    };
  }
  const env = await proxy<{ features: Array<RecordFeature<LicenceRecord>> }>(`/api/permits?op=licences&bbox=${want.join(",")}`, ctx);
  const meta = env as unknown as { bbox?: Bbox; coverage?: CoverageLike[]; withheld?: number };
  const loaded: Bbox = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : want;
  const features = env.data.features.map(licenceFeature);
  const lead =
    `${features.length.toLocaleString("en-US")} licensed premises in the dashed box (outside it: not loaded)` +
    (meta.withheld ? ` · ${meta.withheld} withheld at apartment or unit addresses (a home-business heuristic)` : "");
  return {
    collection: { type: "FeatureCollection", features: [...features, civicLoadedBox("licences", loaded, "licensed premises")] },
    source: "business licence registries",
    fetchedAt: ctx.now,
    note: coverageNote(lead, meta.coverage ?? []),
    meta: { count: features.length },
  };
}

export const licencesLayer: LayerDefinition = {
  id: "licences",
  label: "Business licences",
  description:
    "Licensed premises as five registries publish them (New York State liquor licences, Chicago business licences, San Francisco registered businesses, Los Angeles active businesses, New York City premises licences), below 3 km inside a dashed box. Named by trade name, except a trade name that is a non-company registrant's own name; a registrant's legal name is never shown unless it is a company's, and licences at apartment or unit addresses are withheld as likely homes.",
  color: "#67E8F9",
  updateIntervalMs: 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: (v) => (v.height > LICENCES_MAX_M ? "above" : `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`),
  attribution: "NYS Liquor Authority, City of Chicago, City and County of San Francisco (PDDL), City of Los Angeles Office of Finance (CC0), NYC DCWP",
  fetch: fetchLicences,
};
