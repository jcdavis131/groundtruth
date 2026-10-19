// Place-level aggregates of catalogued collections, committed as files and
// served as-is by /api/catalog?op=place-export: candidate towers for
// vector-places (docs/place-towers.md). Nothing here pulls upstream; each file
// is written by its script with its own provenance and completeness check.
//
//   npl-status             scripts/export-npl-county.mjs  -> lib/catalog/data/npl-county.json             series: value[place][year][feature]
//   ust-releases-county    scripts/export-ust-county.mjs  -> lib/catalog/data/ust-releases-county.json    static: value[place][feature]
//   ust-facilities-county  scripts/export-ust-county.mjs  -> lib/catalog/data/ust-facilities-county.json  static: value[place][feature]
//   fuds-properties        scripts/export-fuds-county.mjs -> lib/catalog/data/fuds-county.json            static: value[place][feature]

import npl from "./data/npl-county.json";
import ustReleases from "./data/ust-releases-county.json";
import ustFacilities from "./data/ust-facilities-county.json";
import fuds from "./data/fuds-county.json";
import { UST_FACILITY_NULLS, UST_RELEASE_NULLS } from "@/lib/permits/ust";

export const PLACE_EXPORTS = ["npl-status", "ust-releases-county", "ust-facilities-county", "fuds-properties"] as const;
export type PlaceExportId = (typeof PLACE_EXPORTS)[number];

/** series: value[place][year][feature] over meta.years. static: value[place][feature], one snapshot (meta.asOf), meta.years null. */
export const PLACE_EXPORT_FORM: Record<PlaceExportId, "series" | "static"> = {
  "npl-status": "series",
  "ust-releases-county": "static",
  "ust-facilities-county": "static",
  "fuds-properties": "static",
};

const NPL_CAVEATS = [
  "Counts of distinct NPL sites (EPA IDs) per county and year, from EPA's NPL list with status dates. Active means listed by December 31 and not deleted by then; it is a regulatory status, not a measure of contamination.",
  "Zero vs missing: a county not in `places` and not in `nullPlaces` has 0 for every feature (the NPL list is complete for the United States). A county in `nullPlaces` is null: a site could be in it but EPA's county string did not place it in one county (multi-county sites, Baltimore, St. Louis and Roanoke county-or-city). When a site's county name matches nothing, every county of its state is null: all of Connecticut (legacy counties) and all of Alaska (one \"Outer Ketchikan\" site).",
  "Counties are joined by name to TIGERweb ACS2023 (lib/places/data/counties.json); a point-in-county join is not done yet.",
];

const UST_CAVEATS = [
  "EPA UST Finder: a national composite of state tank records as of 2018-2021 (tribal records to October 2025). One static value per county, not a year series and not current status. A release is a reported leak; 'no further action' is the state's closure, not proof that no contamination remains. Counts depend on how each state reported.",
  "Zero vs missing: every county has a row, so nothing is 0 by absence. A 0 is the layer's own (meta.publishedZeros); the composite is only as complete as each state's records. A field the layer leaves null is null for that county and feature (`nullCells`), never 0; meta.counts.nullCellsByState says where, and meta.nullCellNote what the nulls most likely mean.",
  "Joined by state and county name (the layers carry no FIPS) and checked by each county's internal point. Connecticut's planning regions and Alaska's Chugach and Copper River have no row (UST Finder has the legacy counties and Valdez-Cordova) and are in `nullPlaces`. Population is not exported.",
];

const FUDS_CAVEATS = [
  "USACE's FUDS property inventory, fiscal year 2024 data (USACE calls it preliminary): one static snapshot. A property's listing is a program status, not a finding of contamination; 'with projects' means USACE has cleanup projects there, 'open' that not all are at site closeout.",
  "Zero vs missing: a county not in `places` and not in `nullPlaces` has 0, meaning no property USACE locates in this county (the inventory is complete). 265 in-scope properties (2.7%) have no county string and no point in a county: they are in no county's count, listed by state in meta.unlocated, and a 0 does not rule them out. The strict alternative, every county of their states null, has 0.405 coverage (meta.counts.strictRule, kept for reference). This zero rule was approved by Cam on 2026-10-16 (meta.zeroRuleStatus). A county in `nullPlaces` is null: an unplaced property could be in it (Connecticut's legacy county strings without a usable point, Baltimore county-or-city, Valdez-Cordova).",
  "Placed by USACE's county string; the point (in a TIGERweb ACS2023 500K outline) places a property when the string is blank, names no county, or could name more than one (a county-or-independent-city name such as ST LOUIS, FAIRFAX, RICHMOND or BALTIMORE, or a list) and the point is in one of them; otherwise the point is a check (meta.pointDisagreements, kept). The file carries property numbers, never coordinates, owners or names.",
];

const EXPORTS: Record<PlaceExportId, { data: unknown; caveats: string[] }> = {
  "npl-status": { data: withForm("npl-status", npl), caveats: NPL_CAVEATS },
  "ust-releases-county": { data: withForm("ust-releases-county", ustReleases), caveats: [...UST_CAVEATS, UST_RELEASE_NULLS] },
  "ust-facilities-county": { data: withForm("ust-facilities-county", ustFacilities), caveats: [...UST_CAVEATS, UST_FACILITY_NULLS] },
  "fuds-properties": { data: withForm("fuds-properties", fuds), caveats: FUDS_CAVEATS },
};

/**
 * The served payload always carries meta.form: an export whose file has none (npl-county.json, written
 * before the field existed) gets PLACE_EXPORT_FORM's; a file that has one keeps it (the test checks they agree).
 * A shallow copy, so the imported JSON module is never mutated.
 */
function withForm(id: PlaceExportId, d: { meta: object }): { meta: object } {
  return { ...d, meta: { form: PLACE_EXPORT_FORM[id], ...d.meta } };
}

/** One export's payload and caveats, or null for an unknown collection. */
export function placeExport(collection: string): { data: unknown; caveats: string[] } | null {
  return (PLACE_EXPORTS as readonly string[]).includes(collection) ? EXPORTS[collection as PlaceExportId] : null;
}
