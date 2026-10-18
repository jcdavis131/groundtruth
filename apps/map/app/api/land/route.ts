// Land API: flood zones, wetlands, public & protected lands and the ground
// elevation at a point, over keyless federal services. CORS open and
// edge-cached like /api/water, with the shared envelope (lib/server/respond.ts).
//
// FEMA NFHL appears twice in this app: /api/fabric?op=place identifies the one
// flood zone a point is in (with its NFIP community and FIRM panel); op=flood
// here draws the zones around the view. Same service, same politeness gate
// ("fema-nfhl"), same source id.
//
//   /api/land?op=flood&bbox=w,s,e,n        FEMA NFHL layer 28 (flood hazard zones), a
//                                          regulatory map, not a forecast. Box at most
//                                          ~9 km, snapped to a 0.02 degree grid.
//   /api/land?op=wetlands&bbox=w,s,e,n     USFWS National Wetlands Inventory polygons with
//                                          their Cowardin names (decoded locally from each
//                                          code) and the year of the imagery each was mapped
//                                          from (NWI Data_Source). Same box rules; NWI answers
//                                          at most 500 polygons a query.
//   /api/land?op=heritage&kind=units|nha|battlefields|whs[&bbox=w,s,e,n]
//                                         National heritage from four NPS services:
//                                         park units (boundaries in a box of at most 2
//                                         degrees, or every unit's centroid without a
//                                         box), National Heritage Areas and World
//                                         Heritage Sites (one national answer each), and
//                                         ABPP battlefield study and core areas of three
//                                         wars (a box of at most 8 degrees). Held a day
//                                         (boxes) or a week (national answers).
//   /api/land?op=historic&bbox=w,s,e,n[&polygons=1][&nhl=1]
//                                          National Register of Historic Places listings NPS
//                                          publishes as non-restricted: points, and with
//                                          polygons=1 boundaries too. Box at most 0.12
//                                          degrees, snapped to 0.02; 2,000 per layer at most.
//                                          Never an address, and never a listing whose
//                                          Address NPS marks restricted (some boundaries
//                                          carry one); archaeological sites withheld under
//                                          NHPA s.304 / ARPA are not in the source.
//   /api/land?op=crithab&lon=..&lat=..     USFWS designated critical habitat (final and
//                                          proposed) containing a point: species, listing
//                                          status, Federal Register rule and date; and NOAA
//                                          Fisheries critical habitat for marine and
//                                          anadromous species (polygons at the point, river
//                                          lines within about 200 m). Regulatory polygons
//                                          only; no occurrence data of any kind.
//   /api/land?op=publiclands&bbox=w,s,e,n  USGS PAD-US 4.1 fee, easement, designation and
//                                          proclamation areas with manager, owner agency,
//                                          local owner, easement holder, public access and
//                                          GAP status. Box at most 2 degrees, snapped to
//                                          0.25; a box taller than 1.5 degrees keeps the
//                                          largest PADUS_WIDE_MAX units, coarser.
//   /api/land?op=elevation&lon=..&lat=..   USGS 3DEP ground elevation (EPQS) with the
//                                          source DEM resolution.
//   /api/land?op=tribal                    BIA's AIAN Land Area Representation: every land
//                                          area held in trust or restricted fee (335 on
//                                          2026-10-17) in one national answer, simplified
//                                          to 0.01 degrees, held a day. Parts under 0.7 km2
//                                          (allotment-sized) are dropped, except each land
//                                          area's largest part, which is drawn whatever its
//                                          size; both counts are in the caveat.
//                                          No bbox and no detail level (held for Cam).
//
// FEMA resets a fair share of connections, so every ArcGIS call retries (see
// lib/server/arcgis.ts). These maps change on the scale of months, so each
// snapped box is cached for a day and the edge holds it for an hour.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { arcgisLayerInfo, arcgisQuery, arcgisRows, codedDomains, envelope, truncated } from "@/lib/server/arcgis";
import { jsonError, polite, upstream } from "@/lib/server/upstream";
import { badRequest, ok, options, withCors } from "@/lib/server/respond";
import { preferIpv4, retrying } from "@/lib/server/net";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { numParam, parseBbox, type Bbox } from "@/lib/civic/bbox";
import {
  BIA_LAR_LAYER,
  buildTribal,
  filterTribalParts,
  smallPartsCaveat,
  TRIBAL_ATTRIBUTION,
  TRIBAL_CAVEAT,
  TRIBAL_FIELDS,
  TRIBAL_KEEP_LARGEST_PART,
  TRIBAL_MIN_PART_KM2,
  TRIBAL_OFFSET,
} from "@/lib/land/tribal";
import {
  ABPP_CAVEAT,
  ABPP_FIELDS,
  ABPP_LAYERS,
  ABPP_STUDY_DEFINITION,
  buildBattlefields,
  buildNha,
  buildUnits,
  buildWhs,
  isHeritageKind,
  NHA_CAVEAT,
  NHA_FIELDS,
  NPS_ABPP,
  NPS_LRD,
  NPS_NHA,
  NPS_WHS,
  UNIT_FIELDS,
  UNITS_CAVEAT,
  WHS_CAVEAT,
  WHS_FIELDS,
  type HeritageKind,
} from "@/lib/land/heritage";
import {
  buildFloodZones,
  buildHistoric,
  CRITHAB_CAVEAT,
  buildPublicLands,
  buildWetlands,
  NRHP_CAVEAT,
  NRHP_FIELDS,
  nrhpWhere,
  NWI_CAVEAT,
  nwiImagerySummary,
  PADUS_CATEGORIES,
  PADUS_FIELDS,
  parseCritHab,
  NMFS_CAVEAT,
  parseNmfs,
  parseRanges,
  RANGES_CAVEAT,
  type NmfsSpecies,
  parseEpqs,
  parseNwiSources,
  type ElevationReading,
  type NfhlProps,
  type NwiSource,
} from "@/lib/land/features";

export const maxDuration = 60;
export const OPTIONS = options;

// 3DEP / EPQS sits behind CloudFront, whose IPv6 path reset connections in probing (lib/server/net.ts).
preferIpv4();

const NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";
const NWI = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0";
/**
 * NWI mapping projects: the imagery year, date, scale and type each quad was drawn from
 * (Data_Source layer 3, "Image Year"; layer 0 became "Historic map information" in 2026).
 */
const NWI_SOURCE = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Data_Source/MapServer/3";
/** NWI's layer 0 answers at most this many polygons a query (maxRecordCount, 2026-10-12). */
const NWI_MAX_RECORDS = 500;
const PADUS = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Manager_Name_PADUS/FeatureServer/0";
/** NPS National Register spatial data: layer 0 points, layer 1 boundaries (public, non-restricted listings only). */
const NRHP = "https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/nrhp_locations/MapServer";
/** Listings asked for per layer and box; past it the answer says so. */
const NRHP_MAX = 2000;
/** USFWS critical habitat: layer 0 final designations, layer 2 proposed. */
const CRITHAB = "https://services.arcgis.com/QVENGdaPbd4LUkLV/arcgis/rest/services/USFWS_Critical_Habitat/FeatureServer";
/**
 * The fields asked for. unitname, effectdate and accuracy are left out: on the final layer
 * unitname is FWS's placeholder ("Please check current species specific shapefile") on all
 * 803 rows, and leadoffice is a numeric office code, not a name.
 */
const CRITHAB_FIELDS = "comname,sciname,listing_status,status,fedreg,pubdate";
/**
 * NOAA Fisheries critical habitat (marine and anadromous species): layer 226, every polygon
 * designation (named 20230502 but holding rules to 2025-07-15), and layer 2, the river and
 * stream lines (to 2017). Not used: the OPR folder (token required) and EPA's copy, which
 * disagreed with NOAA at Seattle.
 */
const NMFS = "https://maps.fisheries.noaa.gov/server/rest/services/All_NMFS_Critical_Habitat/MapServer";
const NMFS_FIELDS = "SCIENAME,COMNAME,LISTSTATUS,CHSTATUS,UNIT,ECFR,FR,PUBDATE,EFFECTDATE,HABTYPE";
/**
 * EPA OPP's Endangered Species Range Areas, layer 3 "Diced" (12,293 polygons, best for a point
 * query): listed and proposed species whose range covers a point, as USFWS and NOAA delineate it.
 * Asked with returnDistinctValues; never drawn, so the answer is a list and suggests no location.
 * Office_Name and Address_City (FWS field offices) are not asked for.
 */
const RANGES = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Species_Ranges/FeatureServer/3";
const RANGES_FIELDS = "Common_Name,Scientific_Name,ESA_Listing_Status,Entity_Description,Lead_Agency,ECOS_Listed_Species_ID,Range_Shapefile_Last_Updated,Taxonomic_Group,Status_Category";
/** A point never intersects a line: the line layer is asked in a box this many degrees each way (about 200 m). */
const NMFS_LINE_PAD = 0.002;
const EPQS = "https://epqs.nationalmap.gov/v1/json";

const DAY = 24 * 3600_000;
/**
 * Answer within the route's 60 s even when an upstream is slow: past this the
 * caller gets a 502 that says so, and the fetch finishes in the background and
 * is cached for the next request.
 */
const LAND_DEADLINE = { deadlineMs: 50_000 };

/** When a value `ageMs` old was fetched. */
const fetchedAt = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();

/** Said on every box answer: the box is what was asked, and nothing outside it. */
const BOX_CAVEAT = "Only the returned `bbox` was loaded; outside it nothing is loaded, which is not the same as nothing being there.";

interface OpResult {
  data: unknown;
  meta: Record<string, unknown>;
  ttlS: number;
  provenance: Provenance[];
  caveats?: string[];
}

async function opFlood(bbox: Bbox): Promise<OpResult> {
  const r = await cached("nfhl:" + bbox.join(","), DAY, async () => {
    const fc = await arcgisQuery<NfhlProps>(
      "fema-nfhl",
      NFHL,
      {
        where: "1=1",
        ...envelope(bbox),
        outFields: "FLD_AR_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,LEN_UNIT,V_DATUM,DFIRM_ID,STUDY_TYP",
        returnGeometry: "true",
        // ~3 m generalisation: the ungeneralised answer for 2 x 2 km of downtown San Antonio was 136 kB.
        maxAllowableOffset: "0.00003",
        geometryPrecision: "6",
      },
      { gate: "fema-nfhl", minIntervalMs: 400, timeoutMs: 18_000, tries: 3 },
    );
    return { features: buildFloodZones(fc.features), truncated: truncated(fc) };
  }, LAND_DEADLINE);
  const caveats = [
    "A regulatory flood map (FIRM), not a forecast: it says nothing about whether anything is flooding now.",
    "The absence of a zone is not a finding of no flood risk: FEMA has not mapped everywhere, and zone D means no FEMA analysis.",
    BOX_CAVEAT,
  ];
  if (r.value.truncated) caveats.push("FEMA's record limit was hit; ask for a smaller box for every zone.");
  return {
    data: { type: "FeatureCollection", features: r.value.features },
    meta: {
      source: "FEMA National Flood Hazard Layer (layer 28, flood hazard zones)",
      caveat: "Regulatory flood map (FIRM), not a forecast.",
      bbox,
      truncated: r.value.truncated,
      cacheAge: r.age,
    },
    ttlS: 3600,
    provenance: [
      provenance(source("fema-nfhl"), {
        kind: "published",
        seriesId: "NFHL MapServer layer 28 (S_FLD_HAZ_AR, flood hazard zones)",
        upstreamUrl: NFHL,
        retrievedAt: fetchedAt(r.age),
        revision: "effective FIRM data; FEMA revises panels through map revisions and new studies",
        notes: [`bbox ${bbox.join(",")}`],
      }),
    ],
    caveats,
  };
}

/**
 * The NWI projects (quads) that touch a box, with their imagery dates. One small
 * query per box a day; past 20 s the wetlands go out undated and the lookup
 * finishes in the background for the next request.
 */
function nwiSources(bbox: Bbox): Promise<NwiSource[]> {
  return cached("nwi-src:" + bbox.join(","), DAY, async () => {
    const fc = await arcgisQuery(
      "usfws-nwi",
      NWI_SOURCE,
      {
        where: "1=1",
        ...envelope(bbox),
        outFields: "PROJECT_NAME,IMAGE_YR,IMAGE_DATE,IMAGE_SCALE,SOURCE_TYPE,EMULSION",
        returnGeometry: "true",
        maxAllowableOffset: "0.0005",
        geometryPrecision: "5",
      },
      { gate: "usfws-nwi", minIntervalMs: 300, timeoutMs: 15_000, tries: 2 },
    );
    return parseNwiSources(fc.features);
  }, { deadlineMs: 20_000 }).then((r) => r.value);
}

async function opWetlands(bbox: Bbox): Promise<OpResult> {
  // The wetlands and their mapping projects are cached apart, so a source lookup that failed
  // once is asked again next time instead of leaving a day of wetlands undated. A failed
  // lookup leaves the imagery date unknown; it never holds back the wetlands.
  const [r, sources] = await Promise.all([
    cached("nwi:" + bbox.join(","), DAY, async () => {
      const fc = await arcgisQuery(
        "usfws-nwi",
        NWI,
        {
          where: "1=1",
          ...envelope(bbox),
          outFields: [
            // Plain field names: USFWS republished NWI (ArcGIS 11.5) without
            // the joined view, so table-prefixed / NWI_Wetland_Codes join
            // fields now 400. Cowardin names are decoded locally from ATTRIBUTE.
            "OBJECTID",
            "ATTRIBUTE",
            "WETLAND_TYPE",
            "ACRES",
          ].join(","),
          returnGeometry: "true",
          maxAllowableOffset: "0.00004",
          geometryPrecision: "6",
        },
        { gate: "usfws-nwi", minIntervalMs: 300, timeoutMs: 25_000, tries: 2 },
      );
      return { rows: fc.features, truncated: truncated(fc) };
    }, LAND_DEADLINE),
    nwiSources(bbox).catch(() => null),
  ]);
  const imagery = sources ? nwiImagerySummary(sources) : null;
  const retrievedAt = fetchedAt(r.age);
  const prov = [
    provenance(source("usfws-nwi"), { kind: "published", seriesId: "Wetlands MapServer layer 0 (plain fields; Cowardin names decoded locally from ATTRIBUTE)", upstreamUrl: NWI, retrievedAt, notes: [`bbox ${bbox.join(",")}`] }),
  ];
  if (imagery) {
    prov.push(
      provenance(source("usfws-nwi"), {
        kind: "published",
        seriesId: "Data_Source MapServer layer 3 (mapping projects, Image Year)",
        upstreamUrl: NWI_SOURCE,
        retrievedAt,
        notes: [imagery.years.length ? `imagery years in this box: ${imagery.years.join(", ")}` : "imagery year not recorded for the projects in this box"],
      }),
    );
  }
  const caveats = [
    `USFWS: ${NWI_CAVEAT}`,
    "A habitat inventory mapped from imagery that can be decades old, not a jurisdictional (Clean Water Act) delineation.",
    BOX_CAVEAT,
  ];
  if (!imagery) caveats.push("NWI's Data_Source layer did not answer, so the imagery year of these polygons is unknown this time (imageYears: null).");
  if (r.value.truncated) caveats.push(`NWI's record limit (${NWI_MAX_RECORDS} polygons a query) was hit; ask for a smaller box for every polygon.`);
  return {
    data: { type: "FeatureCollection", features: buildWetlands(r.value.rows, sources ?? []) },
    meta: {
      source: "USFWS National Wetlands Inventory (Wetlands and Data_Source layers)",
      // Years of the imagery the polygons in this box were drawn from; null when NWI's source layer did not answer.
      imageYears: imagery?.years ?? null,
      projects: imagery?.projects ?? null,
      caveat: NWI_CAVEAT,
      bbox,
      truncated: r.value.truncated,
      cacheAge: r.age,
    },
    ttlS: imagery ? 3600 : 600,
    provenance: prov,
    caveats,
  };
}

/**
 * Listed properties only (removed listings and those with no status are left out),
 * and never one whose Address NPS marks restricted. Layer 0 has none of those, but
 * layer 1 (boundaries) does: 3 listed polygons read "Address Restricted" (2026-10-12,
 * 22,858 listed, 22,855 after this filter). Address is filtered on, never requested;
 * a null Address is not a restriction marker and is kept.
 */
const NRHP_WHERE = "STATUS='Listed' AND (Address IS NULL OR UPPER(Address) NOT LIKE '%RESTRICT%')";

function nrhpQuery(layer: 0 | 1, bbox: Bbox, nhlOnly = false) {
  return arcgisQuery(
    "nps-nrhp",
    `${NRHP}/${layer}`,
    {
      where: nrhpWhere(NRHP_WHERE, nhlOnly),
      ...envelope(bbox),
      outFields: NRHP_FIELDS.join(","),
      returnGeometry: "true",
      ...(layer === 1 ? { maxAllowableOffset: "0.00004", geometryPrecision: "6" } : {}),
      resultRecordCount: String(NRHP_MAX),
    },
    { gate: "nps-nrhp", minIntervalMs: 300, timeoutMs: 25_000, tries: 2 },
  );
}

/**
 * National Register listings in a box: NPS's points, and with `boundaries` its polygons
 * too (the layer asks for them only below 10 km). A boundary query that fails leaves the
 * points standing and says the boundaries are missing.
 */
async function opHistoric(bbox: Bbox, boundaries: boolean, nhlOnly = false): Promise<OpResult> {
  const tag = nhlOnly ? ":nhl" : "";
  const [pts, bnd] = await Promise.all([
    cached("nrhp-pt:" + bbox.join(",") + tag, DAY, async () => {
      const fc = await nrhpQuery(0, bbox, nhlOnly);
      return { features: buildHistoric(fc.features, "point"), truncated: truncated(fc) || fc.features.length >= NRHP_MAX };
    }, LAND_DEADLINE),
    boundaries
      ? cached("nrhp-bnd:" + bbox.join(",") + tag, DAY, async () => {
          const fc = await nrhpQuery(1, bbox, nhlOnly);
          return { features: buildHistoric(fc.features, "boundary"), truncated: truncated(fc) || fc.features.length >= NRHP_MAX };
        }, LAND_DEADLINE).catch(() => null)
      : Promise.resolve(null),
  ]);
  const retrievedAt = fetchedAt(pts.age);
  const prov = [
    provenance(source("nps-nrhp"), { kind: "published", seriesId: "nrhp_locations MapServer layer 0 (points), listed, restricted addresses excluded", upstreamUrl: `${NRHP}/0`, retrievedAt, notes: [`bbox ${bbox.join(",")}`] }),
  ];
  if (bnd) prov.push(provenance(source("nps-nrhp"), { kind: "published", seriesId: "nrhp_locations MapServer layer 1 (boundaries), listed, restricted addresses excluded", upstreamUrl: `${NRHP}/1`, retrievedAt: fetchedAt(bnd.age), notes: [`bbox ${bbox.join(",")}`] }));
  const caveats = [
    NRHP_CAVEAT,
    "Property names are shown as NPS lists them and can include a person's name; they are not searchable. No street address is requested.",
    BOX_CAVEAT,
  ];
  if (nhlOnly) caveats.push("National Historic Landmarks only (nhl=1: NPS's Is_NHL flag), with the same listed-only and restricted-address exclusions; every other National Register listing in the box is left out of this answer, not absent.");
  if (pts.value.truncated) caveats.push(`NPS's points were capped at the first ${NRHP_MAX.toLocaleString("en-US")} in this box; ask for a smaller box for every listing.`);
  if (bnd?.value.truncated) caveats.push(`NPS's boundaries were capped at the first ${NRHP_MAX.toLocaleString("en-US")} in this box.`);
  if (boundaries && !bnd) caveats.push("NPS's boundary layer did not answer this time; the points are shown, the boundaries are missing (boundaries: null).");
  return {
    data: { type: "FeatureCollection", features: [...pts.value.features, ...(bnd?.value.features ?? [])] },
    meta: {
      source: "National Park Service, National Register of Historic Places spatial data (public, non-restricted listings)",
      bbox,
      nhlOnly,
      points: pts.value.features.length,
      // null when boundaries were asked for and NPS did not answer; absent when not asked for.
      ...(boundaries ? { boundaries: bnd ? bnd.value.features.length : null } : {}),
      truncated: pts.value.truncated || !!bnd?.value.truncated,
      maxRecords: NRHP_MAX,
      cacheAge: pts.age,
    },
    ttlS: boundaries && !bnd ? 600 : 3600,
    provenance: prov,
    caveats,
  };
}

/**
 * Which designated critical habitat contains a point: FWS final (layer 0) and proposed
 * (layer 2), and NOAA Fisheries polygons (layer 226) at the point and river lines (layer 2)
 * within about 200 m, all in parallel, no geometry back, each cached a day per point
 * (5 decimals). A source that fails is named as unknown, not absent; all failing is an
 * upstream error.
 */
async function opCritHab(lon: number, lat: number): Promise<OpResult> {
  const x = Number(lon.toFixed(5));
  const y = Number(lat.toFixed(5));
  const ask = (layer: 0 | 2) =>
    cached(`crithab:${layer}:${x},${y}`, DAY, async () => {
      const fc = await arcgisQuery(
        "usfws-crithab",
        `${CRITHAB}/${layer}`,
        {
          where: "1=1",
          geometry: `${x},${y}`,
          geometryType: "esriGeometryPoint",
          inSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          outFields: CRITHAB_FIELDS,
          returnGeometry: "false",
        },
        { gate: "usfws-crithab", minIntervalMs: 300, timeoutMs: 20_000, tries: 2 },
      );
      return parseCritHab(fc.features);
    });
  const nmfs = (layer: 226 | 2) =>
    cached(`nmfs-crithab:${layer}:${x},${y}`, DAY, async () => {
      const where =
        layer === 226
          ? { geometry: `${x},${y}`, geometryType: "esriGeometryPoint" }
          : { geometry: JSON.stringify({ xmin: Number((x - NMFS_LINE_PAD).toFixed(5)), ymin: Number((y - NMFS_LINE_PAD).toFixed(5)), xmax: Number((x + NMFS_LINE_PAD).toFixed(5)), ymax: Number((y + NMFS_LINE_PAD).toFixed(5)) }), geometryType: "esriGeometryEnvelope" };
      const fc = await arcgisQuery(
        "noaa-nmfs-crithab",
        `${NMFS}/${layer}`,
        { where: "1=1", ...where, inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: NMFS_FIELDS, returnGeometry: "false" },
        { gate: "noaa-nmfs-crithab", minIntervalMs: 250, timeoutMs: 20_000, tries: 2 },
      );
      return parseNmfs(fc.features, layer === 226 ? "area" : "line");
    });
  const ranges = () =>
    cached(`opp-ranges:3:${x},${y}`, DAY, async () =>
      parseRanges(
        await arcgisRows(
          "epa-opp-ranges",
          RANGES,
          { where: "1=1", geometry: `${x},${y}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: RANGES_FIELDS, returnGeometry: "false", returnDistinctValues: "true" },
          { gate: "epa-opp-ranges", minIntervalMs: 250, timeoutMs: 20_000, tries: 2 },
        ),
      ),
    );
  const settle = <T,>(p: Promise<T>) => p.catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
  const [fin, prop, nArea, nLine, rng] = await Promise.all([settle(ask(0)), settle(ask(2)), settle(nmfs(226)), settle(nmfs(2)), settle(ranges())]);
  if (fin instanceof Error && prop instanceof Error && nArea instanceof Error && nLine instanceof Error && rng instanceof Error) throw fin;
  // A separate list, never mixed into the habitat rows: range is not habitat and not presence.
  const speciesRanges = rng instanceof Error ? null : rng.value;
  const final = fin instanceof Error ? null : fin.value;
  const proposed = prop instanceof Error ? null : prop.value;
  // NOAA is one source to the reader: both of its layers answered, or it is unknown.
  const noaa: NmfsSpecies[] | null = nArea instanceof Error || nLine instanceof Error ? null : [...nArea.value, ...nLine.value];
  const ages = [fin, prop, nArea, nLine, rng].map((r) => (r instanceof Error ? 0 : r.age));
  const age = Math.max(...ages);
  const species = [...(final ?? []), ...(proposed ?? []), ...(noaa ?? [])];
  const caveats = [CRITHAB_CAVEAT, NMFS_CAVEAT, RANGES_CAVEAT];
  if (!species.length && final && proposed && noaa) caveats.push("No designated critical habitat contains this point. That is not a finding that no listed species is here: most listed species have no designation, and range is not habitat.");
  if (!final) caveats.push("FWS's final critical habitat layer did not answer this time (final: null); final designations here are unknown, not absent.");
  if (!proposed) caveats.push("FWS's proposed critical habitat layer did not answer this time (proposed: null); proposed designations here are unknown, not absent.");
  if (!noaa) caveats.push("NOAA Fisheries' critical habitat layers did not answer this time (noaa: null); marine and anadromous designations here are unknown, not absent.");
  if (!speciesRanges) caveats.push("EPA's species range layer did not answer this time (ranges: null); which listed species' ranges cover this point is unknown, not none.");
  const prov: Provenance[] = [];
  if (final) prov.push(provenance(source("usfws-crithab"), { kind: "published", seriesId: "USFWS_Critical_Habitat FeatureServer layer 0 (final)", upstreamUrl: `${CRITHAB}/0`, retrievedAt: fetchedAt(age), notes: [`point ${x},${y}`] }));
  if (proposed) prov.push(provenance(source("usfws-crithab"), { kind: "published", seriesId: "USFWS_Critical_Habitat FeatureServer layer 2 (proposed)", upstreamUrl: `${CRITHAB}/2`, retrievedAt: fetchedAt(age), notes: [`point ${x},${y}`] }));
  if (noaa) {
    prov.push(provenance(source("noaa-nmfs-crithab"), { kind: "published", seriesId: "All_NMFS_Critical_Habitat MapServer layer 226 (polygons, at the point)", upstreamUrl: `${NMFS}/226`, retrievedAt: fetchedAt(age), notes: [`point ${x},${y}`] }));
    prov.push(provenance(source("noaa-nmfs-crithab"), { kind: "published", seriesId: "All_NMFS_Critical_Habitat MapServer layer 2 (lines, within about 200 m)", upstreamUrl: `${NMFS}/2`, retrievedAt: fetchedAt(age), notes: [`box ${NMFS_LINE_PAD} degrees around ${x},${y}`] }));
  }
  if (speciesRanges) prov.push(provenance(source("epa-opp-ranges"), { kind: "published", seriesId: "Species_Ranges FeatureServer layer 3 (Diced Endangered Species Range Areas), distinct", upstreamUrl: RANGES, retrievedAt: fetchedAt(age), notes: [`point ${x},${y}`] }));
  return {
    data: { lon: x, lat: y, final, proposed, noaa, ranges: speciesRanges },
    meta: { source: "U.S. Fish and Wildlife Service (final and proposed) and NOAA Fisheries critical habitat; EPA OPP species ranges", cacheAge: age },
    ttlS: final && proposed && noaa && speciesRanges ? 3600 : 300,
    provenance: prov,
    caveats,
  };
}

let padusDomains: Promise<Map<string, Map<string, string>>> | null = null;
function padusLookup(): Promise<Map<string, Map<string, string>>> {
  if (!padusDomains) {
    padusDomains = arcgisLayerInfo("padus", PADUS, "padus")
      .then(codedDomains)
      .catch((err) => {
        padusDomains = null;
        throw err;
      });
  }
  return padusDomains;
}

/** A box taller than this (degrees north-south) is the layer's wide view: fewer, coarser units. */
const PADUS_WIDE_SPAN = 1.5;
/** Units kept in a wide box, largest first (a 2 degree Front Range box holds more than 2,000). */
const PADUS_WIDE_MAX = 600;
/** Generalisation (degrees) per tier: ~50 m near, ~250 m wide. */
const PADUS_NEAR_OFFSET = 0.0005;
const PADUS_WIDE_OFFSET = 0.0025;
/** Response budget: Vercel refuses function bodies over 4.5 MB. */
const PADUS_MAX_BYTES = 3_000_000;

function padusQuery(bbox: Bbox, offset: number, maxRecords?: number) {
  return arcgisQuery(
    "padus",
    PADUS,
    {
      where: `Category IN (${PADUS_CATEGORIES.map((c) => `'${c}'`).join(",")})`,
      ...envelope(bbox),
      outFields: PADUS_FIELDS.join(","),
      returnGeometry: "true",
      maxAllowableOffset: String(offset),
      geometryPrecision: "5",
      // Largest first, so a capped answer keeps the biggest units.
      orderByFields: "GIS_Acres DESC",
      ...(maxRecords ? { resultRecordCount: String(maxRecords) } : {}),
    },
    { gate: "padus", minIntervalMs: 300, timeoutMs: 25_000, tries: 2 },
  );
}

async function opPublicLands(bbox: Bbox): Promise<OpResult> {
  const r = await cached("padus:" + bbox.join(","), DAY, async () => {
    // North-south extent: the east-west one grows with latitude for the same view.
    const wide = bbox[3] - bbox[1] > PADUS_WIDE_SPAN;
    // Units run from a city park to millions of acres. One generalisation per tier (~1/2000
    // of a near box, ~1/800 of a wide one), so a unit comes back the same from every box
    // and the browser can keep what it already drew.
    let offset = wide ? PADUS_WIDE_OFFSET : PADUS_NEAR_OFFSET;
    let max = wide ? PADUS_WIDE_MAX : undefined;
    const domainsP = padusLookup().catch(() => new Map<string, Map<string, string>>());
    let fc = await padusQuery(bbox, offset, max);
    const domains = await domainsP;
    let features = buildPublicLands(fc.features, domains, { box: bbox, minDeg: offset });
    let capped = (max != null && fc.features.length >= max) || truncated(fc);
    let generalised = false;
    if (JSON.stringify(features).length > PADUS_MAX_BYTES) {
      // One coarser retry with half the units rather than an answer the platform refuses.
      offset *= 2.5;
      max = Math.min(max ?? PADUS_WIDE_MAX, Math.max(100, Math.floor(fc.features.length / 2)));
      fc = await padusQuery(bbox, offset, max);
      features = buildPublicLands(fc.features, domains, { box: bbox, minDeg: offset });
      capped = true;
      generalised = true;
    }
    return { features, truncated: capped, decoded: domains.size > 0, wide, offset, max, generalised };
  }, LAND_DEADLINE);
  const caveats = [
    "Public access is PAD-US's code for each unit; it is not permission to enter.",
    "The land inside a proclamation boundary is not all public, and an easement's owner keeps the land (the holder has the rights the easement grants).",
    "Owners, managers and easement holders are as PAD-US publishes them; nothing is added or joined from another source.",
    BOX_CAVEAT,
  ];
  if (r.value.truncated) caveats.push(r.value.max ? `Only the largest ${r.value.max} units in this box are returned; ask for a smaller box for the rest.` : "PAD-US's record limit was hit; ask for a smaller box for every unit.");
  if (!r.value.decoded) caveats.push("PAD-US's coded-value domains did not load, so coded fields show their codes this time.");
  return {
    data: { type: "FeatureCollection", features: r.value.features },
    meta: {
      source: "USGS Gap Analysis Project, PAD-US 4.1 (doi:10.5066/P96WBCHS)",
      categories: PADUS_CATEGORIES,
      bbox,
      // true when units were left out: the wide-view cap (largest kept) or the service's own limit.
      truncated: r.value.truncated,
      maxUnits: r.value.max ?? null,
      generalisationDeg: r.value.offset,
      coarsenedForSize: r.value.generalised,
      domainsDecoded: r.value.decoded,
      cacheAge: r.age,
    },
    ttlS: 3600,
    provenance: [
      provenance(source("usgs-padus"), {
        kind: "published",
        seriesId: `Manager_Name_PADUS FeatureServer layer 0 (${PADUS_CATEGORIES.join(", ")})`,
        upstreamUrl: PADUS,
        retrievedAt: fetchedAt(r.age),
        notes: [`bbox ${bbox.join(",")}`, `generalised to ${r.value.offset}° (maxAllowableOffset)`],
      }),
    ],
    caveats,
  };
}

async function opElevation(lon: number, lat: number): Promise<OpResult> {
  const x = Number(lon.toFixed(5));
  const y = Number(lat.toFixed(5));
  const qs = new URLSearchParams({ x: String(x), y: String(y), units: "Meters", wkid: "4326", includeDate: "false" });
  let reading: ElevationReading;
  let ttlS = 24 * 3600;
  let age = 0;
  try {
    const r = await cached(`epqs:${x},${y}`, DAY, async () => {
      const text = await retrying(async () => {
        const res = await polite("epqs", 150, 30_000, () => upstream("usgs-epqs", `${EPQS}?${qs}`, { timeoutMs: 15_000 }));
        return res.text();
      });
      let j: Parameters<typeof parseEpqs>[2];
      try {
        j = JSON.parse(text);
      } catch {
        throw new NoValue(text);
      }
      return parseEpqs(x, y, j);
    });
    reading = r.value;
    age = r.age;
  } catch (err) {
    if (!(err instanceof NoValue)) throw err;
    // Outside 3DEP coverage (and over open water) EPQS answers 200 with a plain-text
    // "Call failed. [...]". Relay it as no value; not held in memory, briefly at the edge.
    reading = { lon: x, lat: y, note: `EPQS returned no value: ${err.message.replace(/\s+/g, " ").trim().slice(0, 80)}` };
    ttlS = 600;
  }
  const notes: string[] = [];
  if (reading.resolutionM != null) notes.push(`source DEM resolution ${reading.resolutionM} m`);
  if (reading.note) notes.push(reading.note);
  return {
    data: reading,
    meta: { source: "USGS 3DEP Elevation Point Query Service", units: "metres", cacheAge: age },
    ttlS,
    provenance: [
      provenance(source("usgs-epqs"), {
        kind: "published",
        seriesId: reading.rasterId != null ? `raster ${reading.rasterId}` : undefined,
        upstreamUrl: `${EPQS}?${qs}`,
        retrievedAt: fetchedAt(age),
        notes: notes.length ? notes : undefined,
      }),
    ],
    caveats:
      reading.metres == null
        ? ["EPQS has no value here: it covers the United States (3DEP), and returns none outside that coverage and over some open water."]
        : ["Bare-earth elevation in metres above the DEM's vertical datum (NAVD88 in the conterminous US)."],
  };
}

/** EPQS answered, but with text instead of a JSON value. */
class NoValue extends Error {}

const NPS_GATE = { gate: "nps-arcgis", minIntervalMs: 250, timeoutMs: 25_000, tries: 2 };
const HERITAGE_HELP = "kind=units | nha | battlefields | whs; bbox=w,s,e,n for units (boundaries, at most 2 degrees; without a box, every unit's centroid) and battlefields (at most 8 degrees)";

/**
 * National heritage, one kind per call. Units: boundaries in a box (simplified to a thousandth
 * of its span) or every centroid; NHA and WHS: one national answer each, held a week;
 * battlefields: six ABPP layers in a box, a layer that fails counted in `coverage` (unknown,
 * not none).
 */
async function opHeritage(kind: HeritageKind, bbox: Bbox | null): Promise<OpResult> {
  const geo = (layer: string, params: Record<string, string>) => arcgisQuery("nps-heritage", layer, { where: "1=1", returnGeometry: "true", outSR: "4326", resultRecordCount: "2000", ...params }, NPS_GATE);
  const prov = (id: Parameters<typeof source>[0], seriesId: string, url: string, age: number, notes?: string[]) => provenance(source(id), { kind: "published", seriesId, upstreamUrl: url, retrievedAt: fetchedAt(age), notes });
  if (kind === "units") {
    if (bbox) {
      const off = Math.max(0.0001, Math.min(0.002, (bbox[2] - bbox[0]) / 1000));
      const r = await cached(`heritage:units:${bbox.join(",")}`, DAY, async () => {
        const fc = await geo(`${NPS_LRD}/2`, { ...envelope(bbox), outFields: UNIT_FIELDS.join(","), geometryPrecision: "5", maxAllowableOffset: String(off) });
        return { features: buildUnits(fc.features, "polygon"), cut: truncated(fc) };
      });
      return {
        data: { type: "FeatureCollection", features: r.value.features },
        meta: { source: "NPS Land Resources Division, unit boundaries", kind, bbox, shape: "polygon", count: r.value.features.length, cacheAge: r.age },
        ttlS: 3600,
        provenance: [prov("nps-lrd-boundaries", `NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service layer 2 (nps_boundary), simplified to ${off} degrees`, `${NPS_LRD}/2`, r.age, [`bbox ${bbox.join(",")}`])],
        caveats: [UNITS_CAVEAT, BOX_CAVEAT],
      };
    }
    const r = await cached("heritage:units:centroids", 7 * DAY, async () => {
      const fc = await geo(`${NPS_LRD}/0`, { outFields: UNIT_FIELDS.join(","), geometryPrecision: "4" });
      return { features: buildUnits(fc.features, "point"), cut: truncated(fc) };
    });
    return {
      data: { type: "FeatureCollection", features: r.value.features },
      meta: { source: "NPS Land Resources Division, unit centroids", kind, shape: "point", count: r.value.features.length, cacheAge: r.age },
      ttlS: 86_400,
      provenance: [prov("nps-lrd-boundaries", "NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service layer 0 (nps_boundary_centroids)", `${NPS_LRD}/0`, r.age)],
      caveats: [UNITS_CAVEAT],
    };
  }
  if (kind === "nha") {
    const r = await cached("heritage:nha", 7 * DAY, async () => buildNha((await geo(NPS_NHA, { outFields: NHA_FIELDS.join(","), geometryPrecision: "3", maxAllowableOffset: "0.01" })).features));
    return {
      data: { type: "FeatureCollection", features: r.value },
      meta: { source: "NPS National Heritage Areas (WASO_NHA_Map2026)", kind, count: r.value.length, cacheAge: r.age },
      ttlS: 86_400,
      provenance: [prov("nps-nha", "WASO_NHA_Map2026 layer 0, simplified to 0.01 degrees", NPS_NHA, r.age)],
      caveats: [NHA_CAVEAT, "Each area's description is NPS's own text, shown as NPS serves it; it is not searched or embedded."],
    };
  }
  if (kind === "whs") {
    const r = await cached("heritage:whs", 7 * DAY, async () => buildWhs((await geo(NPS_WHS, { outFields: WHS_FIELDS.join(","), geometryPrecision: "4", maxAllowableOffset: "0.001" })).features));
    return {
      data: { type: "FeatureCollection", features: r.value },
      meta: { source: "NPS World Heritage Sites", kind, count: r.value.length, cacheAge: r.age },
      ttlS: 86_400,
      provenance: [prov("nps-whs", "World_Heritage_Sites layer 0, simplified to 0.001 degrees, grouped by inscription", NPS_WHS, r.age)],
      caveats: [WHS_CAVEAT, "The organisations NPS lists as site owners are not requested."],
    };
  }
  const b = bbox!;
  const parts = await Promise.all(
    ABPP_LAYERS.map((l) =>
      cached(`heritage:abpp:${l.id}:${b.join(",")}`, 7 * DAY, async () => {
        const fc = await geo(`${NPS_ABPP}/${l.id}`, { ...envelope(b), outFields: ABPP_FIELDS.join(","), geometryPrecision: "5", maxAllowableOffset: "0.0005" });
        return { features: buildBattlefields(fc.features, l), cut: truncated(fc) };
      }).catch(() => null),
    ),
  );
  if (parts.every((p) => p == null)) throw new Error("NPS's battlefield layers did not answer");
  const coverage = ABPP_LAYERS.map((l, i) => ({ id: `abpp-${l.id}`, name: `${l.war} ${l.boundary} areas`, state: parts[i] ? (parts[i]!.value.cut ? "partial" : "covered") : "error", count: parts[i] ? parts[i]!.value.features.length : null }));
  const caveats = [ABPP_CAVEAT, ABPP_STUDY_DEFINITION, "Potential National Register boundaries and the Civil War resurvey layers are not drawn, so nothing here reads as listed.", BOX_CAVEAT];
  for (const c of coverage) if (c.state === "error") caveats.push(`NPS's ${c.name} layer did not answer this time: unknown, not none.`);
  return {
    data: { type: "FeatureCollection", features: parts.flatMap((p) => p?.value.features ?? []) },
    meta: { source: "NPS American Battlefield Protection Program", kind, bbox: b, coverage, cacheAge: Math.max(...parts.map((p) => p?.age ?? 0)) },
    ttlS: coverage.some((c) => c.state === "error") ? 600 : 3600,
    provenance: [prov("nps-abpp", "ABPP_Battlefield_Boundaries layers 0, 1, 5, 6, 8, 9 (study and core areas), simplified to 0.0005 degrees", NPS_ABPP, Math.max(...parts.map((p) => p?.age ?? 0)), [`bbox ${b.join(",")}`])],
    caveats,
  };
}

const BIA_GATE = { gate: "bia-lar", minIntervalMs: 500, timeoutMs: 25_000, tries: 2 };

/**
 * BIA's Land Area Representation, one national answer (335 land areas, about 580 kB at offset
 * 0.01), with the small-part rule applied before anything leaves the server (lib/land/tribal.ts).
 */
async function opTribal(): Promise<OpResult> {
  const r = await cached("tribal:national", DAY, async () => {
    const fc = await arcgisQuery(
      "bia-lar",
      BIA_LAR_LAYER,
      { where: "1=1", outFields: TRIBAL_FIELDS.join(","), returnGeometry: "true", outSR: "4326", maxAllowableOffset: String(TRIBAL_OFFSET), geometryPrecision: "4", resultRecordCount: "2000" },
      BIA_GATE,
    );
    const kept = filterTribalParts(fc.features);
    return { features: buildTribal(kept.features), droppedParts: kept.droppedParts, keptSmallLargest: kept.keptSmallLargest, hiddenAreas: kept.hiddenAreas, upstream: fc.features.length, cut: truncated(fc) };
  });
  const v = r.value;
  const caveats = [TRIBAL_CAVEAT, smallPartsCaveat(v.droppedParts, v.keptSmallLargest, v.hiddenAreas.length), "CLASSIFICATION is shown as BIA codes it: the service publishes no meaning for the code. GISACRES is GIS acreage, not surveyed acreage."];
  if (v.cut) caveats.push("BIA's answer was cut at its record limit: some land areas are missing from this answer.");
  return {
    data: { type: "FeatureCollection", features: v.features },
    meta: {
      source: TRIBAL_ATTRIBUTION,
      count: v.features.length,
      upstream: v.upstream,
      minPartKm2: TRIBAL_MIN_PART_KM2,
      keepLargestPart: TRIBAL_KEEP_LARGEST_PART,
      droppedParts: v.droppedParts,
      keptSmallLargest: v.keptSmallLargest,
      hiddenAreas: v.hiddenAreas,
      cacheAge: r.age,
    },
    ttlS: 86_400,
    provenance: [
      provenance(source("bia-lar"), {
        kind: "published",
        seriesId: `BIA_AIAN_National_LAR FeatureServer layer 0, simplified to ${TRIBAL_OFFSET} degrees; parts under ${TRIBAL_MIN_PART_KM2} km2 dropped (${v.droppedParts}), each land area's largest part kept`,
        upstreamUrl: BIA_LAR_LAYER,
        retrievedAt: fetchedAt(r.age),
      }),
    ],
    caveats,
  };
}

function respond(r: OpResult) {
  return ok(r.data, { meta: r.meta, provenance: r.provenance, caveats: r.caveats, ttlS: r.ttlS });
}

const BBOX_HELP = "bbox=w,s,e,n required, west < east and south < north, e.g. bbox=-98.50,29.41,-98.47,29.44";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "flood": {
        const b = parseBbox(q.get("bbox"), 0.08, 0.02);
        if (!b) return badRequest(BBOX_HELP);
        return respond(await opFlood(b));
      }
      case "wetlands": {
        const b = parseBbox(q.get("bbox"), 0.08, 0.02);
        if (!b) return badRequest(BBOX_HELP);
        return respond(await opWetlands(b));
      }
      case "historic": {
        const b = parseBbox(q.get("bbox"), 0.12, 0.02);
        if (!b) return badRequest(BBOX_HELP);
        return respond(await opHistoric(b, q.get("polygons") === "1", q.get("nhl") === "1"));
      }
      case "heritage": {
        const kind = q.get("kind");
        if (!isHeritageKind(kind)) return badRequest(HERITAGE_HELP);
        const raw = q.get("bbox");
        const b = raw == null || raw === "" ? null : kind === "battlefields" ? parseBbox(raw, 8, 0.5) : parseBbox(raw, 2, 0.25);
        if ((raw && !b) || (kind === "battlefields" && !b)) return badRequest(HERITAGE_HELP);
        return respond(await opHeritage(kind, kind === "units" || kind === "battlefields" ? b : null));
      }
      case "crithab": {
        const lon = numParam(q.get("lon"));
        const lat = numParam(q.get("lat"));
        if (lon == null || lat == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return badRequest("lon and lat required, e.g. lon=-97.7713&lat=30.2638");
        return respond(await opCritHab(lon, lat));
      }
      case "publiclands": {
        const b = parseBbox(q.get("bbox"), 2, 0.25);
        if (!b) return badRequest(BBOX_HELP);
        return respond(await opPublicLands(b));
      }
      case "elevation": {
        const lon = numParam(q.get("lon"));
        const lat = numParam(q.get("lat"));
        if (lon == null || lat == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return badRequest("lon and lat required, e.g. lon=-98.47&lat=29.465");
        return respond(await opElevation(lon, lat));
      }
      case "tribal":
        return respond(await opTribal());
      default:
        return badRequest("unknown op: flood | wetlands | historic | heritage | crithab | publiclands | elevation | tribal");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
