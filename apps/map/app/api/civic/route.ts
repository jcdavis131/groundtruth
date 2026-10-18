// Civic API: community indicators for counties and tracts, public schools, fixed
// broadband availability and housing assistance. CORS open, edge-cached, with the
// shared envelope (lib/server/respond.ts). Round 4 added health, round 5 svi and
// schools, round 6 broadband, round 7 housing; a later round adds ejscreen here.
//
//   /api/civic?op=health&level=county&measure=DIABETES
//        CDC PLACES (2025 release): every county's age-adjusted prevalence for one
//        measure, from one whole-measure pull, with its 95% CI and data year. Held a
//        week (the release is static until CDC's next). Join by `fips` onto county
//        outlines (Connecticut in planning regions 09110-09190).
//   /api/civic?op=health&level=tract&measure=DIABETES&counties=09110,09120
//        Crude prevalence for every published tract of at most 6 counties, by
//        countyfips (never a within_box query: a cold one took 19.6 s). Each county
//        held a week.
//   /api/civic?op=health&level=place&fips=48453
//        Every measure for one county, age-adjusted, for the click answer. Held a week.
//
//   /api/civic?op=svi&level=county
//        CDC/ATSDR SVI 2022: every county's overall and four theme percentiles and flag
//        count, attributes only (two pages of 2,000), held a week. Join by `fips` onto
//        county outlines (Connecticut in planning regions). -999 ("not ranked") is null.
//   /api/civic?op=svi&level=tract&bbox=w,s,e,n
//        SVI's own tract polygons in a box of at most 0.4 degrees (snapped to 0.05), at
//        most two pages, held a week per box.
//   /api/civic?op=svi&level=place&fips=48453 (or an 11-digit tract)
//        One county or tract with the 16 estimates and margins; 404 when CDC has no row.
//   /api/civic?op=schools&bbox=w,s,e,n
//        NCES EDGE public schools, school year 2024-25, in a box of at most 0.2 degrees
//        (the civic box; snapped to 0.05), held a day. Directory fields, enrollment, free
//        and reduced-price lunch, FTE and the student-teacher ratio as NCES publishes them;
//        no race, sex or grade-level enrollment cell is requested. Inactive and Future
//        schools are left out (counted). A negative is a CCD reporting code, never 0.
//   /api/civic?op=broadband&level=county
//        FCC Broadband Data Collection, December 2025, as Esri summarizes it (Esri Master
//        License Agreement): every county's location counts (total, served, underserved,
//        unserved, served by fiber, cable and licensed fixed wireless, providers, unserved
//        12 months earlier), attributes only (two pages of 2,000), as compact arrays, held
//        a week. Connecticut is published in its eight legacy counties, which no current
//        outline carries: counted in meta.unmatched, never crosswalked.
//   /api/civic?op=broadband&level=hex&bbox=w,s,e,n
//        BDC's own H3 resolution-8 hexagons in a box of at most 0.3 degrees (snapped to
//        0.05), one page of 2,000, held a week per box.
//   /api/civic?op=broadband&level=place&fips=48453
//        One county with every technology column and the 6- and 12-month-previous counts
//        as published, plus the shares as named ratios of two counts; 404 when BDC has no
//        row (Connecticut's planning regions among them).
//   /api/civic?op=housing&bbox=w,s,e,n
//        HUD's Housing Choice Vouchers by tract (GEOID, HCV_PUBLIC, HCV_PUBLIC_PCT) and its
//        Qualified Census Tracts titled 2026 (GEOID), each on its own 2020 tract polygons, in
//        a box of at most 0.3 degrees (snapped to 0.05), one page of 2,000 each, held a week
//        per box, as { hcv, qct }. A null HCV_PUBLIC is HUD's suppression (10 or fewer, or
//        none), never 0; every Connecticut tract is null, which is "not published".
//   /api/civic?op=housing&level=place&fips=48453002220
//        One tract (11 digits): its voucher row and whether it is in the QCT list.
//   /api/civic?op=housing&bbox=w,s,e,n&part=dda,lihtc   (either or both; round 8)
//        Adds HUD's Difficult Development Areas titled 2026 (ZCTA5, DDA_CODE, DDA_TYPE,
//        DDA_NAME) and HUD's LIHTC properties (an allow-list of 19 fields, never the owner or
//        contact block; where N_UNITS >= 5, so a project of fewer than five units never reaches
//        the server) in the same box, page and gate, as { dda, lihtc } beside { hcv, qct }.
//
// All through the civic gate (one request a second to data.cdc.gov, one every 500 ms
// to an ArcGIS organisation; a 429 or 503 closes it for ten minutes). A county or
// tract with no row is not published, never 0.

import type { NextRequest } from "next/server";
import { cached, DeadlineError } from "@/lib/server/cache";
import { jsonError } from "@/lib/server/upstream";
import { badRequest, notFound, ok, options, withCors } from "@/lib/server/respond";
import { preferIpv4 } from "@/lib/server/net";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { civicJson, gateOf, runRows } from "@/lib/civic/request";
import { arcgisRowsCapped } from "@/lib/server/arcgis";
import {
  BDC_ATTRIBUTION,
  BDC_COUNTY_LAYER,
  BDC_COUNTY_PAGES,
  BDC_FIELDS,
  BDC_HEX_LAYER,
  BDC_LICENCE,
  BDC_PAGE,
  BDC_PLACE_FIELDS,
  BDC_ROW_COLUMNS,
  BDC_VINTAGE_NOTE,
  BROADBAND_CAVEAT,
  BROADBAND_HEX_BOX_DEG,
  CT_LEGACY,
  PROVIDER_BREAKS,
  SHARE_BREAKS,
  bdcPlace,
  bdcRow,
  packBdcRow,
  type BdcRow,
} from "@/lib/civic/broadband";
import { parseBbox as gridBbox, type Bbox } from "@/lib/civic/bbox";
import {
  CT_HOUSING_NOTE,
  HCV_DENOMINATOR_QUOTE,
  HCV_FIELDS,
  HCV_LAYER,
  HCV_SUPPRESSION_QUOTE,
  HOUSING_ATTRIBUTION,
  HOUSING_BOX_DEG,
  HOUSING_CAVEAT,
  HOUSING_COUNT_BREAKS,
  HOUSING_GRID,
  HOUSING_PAGE,
  HOUSING_SHARE_BREAKS,
  housingBoxParams,
  housingPlace,
  housingPlaceParams,
  pickFields,
  QCT_FIELDS,
  QCT_LAYER,
  QCT_YEAR_NOTE,
} from "@/lib/civic/housing";
import { CT_TAX_CREDIT_NOTE, DDA_FIELDS, DDA_LAYER, DDA_YEAR_NOTE, HOUSING_TAX_CREDIT_CAVEAT, LIHTC_CODE_NOTE, LIHTC_FIELDS, LIHTC_LAYER, LIHTC_WHERE, parseHousingParts, type HousingPart } from "@/lib/civic/taxcredit";
import { buildSchools, NCES_MAX_PAGES, NCES_PAGE, NCES_SCHOOLS, SCHOOL_FIELDS, SCHOOLS_ATTRIBUTION, SCHOOLS_CAVEAT } from "@/lib/civic/schools";
import type { LayerFeature } from "@/lib/layers/types";
import {
  SVI_ATTRIBUTION,
  SVI_BREAKS,
  SVI_CAVEAT,
  SVI_COUNTY_FIELDS,
  SVI_COUNTY_LAYER,
  SVI_COUNTY_PAGES,
  SVI_PAGE,
  SVI_PLACE_FIELDS,
  SVI_THEMES,
  SVI_TRACT_BOX_DEG,
  SVI_TRACT_LAYER,
  SVI_TRACT_PAGES,
  SVI_VINTAGE_NOTE,
  sviPlace,
  sviRow,
  type SviRow,
} from "@/lib/civic/svi";
import {
  countyMeasureUrl,
  isPlacesMeasure,
  parsePlaces,
  PLACES_ATTRIBUTION,
  PLACES_CAVEAT,
  PLACES_MAX_COUNTIES,
  PLACES_MEASURES,
  placeUrl,
  quintiles,
  tractUrl,
  type PlacesMeasure,
} from "@/lib/civic/places";

export const maxDuration = 60;
export const OPTIONS = options;

preferIpv4();

const WEEK_MS = 7 * 24 * 3600_000;
const HEALTH_HELP =
  "op=health needs level=county&measure=<MEASUREID>, level=tract&measure=<MEASUREID>&counties=<up to 6 five-digit FIPS>, or level=place&fips=<five-digit FIPS>; measures: " +
  Object.keys(PLACES_MEASURES).join(", ");

const at = (age: number) => new Date(Date.now() - age).toISOString();

async function healthCounty(m: PlacesMeasure) {
  const url = countyMeasureUrl(m);
  const r = await cached(`places:county:${m}`, WEEK_MS, async () => parsePlaces(await civicJson<unknown>("cdc-places", url, 25_000), "county"));
  const meta = PLACES_MEASURES[m];
  return ok(
    { level: "county", measure: m, rows: r.value.map(({ fips, name, state, value, low, high, year, population }) => ({ fips, name, state, value, low, high, year, population })) },
    {
      meta: {
        source: PLACES_ATTRIBUTION,
        measure: { id: m, name: meta.name, short: meta.short, category: meta.category, year: meta.year },
        valueType: "age-adjusted prevalence, %",
        count: r.value.length,
        breaks: quintiles(r.value.map((v) => v.value)),
        cacheAge: r.age,
      },
      ttlS: 86_400,
      provenance: [provenance(source("cdc-places"), { kind: "published", seriesId: `swc5-untb (PLACES county, 2025 release), measureid=${m}, AgeAdjPrv`, upstreamUrl: url, retrievedAt: at(r.age) })],
      caveats: [PLACES_CAVEAT, "`breaks` are national quintiles of the published county values for this measure. A county with no row is not published, not 0."],
    },
  );
}

async function healthTract(m: PlacesMeasure, counties: string[]) {
  const parts = await Promise.all(
    counties.map((c) => cached(`places:tract:${m}:${c}`, WEEK_MS, async () => parsePlaces(await civicJson<unknown>("cdc-places", tractUrl(c, m), 25_000), "tract")).catch(() => null)),
  );
  if (parts.every((p) => p == null)) throw new Error("CDC PLACES did not answer for any county asked");
  const coverage = counties.map((c, i) => ({ county: c, state: parts[i] ? "covered" : "error", count: parts[i] ? parts[i]!.value.length : null }));
  const rows = parts.flatMap((p) => p?.value ?? []);
  const caveats = [PLACES_CAVEAT, "Crude prevalence, as CDC publishes tracts. A tract with no row is not published (small populations are withheld), not 0."];
  for (const c of coverage) if (c.state === "error") caveats.push(`CDC PLACES did not answer for county ${c.county} this time: its tracts are unknown, not missing.`);
  return ok(
    { level: "tract", measure: m, rows: rows.map(({ fips, state, value, low, high, year, population }) => ({ fips, state, value, low, high, year, population })) },
    {
      meta: { source: PLACES_ATTRIBUTION, measure: { id: m, ...PLACES_MEASURES[m] }, valueType: "crude prevalence, %", coverage, count: rows.length, cacheAge: Math.max(...parts.map((p) => p?.age ?? 0)) },
      ttlS: coverage.some((c) => c.state === "error") ? 600 : 86_400,
      provenance: [provenance(source("cdc-places"), { kind: "published", seriesId: `cwsq-ngmh (PLACES tract, 2025 release), measureid=${m}, CrdPrv, countyfips in (${counties.join(", ")})`, upstreamUrl: tractUrl(counties[0], m), retrievedAt: at(Math.max(...parts.map((p) => p?.age ?? 0))) })],
      caveats,
    },
  );
}

async function healthPlace(fips: string) {
  const url = placeUrl(fips);
  const r = await cached(`places:place:${fips}`, WEEK_MS, async () => parsePlaces(await civicJson<unknown>("cdc-places", url, 25_000), "county"), { deadlineMs: 25_000 });
  return ok(
    { level: "place", fips, values: r.value },
    {
      meta: { source: PLACES_ATTRIBUTION, count: r.value.length, cacheAge: r.age },
      ttlS: 86_400,
      provenance: [provenance(source("cdc-places"), { kind: "published", seriesId: `swc5-untb (PLACES county, 2025 release), locationid=${fips}, AgeAdjPrv`, upstreamUrl: url, retrievedAt: at(r.age) })],
      caveats: [PLACES_CAVEAT, "Measures this county has no row for are not published; the seven social-needs measures come from an optional survey module not every state fielded."],
    },
  );
}

// ---------------------------------------------------------------- svi (CDC/ATSDR SVI 2022)

const SVI_HELP = "op=svi needs level=county, level=tract&bbox=w,s,e,n (at most 0.4 degrees a side), or level=place&fips=<5-digit county or 11-digit tract FIPS>";
const SVI_CAVEATS = [SVI_CAVEAT, SVI_VINTAGE_NOTE];

const sviProv = (layer: string, seriesId: string, age: number, notes?: string[]) =>
  provenance(source("cdc-svi"), { kind: "published", seriesId, upstreamUrl: layer, period: "ACS 2018-2022 (SVI 2022)", retrievedAt: at(age), notes });

/** The compact county row the layer joins: percentiles in SVI_THEMES order, null where not ranked. */
const compactSvi = (r: SviRow) => ({ fips: r.fips, name: r.county, state: r.stAbbr, rpl: r.rpl, flags: r.flags });

async function sviCounty() {
  const r = await cached(
    "svi:county",
    WEEK_MS,
    async () => {
      const rows: SviRow[] = [];
      let cut = false;
      for (let page = 0; page < SVI_COUNTY_PAGES; page++) {
        const res = await runRows(
          "cdc-svi",
          { kind: "arcgis", layer: SVI_COUNTY_LAYER, params: { where: "1=1", outFields: SVI_COUNTY_FIELDS.join(","), returnGeometry: "false", orderByFields: "FIPS", resultRecordCount: String(SVI_PAGE), resultOffset: String(page * SVI_PAGE) } },
          25_000,
        );
        for (const f of res.features) {
          const row = sviRow(f.properties ?? {});
          if (row) rows.push(row);
        }
        cut = res.truncated;
        if (!cut) break;
      }
      return { rows, cut };
    },
    { deadlineMs: 45_000 },
  );
  const notRanked = r.value.rows.filter((x) => x.rpl[0] == null).length;
  const caveats = [...SVI_CAVEATS, "Counties come as attribute rows only: join them by `fips` onto your own county outlines (Connecticut in planning regions 09110-09190, as TIGER current is). A county with no row is not in this release (SVI US covers the states and DC), never 0."];
  if (r.value.cut) caveats.push(`CDC's answer was still cut at ${SVI_COUNTY_PAGES * SVI_PAGE} counties: some counties are missing from this answer, not unranked.`);
  return ok(
    { level: "county", themes: SVI_THEMES.map((t) => t.name), rows: r.value.rows.map(compactSvi) },
    {
      meta: { source: SVI_ATTRIBUTION, count: r.value.rows.length, notRanked, breaks: [...SVI_BREAKS], capped: r.value.cut, cacheAge: r.age },
      ttlS: 86_400,
      provenance: [sviProv(SVI_COUNTY_LAYER, "CDC_ATSDR_Social_Vulnerability_Index_2022_USA FeatureServer layer 1 (SVI2022 US county), attributes", r.age)],
      caveats,
    },
  );
}

async function sviTract(b: Bbox) {
  const r = await cached(
    `svi:tract:${b.join(",")}`,
    WEEK_MS,
    async () => {
      const features: Array<{ type: "Feature"; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }> = [];
      let cut = false;
      const [w, s, e, n] = b;
      for (let page = 0; page < SVI_TRACT_PAGES; page++) {
        const res = await runRows(
          "cdc-svi",
          {
            kind: "arcgis",
            layer: SVI_TRACT_LAYER,
            params: {
              where: "1=1",
              geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
              geometryType: "esriGeometryEnvelope",
              inSR: "4326",
              spatialRel: "esriSpatialRelIntersects",
              outSR: "4326",
              outFields: SVI_COUNTY_FIELDS.join(","),
              returnGeometry: "true",
              geometryPrecision: "5",
              maxAllowableOffset: "0.0005",
              orderByFields: "FIPS",
              resultRecordCount: String(SVI_PAGE),
              resultOffset: String(page * SVI_PAGE),
            },
          },
          25_000,
        );
        for (const f of res.features) features.push({ type: "Feature", geometry: f.geometry, properties: f.properties ?? {} });
        cut = res.truncated;
        if (!cut) break;
      }
      return { features, cut };
    },
    { deadlineMs: 45_000 },
  );
  const caveats = [...SVI_CAVEATS, "SVI's own tract polygons, simplified to 0.0005 degrees. A tract CDC does not rank carries -999 in every RPL_ field: not ranked, never least vulnerable."];
  if (r.value.cut) caveats.push(`CDC's answer for this box was still cut at ${SVI_TRACT_PAGES * SVI_PAGE} tracts: ask a smaller box for every tract.`);
  return ok(
    { type: "FeatureCollection", features: r.value.features },
    {
      meta: { source: SVI_ATTRIBUTION, level: "tract", bbox: b, count: r.value.features.length, capped: r.value.cut, breaks: [...SVI_BREAKS], cacheAge: r.age },
      ttlS: 86_400,
      provenance: [sviProv(SVI_TRACT_LAYER, "CDC_ATSDR_Social_Vulnerability_Index_2022_USA FeatureServer layer 2 (SVI2022 US tract), polygons simplified to 0.0005 degrees", r.age, [`bbox ${b.join(",")}`])],
      caveats,
    },
  );
}

async function sviPlaceOp(fips: string) {
  const layer = fips.length === 5 ? SVI_COUNTY_LAYER : SVI_TRACT_LAYER;
  const r = await cached(
    `svi:place:${fips}`,
    WEEK_MS,
    async () => {
      const res = await runRows("cdc-svi", { kind: "arcgis", layer, params: { where: `FIPS='${fips}'`, outFields: SVI_PLACE_FIELDS.join(","), returnGeometry: "false" } }, 20_000);
      const place = res.features.map((f) => sviPlace(f.properties ?? {})).find((p) => p != null) ?? null;
      return { place };
    },
    { deadlineMs: 25_000 },
  );
  if (!r.value.place) return notFound(`not in this release: CDC/ATSDR SVI 2022 has no row for FIPS ${fips} (SVI US covers the states and DC)`);
  return ok(
    { level: fips.length === 5 ? "county" : "tract", fips, ...r.value.place },
    {
      meta: { source: SVI_ATTRIBUTION, cacheAge: r.age },
      ttlS: 86_400,
      provenance: [sviProv(layer, `CDC_ATSDR_Social_Vulnerability_Index_2022_USA FeatureServer layer ${fips.length === 5 ? 1 : 2}, FIPS='${fips}'`, r.age)],
      caveats: [...SVI_CAVEATS, "Estimates (EP_) are percentages from ACS 2018-2022 with their margins of error (MP_) as CDC publishes them; null where CDC publishes none."],
    },
  );
}

// ---------------------------------------------------------------- schools (NCES EDGE 2024-25)

const DAY_MS = 24 * 3600_000;
const SCHOOLS_HELP = "op=schools needs bbox=w,s,e,n (at most 0.2 degrees a side around its centre), e.g. bbox=-97.8,30.2,-97.7,30.3";

async function schools(b: Bbox) {
  const r = await cached(
    `schools:${b.join(",")}`,
    DAY_MS,
    async () => {
      const [w, s, e, n] = b;
      const rows: Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }> = [];
      let cut = false;
      for (let page = 0; page < NCES_MAX_PAGES; page++) {
        const res = await runRows(
          "nces-edge-public",
          {
            kind: "arcgis",
            layer: NCES_SCHOOLS,
            params: {
              where: "1=1",
              geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
              geometryType: "esriGeometryEnvelope",
              inSR: "4326",
              spatialRel: "esriSpatialRelIntersects",
              outSR: "4326",
              outFields: SCHOOL_FIELDS.join(","),
              returnGeometry: "true",
              orderByFields: "NCESSCH",
              resultRecordCount: String(NCES_PAGE),
              resultOffset: String(page * NCES_PAGE),
            },
          },
          25_000,
        );
        rows.push(...res.features);
        cut = res.truncated;
        if (!cut) break;
      }
      const built = buildSchools(rows);
      return { features: built.features as LayerFeature[], hidden: built.hidden, cut };
    },
    { deadlineMs: 45_000 },
  );
  const caveats = [
    SCHOOLS_CAVEAT,
    "Directory and membership fields only: no race, sex or grade-level enrollment cell is requested. A negative value is one of CCD's reporting codes (-1 not reported, -2 not applicable, and others), shown as such, never as 0. The free or reduced-price lunch share is TOTFRL over TOTAL, two published counts.",
    "Schools NCES marks Inactive or Future are left out (`hidden`). School and district names and addresses are public institutions' as NCES publishes them.",
    "Only the returned `bbox` was loaded; outside it nothing is loaded, which is not the same as no school being there.",
  ];
  if (r.value.cut) caveats.push(`NCES's answer for this box was still cut at ${NCES_MAX_PAGES * NCES_PAGE} schools: ask a smaller box for every school.`);
  return ok(
    { type: "FeatureCollection", features: r.value.features },
    {
      meta: { source: SCHOOLS_ATTRIBUTION, bbox: b, count: r.value.features.length, hidden: r.value.hidden, truncated: r.value.cut, cacheAge: r.age },
      ttlS: 6 * 3600,
      provenance: [
        provenance(source("nces-edge-public"), {
          kind: "published",
          seriesId: "EDGE_ADMINDATA_PUBLICSCH_2425 MapServer layer 1 (Public School Administrative Data 2024-25)",
          upstreamUrl: NCES_SCHOOLS,
          period: "school year 2024-25",
          retrievedAt: at(r.age),
          notes: [`bbox ${b.join(",")}`],
        }),
      ],
      caveats,
    },
  );
}

// ---------------------------------------------------------------- broadband (FCC BDC, December 2025, via Esri)

const BROADBAND_HELP = "op=broadband needs level=county, level=hex&bbox=w,s,e,n (at most 0.3 degrees a side), or level=place&fips=<5-digit county FIPS>";
const BROADBAND_CAVEATS = [BROADBAND_CAVEAT, BDC_VINTAGE_NOTE];

const bdcProv = (layer: string, seriesId: string, age: number, notes?: string[]) =>
  provenance(source("fcc-bdc-esri"), { kind: "published", seriesId, upstreamUrl: layer, period: "BDC December 2025 filing", retrievedAt: at(age), notes: [BDC_LICENCE, ...(notes ?? [])] });

/** Attribute rows (f=json) through the ArcGIS organisation's gate (one request every 500 ms). */
function bdcAttributes(layer: string, params: Record<string, string>, timeoutMs = 25_000) {
  const { gate, minIntervalMs } = gateOf(layer);
  return arcgisRowsCapped<Record<string, unknown>>("fcc-bdc-esri", layer, { returnGeometry: "false", ...params }, { gate, minIntervalMs, timeoutMs, tries: 2 });
}

async function broadbandCounty() {
  const r = await cached(
    "broadband:county",
    WEEK_MS,
    async () => {
      const rows: BdcRow[] = [];
      let cut = false;
      for (let page = 0; page < BDC_COUNTY_PAGES; page++) {
        const j = await bdcAttributes(BDC_COUNTY_LAYER, { where: "1=1", outFields: BDC_FIELDS.join(","), orderByFields: "GEOID", resultRecordCount: String(BDC_PAGE), resultOffset: String(page * BDC_PAGE) });
        for (const a of j.rows) {
          const row = bdcRow(a);
          if (row) rows.push(row);
        }
        cut = j.exceeded;
        if (!cut) break;
      }
      return { rows, cut };
    },
    { deadlineMs: 45_000 },
  );
  const ctLegacy = r.value.rows.filter((x) => CT_LEGACY.test(x.geoid)).map((x) => x.geoid);
  const caveats = [
    ...BROADBAND_CAVEATS,
    "Counties come as attribute rows only, one array per county in the order of `columns`: join them by `geoid` onto your own county outlines. A county with no row is not in this release, never 0. A share is a ratio of two published counts (e.g. unserved / total); a county with no locations has no share.",
  ];
  if (ctLegacy.length) caveats.push(`Connecticut is published in its ${ctLegacy.length} legacy counties (${ctLegacy.join(", ")}), which current Census outlines no longer carry (planning regions 09110-09190): they are listed in meta.unmatched and are not crosswalked.`);
  if (r.value.cut) caveats.push(`The answer was still cut at ${BDC_COUNTY_PAGES * BDC_PAGE} counties: some counties are missing from this answer, not unserved.`);
  return ok(
    { level: "county", columns: [...BDC_ROW_COLUMNS], rows: r.value.rows.map(packBdcRow) },
    {
      meta: { source: BDC_ATTRIBUTION, count: r.value.rows.length, unmatched: ctLegacy, shareBreaks: [...SHARE_BREAKS], providerBreaks: [...PROVIDER_BREAKS], capped: r.value.cut, cacheAge: r.age },
      ttlS: 86_400,
      provenance: [bdcProv(BDC_COUNTY_LAYER, "FCC_Broadband_Data_Collection_December_2024_View FeatureServer layer 1 (Counties), attributes", r.age)],
      caveats,
    },
  );
}

async function broadbandHex(b: Bbox) {
  const r = await cached(
    `broadband:hex:${b.join(",")}`,
    WEEK_MS,
    async () => {
      const [w, s, e, n] = b;
      const res = await runRows(
        "fcc-bdc-esri",
        {
          kind: "arcgis",
          layer: BDC_HEX_LAYER,
          params: {
            where: "1=1",
            geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
            geometryType: "esriGeometryEnvelope",
            inSR: "4326",
            spatialRel: "esriSpatialRelIntersects",
            outSR: "4326",
            outFields: BDC_FIELDS.join(","),
            returnGeometry: "true",
            geometryPrecision: "5",
            resultRecordCount: String(BDC_PAGE),
          },
        },
        25_000,
      );
      return { features: res.features.map((f) => ({ type: "Feature" as const, geometry: f.geometry, properties: f.properties ?? {} })), cut: res.truncated };
    },
    { deadlineMs: 30_000 },
  );
  const caveats = [
    ...BROADBAND_CAVEATS,
    "BDC's own H3 resolution-8 hexagons (about 0.7 km2 each), counts as published. About a quarter of hexagons hold a single location, so a hexagon can describe one home's availability as the FCC publishes it; no address or subscriber is in the data.",
  ];
  if (r.value.cut) caveats.push(`The answer for this box was cut at ${BDC_PAGE} hexagons: ask a smaller box for every hexagon.`);
  return ok(
    { type: "FeatureCollection", features: r.value.features },
    {
      meta: { source: BDC_ATTRIBUTION, level: "hex", bbox: b, count: r.value.features.length, capped: r.value.cut, shareBreaks: [...SHARE_BREAKS], providerBreaks: [...PROVIDER_BREAKS], cacheAge: r.age },
      ttlS: 86_400,
      provenance: [bdcProv(BDC_HEX_LAYER, "FCC_Broadband_Data_Collection_December_2024_View FeatureServer layer 5 (H3 Resolution 8)", r.age, [`bbox ${b.join(",")}`])],
      caveats,
    },
  );
}

async function broadbandPlace(fips: string) {
  const r = await cached(
    `broadband:place:${fips}`,
    WEEK_MS,
    async () => {
      const j = await bdcAttributes(BDC_COUNTY_LAYER, { where: `GEOID='${fips}'`, outFields: BDC_PLACE_FIELDS.join(",") }, 20_000);
      return { place: j.rows.map((a) => bdcPlace(a)).find((p) => p != null) ?? null };
    },
    { deadlineMs: 25_000 },
  );
  if (!r.value.place) {
    const ct = /^091[1-9]0$/.test(fips) ? " (Connecticut is published in its legacy counties, 09001-09015)" : "";
    return notFound(`not in this release: the FCC BDC county layer (December 2025, via Esri) has no row for FIPS ${fips}${ct}`);
  }
  return ok(
    { level: "county", fips, ...r.value.place },
    {
      meta: { source: BDC_ATTRIBUTION, cacheAge: r.age },
      ttlS: 86_400,
      provenance: [bdcProv(BDC_COUNTY_LAYER, `FCC_Broadband_Data_Collection_December_2024_View FeatureServer layer 1, GEOID='${fips}'`, r.age)],
      caveats: [
        ...BROADBAND_CAVEATS,
        "Counts are Broadband Serviceable Locations as published. Each share is the named count divided by TotalBSLs (formula given), a ratio of two published counts; null where there are no locations. Previous counts are Esri's 6- and 12-month-previous columns as published, not a series.",
      ],
    },
  );
}

// ---------------------------------------------------------------- housing (HUD vouchers by tract, QCT titled 2026)

const HOUSING_HELP = "op=housing needs bbox=w,s,e,n (at most 0.3 degrees a side), optionally part=dda,lihtc (either or both), or level=place&fips=<11-digit tract GEOID>";
const HOUSING_CAVEATS = [HOUSING_CAVEAT, QCT_YEAR_NOTE, CT_HOUSING_NOTE];

const hudProv = (layer: string, seriesId: string, period: string, age: number, notes?: string[]) =>
  provenance(source("hud-egis"), { kind: "published", seriesId, upstreamUrl: layer, period, retrievedAt: at(age), notes });

/** Each round-8 part's deadline, and the vouchers and QCT answer's: they run at once (housingBox). */
const HOUSING_PART_DEADLINE_S = 35;

/** One round-8 part in a box (DDA outlines or LIHTC points), held a week per box, allow-listed fields only. */
async function housingPartBox(b: Bbox, part: HousingPart) {
  const layer = part === "dda" ? DDA_LAYER : LIHTC_LAYER;
  const fields = part === "dda" ? DDA_FIELDS : LIHTC_FIELDS;
  const params = housingBoxParams(b, fields);
  if (part === "lihtc") params.where = LIHTC_WHERE;
  return cached(
    `housing:${part}:bbox:${b.join(",")}`,
    WEEK_MS,
    async () => {
      const res = await runRows("hud-egis", { kind: "arcgis", layer, params }, 25_000);
      return { fc: pickFields(res.features, fields), cut: res.truncated || res.features.length >= HOUSING_PAGE };
    },
    { deadlineMs: HOUSING_PART_DEADLINE_S * 1000 },
  );
}

async function housingBox(b: Bbox, parts: HousingPart[] = []) {
  // The parts and the vouchers/QCT answer are asked at once, each under its own 35 s deadline,
  // so a box with parts waits about 35 s at worst (plus HUD's 500 ms gate), not 35 s twice,
  // inside maxDuration 60. A part that misses its deadline is null with a caveat, never 0.
  const partsP = Promise.allSettled(parts.map((p) => housingPartBox(b, p)));
  const mainP = cached(
    `housing:bbox:${b.join(",")}`,
    WEEK_MS,
    async () => {
      const [hcv, qct] = await Promise.all([
        runRows("hud-egis", { kind: "arcgis", layer: HCV_LAYER, params: housingBoxParams(b, HCV_FIELDS) }, 25_000),
        runRows("hud-egis", { kind: "arcgis", layer: QCT_LAYER, params: housingBoxParams(b, QCT_FIELDS) }, 25_000),
      ]);
      return {
        hcv: pickFields(hcv.features, HCV_FIELDS),
        qct: pickFields(qct.features, QCT_FIELDS),
        hcvCut: hcv.truncated || hcv.features.length >= HOUSING_PAGE,
        qctCut: qct.truncated || qct.features.length >= HOUSING_PAGE,
      };
    },
    { deadlineMs: HOUSING_PART_DEADLINE_S * 1000 },
  );
  const [r, extra] = await Promise.all([mainP, partsP]);
  const v = r.value;
  const suppressed = v.hcv.filter((f) => f.properties.HCV_PUBLIC == null && !String(f.properties.GEOID ?? "").startsWith("09")).length;
  const ct = v.hcv.filter((f) => String(f.properties.GEOID ?? "").startsWith("09")).length;
  const caveats = [...HOUSING_CAVEATS, `HUD: "${HCV_SUPPRESSION_QUOTE}"; "${HCV_DENOMINATOR_QUOTE}".`];
  if (v.hcvCut) caveats.push(`The voucher answer for this box was cut at ${HOUSING_PAGE} tracts: ask a smaller box for every tract.`);
  if (v.qctCut) caveats.push(`The QCT answer for this box was cut at ${HOUSING_PAGE} tracts: ask a smaller box for every tract.`);
  const partData: Record<string, unknown> = {};
  const partMeta: Record<string, unknown> = {};
  const partProv: ReturnType<typeof hudProv>[] = [];
  let partCut = false;
  let partLate = false;
  parts.forEach((p, i) => {
    const settled = extra[i];
    if (settled.status === "rejected") {
      if (!(settled.reason instanceof DeadlineError)) throw settled.reason;
      partLate = true;
      partData[p] = null;
      partMeta[`${p}Count`] = null;
      caveats.push(`The ${p === "dda" ? "DDA" : "LIHTC"} answer did not arrive within ${HOUSING_PART_DEADLINE_S} s, so ${p} is null (unknown), not 0 and not empty: ask again.`);
      return;
    }
    const x = settled.value;
    partData[p] = { type: "FeatureCollection", features: x.value.fc };
    partMeta[`${p}Count`] = x.value.fc.length;
    if (x.value.cut) {
      partCut = true;
      caveats.push(`The ${p === "dda" ? "DDA" : "LIHTC"} answer for this box was cut at ${HOUSING_PAGE}: ask a smaller box for every ${p === "dda" ? "area" : "property"}.`);
    }
    partProv.push(
      p === "dda"
        ? hudProv(DDA_LAYER, "Difficult_Development_Areas_2026 FeatureServer layer 0, areas in the box", "titled 2026 by HUD", x.age, [`bbox ${b.join(",")}`])
        : hudProv(LIHTC_LAYER, `LIHTC FeatureServer layer 0 (Low_Income_Housing_Tax_Credit_Properties), ${LIHTC_WHERE}, properties in the box`, "allocated through 2021, placed in service through 2022 (data edited 2024-12-09)", x.age, [`bbox ${b.join(",")}`]),
    );
  });
  if (parts.length) caveats.push(HOUSING_TAX_CREDIT_CAVEAT, ...(parts.includes("dda") ? [DDA_YEAR_NOTE] : []), ...(parts.includes("lihtc") ? [LIHTC_CODE_NOTE] : []), CT_TAX_CREDIT_NOTE);
  return ok(
    { hcv: { type: "FeatureCollection", features: v.hcv }, qct: { type: "FeatureCollection", features: v.qct }, ...partData },
    {
      meta: { source: HOUSING_ATTRIBUTION, bbox: b, count: v.hcv.length, qctCount: v.qct.length, suppressed, connecticutNotPublished: ct, capped: v.hcvCut || v.qctCut || partCut, shareBreaks: [...HOUSING_SHARE_BREAKS], countBreaks: [...HOUSING_COUNT_BREAKS], parts, ...partMeta, cacheAge: r.age },
      // A late part is never held at the edge: the next ask may get it.
      ttlS: partLate ? 0 : 86_400,
      provenance: [
        hudProv(HCV_LAYER, "Housing_Choice_Vouchers_by_Tract FeatureServer layer 0, tracts in the box", "through 12/2025 (last updated 01/2026)", r.age, [`bbox ${b.join(",")}`]),
        hudProv(QCT_LAYER, "QUALIFIED_CENSUS_TRACTS_2026 FeatureServer layer 0, tracts in the box", "titled 2026 by HUD", r.age, [`bbox ${b.join(",")}`]),
        ...partProv,
      ],
      caveats,
    },
  );
}

/** Attribute rows (f=json) through HUD's ArcGIS organisation gate (one request every 500 ms). */
function hudAttributes(layer: string, params: Record<string, string>, timeoutMs = 20_000) {
  const { gate, minIntervalMs } = gateOf(layer);
  return arcgisRowsCapped<Record<string, unknown>>("hud-egis", layer, params, { gate, minIntervalMs, timeoutMs, tries: 2 });
}

async function housingPlaceOp(geoid: string) {
  const r = await cached(
    `housing:place:${geoid}`,
    WEEK_MS,
    async () => {
      const [h, q] = await Promise.all([hudAttributes(HCV_LAYER, housingPlaceParams(geoid, HCV_FIELDS)), hudAttributes(QCT_LAYER, housingPlaceParams(geoid, QCT_FIELDS))]);
      return housingPlace(geoid, h.rows, q.rows);
    },
    { deadlineMs: 25_000 },
  );
  const p = r.value;
  if (p.status === "not-in-layer" && p.qct === null) return notFound(`no voucher row for tract ${geoid}; QCT membership is unknown for a Connecticut legacy-county code (HUD's QCT list uses planning-region codes)`);
  if (p.status === "not-in-layer" && !p.qct) return notFound(`not in either HUD layer: no voucher row and no QCT row for tract ${geoid}`);
  return ok(
    { level: "tract", ...p },
    {
      meta: { source: HOUSING_ATTRIBUTION, cacheAge: r.age },
      ttlS: 86_400,
      provenance: [
        hudProv(HCV_LAYER, `Housing_Choice_Vouchers_by_Tract FeatureServer layer 0, GEOID='${geoid}', attributes`, "through 12/2025 (last updated 01/2026)", r.age),
        hudProv(QCT_LAYER, `QUALIFIED_CENSUS_TRACTS_2026 FeatureServer layer 0, GEOID='${geoid}'`, "titled 2026 by HUD", r.age),
      ],
      caveats: [...HOUSING_CAVEATS, "vouchers null with status 'suppressed' means 10 or fewer, or none (HUD omits them); 'not-published-ct' means HUD publishes no Connecticut count; share is HUD's HCV_PUBLIC_PCT rounded to one decimal; qct null means unknown: a Connecticut legacy-county tract code, which HUD's QCT list (in planning-region codes) never uses."],
    },
  );
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "health": {
        const level = q.get("level") ?? "county";
        if (level === "place") {
          const fips = q.get("fips") ?? "";
          if (!/^\d{5}$/.test(fips)) return badRequest(HEALTH_HELP);
          return await healthPlace(fips);
        }
        const m = q.get("measure");
        if (!isPlacesMeasure(m)) return badRequest(HEALTH_HELP);
        if (level === "county") return await healthCounty(m);
        if (level === "tract") {
          const counties = [...new Set((q.get("counties") ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
          if (!counties.length || counties.length > PLACES_MAX_COUNTIES || !counties.every((c) => /^\d{5}$/.test(c))) return badRequest(HEALTH_HELP);
          return await healthTract(m, counties.sort());
        }
        return badRequest(HEALTH_HELP);
      }
      case "svi": {
        const level = q.get("level") ?? "county";
        if (level === "county") return await sviCounty();
        if (level === "tract") {
          const b = gridBbox(q.get("bbox"), SVI_TRACT_BOX_DEG, 0.05);
          return b ? await sviTract(b) : badRequest(SVI_HELP);
        }
        if (level === "place") {
          const fips = q.get("fips") ?? "";
          return /^(\d{5}|\d{11})$/.test(fips) ? await sviPlaceOp(fips) : badRequest(SVI_HELP);
        }
        return badRequest(SVI_HELP);
      }
      case "schools": {
        const b = gridBbox(q.get("bbox"), 0.2, 0.05);
        return b ? await schools(b) : badRequest(SCHOOLS_HELP);
      }
      case "broadband": {
        const level = q.get("level") ?? "county";
        if (level === "county") return await broadbandCounty();
        if (level === "hex") {
          const b = gridBbox(q.get("bbox"), BROADBAND_HEX_BOX_DEG, 0.05);
          return b ? await broadbandHex(b) : badRequest(BROADBAND_HELP);
        }
        if (level === "place") {
          const fips = q.get("fips") ?? "";
          return /^\d{5}$/.test(fips) ? await broadbandPlace(fips) : badRequest(BROADBAND_HELP);
        }
        return badRequest(BROADBAND_HELP);
      }
      case "housing": {
        const level = q.get("level");
        if (level === "place") {
          const fips = q.get("fips") ?? "";
          return /^\d{11}$/.test(fips) ? await housingPlaceOp(fips) : badRequest(HOUSING_HELP);
        }
        if (level != null) return badRequest(HOUSING_HELP);
        const parts = parseHousingParts(q.get("part"));
        if (parts === "bad") return badRequest(HOUSING_HELP);
        const b = gridBbox(q.get("bbox"), HOUSING_BOX_DEG, HOUSING_GRID);
        return b ? await housingBox(b, parts ?? []) : badRequest(HOUSING_HELP);
      }
      default:
        return badRequest("unknown op: health | svi | schools | broadband | housing");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
