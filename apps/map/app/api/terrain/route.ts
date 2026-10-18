// Terrain API: the pictures the terrain & land cover layers draw that no
// publisher caches as tiles, rendered once per Web Mercator tile and held at
// the edge, and the class or value under a point. CORS open, keyless.
//
//   /api/terrain?op=tile&product=slope&z=13&x=1855&y=3393
//        one 512 px PNG tile of: slope (USGS 3DEP "Slope Map", z 8-16),
//        contours (3DEP "Preset 2ft Contour Interval", z 13-17), landcover
//        (MRLC NLCD 2021 WMS, z 5-12), floodmap (FEMA NFHL layer 28 export,
//        z 14-17). The route builds the upstream request from the product and
//        the tile's EPSG:3857 box; it never takes a URL.
//   /api/terrain?op=point&product=firehazard|landcover|slope&lon=..&lat=..
//        the WHP 2023 class, the NLCD 2021 class, or the 3DEP slope in degrees
//        at a point, with the class table the service's own legend publishes
//   /api/terrain?op=wayback
//        Esri World Imagery Wayback's release index, [{release, date}] newest
//        first (2014-02-20 onward), held a day; tiles are never proxied
//   /api/terrain?op=waybackdate&release=..&z=..&lon=..&lat=..
//        when the pixels of a Wayback release were captured at a point, from
//        that release's own imagery metadata (every row; the newest release
//        when release is absent); held 7 days
//   /api/terrain?op=naip&lon=..&lat=..
//        NAIP aerial photograph years at a point (USDA FSA via Microsoft Planetary
//        Computer's STAC search): each year with its acquisition dates, item ids,
//        resolution and state. Point snapped to 0.001 degrees, held 30 days.
//   /api/terrain?op=naipmosaic&year=yyyy
//        Registers (or reuses) Planetary Computer's per-year NAIP mosaic and answers
//        { year, searchid, tiles }. Only a year the STAC search lists an item for
//        is registered; any other is a 400. Held 24 hours; a held id is checked against
//        /mosaic/{id}/info at most every 10 minutes, and one Planetary Computer no
//        longer knows (its 404 "SearchId ... not found") is registered again, at
//        most once a year per 10 minutes (reregisterCooling true while it waits).
//        When the check itself fails the held id is served (infoChecked false).
//        Nothing here forces a register. Tiles load from Planetary Computer directly.
//   /api/terrain?op=topo&lon=..&lat=..
//        USGS historical topographic maps (HTMC, 1879-2006) at a point: the
//        edition years there with their scales, and each sheet's citation,
//        with its GeoPDF and GeoTIFF from USGS TNM where TNM lists the scan
//        (point snapped to 0.01 degrees, held 30 days; the collection is closed)
//   /api/terrain?op=products
//        the catalog: every terrain picture, direct or rendered here, with its
//        source, zoom range, class tables, caveats and the terrain tiles'
//        required attribution
//
// Tiles are cached a day in this process and for weeks at the edge (the data
// behind them changes on the scale of months to years); point answers a day.
// 3DEP sits behind CloudFront, whose IPv6 path reset connections in probing,
// so this route resolves IPv4 first (lib/server/net.ts).

import type { NextRequest } from "next/server";
import { cacheDelete, cached } from "@/lib/server/cache";
import { jsonError, polite, UpstreamError, upstreamJson } from "@/lib/server/upstream";
import { badRequest, CORS, ok, options, withCors } from "@/lib/server/respond";
import { preferIpv4, retrying } from "@/lib/server/net";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import {
  DIRECT_SOURCES,
  LANDSLIDE_SUSC_CAVEAT,
  NWI_RASTER_CAVEAT,
  RENDER_PRODUCTS,
  SLR_CAVEAT,
  SLR_FEET,
  SOIL_CAVEAT,
  TERRARIUM_ATTRIBUTION,
  WHP_CAVEAT,
  isRenderProduct,
} from "@/lib/terrain/products";
import { NLCD_CLASSES, NWI_RASTER_CLASSES, SLR_LEGEND, WHP_CLASSES } from "@/lib/terrain/classes";
import { validTile } from "@/lib/terrain/webmercator";
import { nlcdAt, renderTile, slopeAt, whpAt } from "@/lib/terrain/sources";
import {
  metadataLayerFor,
  neighbourLayer,
  parseCaptures,
  parseWaybackConfig,
  WAYBACK_ATTRIBUTION,
  WAYBACK_CAPTURE_CAVEAT,
  WAYBACK_CAVEAT,
  WAYBACK_CONFIG,
  WAYBACK_METADATA_ATTRIBUTION,
  WAYBACK_METADATA_FIELDS,
  waybackMetadataUrls,
  waybackTiles,
} from "@/lib/terrain/wayback";
import { arcgisRows } from "@/lib/server/arcgis";
import { isSearchIdNotFound, NAIP_ATTRIBUTION, NAIP_CAVEAT, NAIP_REREGISTER_COOLDOWN_MS, naipTiles, naipUnlistedMessage, naipYearListed, naipYears, parseNaipYear, parseSearchId, PC_MOSAIC, PC_STAC_SEARCH, registerBody, stacBody, stacYearBody } from "@/lib/terrain/naip";
import { HTMC, HTMC_ATTRIBUTION, HTMC_FIELDS, parseHtmcSheets, TNM_PRODUCTS, tnmFiles, TOPO_CAVEAT, topoTiles, topoYears, withTnmFiles, type TnmFiles } from "@/lib/terrain/topo";

export const maxDuration = 60;
export const OPTIONS = options;

preferIpv4();

const DAY = 24 * 3600_000;

/** An integer query parameter, or null (blank and "1.5" are not integers). */
function intParam(v: string | null): number | null {
  if (v == null || !/^\d{1,8}$/.test(v.trim())) return null;
  return Number(v.trim());
}

/** A finite number, or null; a missing or blank one is null, never 0. */
function numParam(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const TILE_HELP = "op=tile needs product=slope|contours|landcover|floodmap and integer z, x, y inside the product's zoom range, e.g. product=slope&z=13&x=1855&y=3393";

async function opTile(q: URLSearchParams): Promise<Response> {
  const product = q.get("product") ?? "";
  if (!isRenderProduct(product)) return badRequest(TILE_HELP);
  const p = RENDER_PRODUCTS[product];
  const z = intParam(q.get("z"));
  const x = intParam(q.get("x"));
  const y = intParam(q.get("y"));
  if (z == null || x == null || y == null || !validTile(z, x, y)) return badRequest(TILE_HELP);
  if (z < p.minZoom || z > p.maxZoom) return badRequest(`${product} is rendered at z ${p.minZoom}-${p.maxZoom}; asked for z ${z}`);
  const t = await renderTile(product, z, x, y);
  return new Response(t.body as unknown as BodyInit, {
    status: 200,
    headers: {
      ...CORS,
      "content-type": t.contentType,
      // Browsers keep a day; the edge keeps the product's TTL and serves stale while it refreshes.
      "cache-control": `public, max-age=86400, s-maxage=${p.ttlS}, stale-while-revalidate=86400`,
      "x-terrain-source": source(p.source).name,
    },
  });
}

type PointProduct = "firehazard" | "landcover" | "slope";
const POINT_PRODUCTS: PointProduct[] = ["firehazard", "landcover", "slope"];
const POINT_HELP = "op=point needs product=firehazard|landcover|slope and lon, lat, e.g. product=landcover&lon=-98.4936&lat=29.4241";

async function opPoint(q: URLSearchParams): Promise<Response> {
  const product = q.get("product") as PointProduct;
  if (!POINT_PRODUCTS.includes(product)) return badRequest(POINT_HELP);
  const lon = numParam(q.get("lon"));
  const lat = numParam(q.get("lat"));
  if (lon == null || lat == null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return badRequest(POINT_HELP);
  const x = Number(lon.toFixed(5));
  const y = Number(lat.toFixed(5));
  const key = `terrain-point:${product}:${x},${y}`;
  if (product === "slope") {
    const r = await cached(key, DAY, () => slopeAt(x, y));
    return ok(
      { lon: x, lat: y, product, degrees: r.value.degrees },
      {
        meta: { source: source("usgs-3dep").name, cacheAge: r.age },
        ttlS: 3600,
        provenance: [provenance(source("usgs-3dep"), { kind: "published", seriesId: "3DEPElevation ImageServer identify, raster function \"Slope Degrees\"", upstreamUrl: r.value.upstreamUrl, retrievedAt: new Date(Date.now() - r.age).toISOString() })],
        caveats: [
          r.value.degrees == null
            ? "3DEP returned no slope here (outside its coverage or NoData)."
            : "Slope in whole degrees as 3DEP's \"Slope Degrees\" function returns it at this point, from the best available bare-earth DEM (1 m lidar where flown).",
        ],
      },
    );
  }
  const whp = product === "firehazard";
  const r = await cached(key, DAY, () => (whp ? whpAt(x, y) : nlcdAt(x, y)));
  const src = source(whp ? "usfs-whp" : "mrlc-nlcd");
  return ok(
    { lon: x, lat: y, product, class: r.value.value, classes: whp ? WHP_CLASSES : NLCD_CLASSES },
    {
      meta: { source: src.name, cacheAge: r.age },
      ttlS: 3600,
      provenance: [
        provenance(src, {
          kind: "published",
          seriesId: whp ? "ImageServer identify (class code) + the service's /legend (labels)" : "WMS GetFeatureInfo PALETTE_INDEX (class code) + MRLC GetLegendGraphic (labels)",
          upstreamUrl: r.value.upstreamUrl,
          retrievedAt: new Date(Date.now() - r.age).toISOString(),
        }),
      ],
      caveats: [
        whp ? WHP_CAVEAT : "NLCD 2021, 30 m pixels, conterminous US: a class is what the pixel looked like to the classifier, not a land use or zoning designation.",
        ...(r.value.value == null ? [`${whp ? "WHP" : "NLCD"} has no class here (outside the conterminous US, NoData, or a code its legend does not list).`] : []),
      ],
    },
  );
}

/**
 * Esri World Imagery Wayback's release index: [{release, date}] newest first, held a day.
 * Metadata only: the route never takes a URL and never fetches or caches a tile (the
 * browser loads them from Esri; the item's licence rules out exporting tiles offline).
 */
/** Esri's index, read once a day: the dated releases and each release's metadata service. */
function waybackIndex() {
  return cached("wayback-config", DAY, async () => {
    const j = await retrying(() => polite("esri-wayback", 500, 30_000, () => upstreamJson<unknown>("esri-wayback", WAYBACK_CONFIG, { timeoutMs: 20_000 })), 2);
    const releases = parseWaybackConfig(j);
    if (!releases.length) throw new UpstreamError("esri-wayback", 502, "esri-wayback: the release index listed no dated release");
    return { releases, metadata: [...waybackMetadataUrls(j).entries()] };
  });
}

async function opWayback(): Promise<Response> {
  const r = await waybackIndex();
  const releases = r.value.releases;
  return ok(
    { releases, newest: releases[0], oldest: releases[releases.length - 1], tiles: waybackTiles(0).replace("/tile/0/", "/tile/{release}/") },
    {
      meta: { source: source("esri-wayback").name, attribution: WAYBACK_ATTRIBUTION, cacheAge: r.age },
      ttlS: 3600,
      provenance: [
        provenance(source("esri-wayback"), {
          kind: "published",
          seriesId: "waybackconfig.json (release index)",
          upstreamUrl: WAYBACK_CONFIG,
          retrievedAt: new Date(Date.now() - r.age).toISOString(),
          notes: [`${releases.length} dated releases, ${releases[releases.length - 1].date} to ${releases[0].date}`],
        }),
      ],
      caveats: [WAYBACK_CAVEAT, "Tiles load from Esri directly; this route serves the release index only."],
    },
  );
}

const WAYBACKDATE_HELP = "op=waybackdate needs lon, lat and an integer z (0-23), and optionally release (an id from op=wayback; the newest when absent), e.g. release=63116&z=18&lon=-122.42&lat=37.77";

/**
 * When the pixels of a Wayback release were captured at a point: every row of that release's
 * imagery metadata at the layer for zoom z (23 - z), one neighbouring layer tried when the
 * rows' own bands miss z. The metadata URL comes from Esri's index by release id, never from
 * the caller. Held 7 days per release, layer and point (0.001 degrees): a release does not change.
 */
async function opWaybackDate(q: URLSearchParams): Promise<Response> {
  const lon = numParam(q.get("lon"));
  const lat = numParam(q.get("lat"));
  const z = intParam(q.get("z"));
  const relRaw = q.get("release");
  const asked = relRaw == null || relRaw.trim() === "" ? null : intParam(relRaw);
  if (lon == null || lat == null || Math.abs(lon) > 180 || Math.abs(lat) > 90 || z == null || z > 23 || (relRaw != null && relRaw.trim() !== "" && asked == null)) return badRequest(WAYBACKDATE_HELP);
  const idx = await waybackIndex();
  const release = asked ?? idx.value.releases[0].release;
  const meta = new Map(idx.value.metadata);
  const info = idx.value.releases.find((r) => r.release === release);
  const base = meta.get(release);
  if (!info || !base) return badRequest(`release ${release} is not in Esri's index (or has no imagery metadata service there)`, { newest: idx.value.releases[0] });
  const x = Number(lon.toFixed(3));
  const y = Number(lat.toFixed(3));
  const ask = (layer: number) =>
    cached(`wayback-date:${release}:${layer}:${x},${y}`, 7 * DAY, async () =>
      parseCaptures(
        await arcgisRows(
          "esri-wayback-metadata",
          `${base}/${layer}`,
          { where: "1=1", geometry: `${x},${y}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: WAYBACK_METADATA_FIELDS.join(","), returnGeometry: "false" },
          { gate: "esri-wayback-metadata", minIntervalMs: 200, timeoutMs: 20_000, tries: 2 },
        ),
      ),
    );
  let layer = metadataLayerFor(z);
  let r = await ask(layer);
  const next = neighbourLayer(r.value, z, layer);
  if (next != null) {
    const r2 = await ask(next);
    if (r2.value.length) {
      layer = next;
      r = r2;
    }
  }
  const captures = r.value;
  const caveats = [WAYBACK_CAPTURE_CAVEAT, "A capture date is when the pixels were taken; the release date is when Esri published the basemap that holds them."];
  if (!captures.length) caveats.push("Esri lists no capture date at this point for this release and zoom; that is not a guess of any date.");
  return ok(
    { lon: x, lat: y, z, release: info, layer, captures },
    {
      meta: { source: source("esri-wayback-metadata").name, attribution: WAYBACK_METADATA_ATTRIBUTION, cacheAge: r.age },
      ttlS: 86400,
      provenance: [
        provenance(source("esri-wayback-metadata"), {
          kind: "published",
          seriesId: `${base.split("/services/")[1]} layer ${layer}`,
          upstreamUrl: `${base}/${layer}`,
          retrievedAt: new Date(Date.now() - r.age).toISOString(),
          notes: [`point ${x},${y}`, `zoom ${z}`, `release ${info.date}`],
        }),
      ],
      caveats,
    },
  );
}

const TOPO_HELP = "op=topo needs lon and lat, e.g. lon=-122.42&lat=37.77";
/** The HTMC is closed (nothing after 2006): a point's sheets do not change. */
const TOPO_TTL = 30 * DAY;

/** The years and sheets of the USGS historical topographic maps at a point (snapped to 0.01 degrees). */
async function opTopo(q: URLSearchParams): Promise<Response> {
  const lon = numParam(q.get("lon"));
  const lat = numParam(q.get("lat"));
  if (lon == null || lat == null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return badRequest(TOPO_HELP);
  const x = Number((Math.round(lon * 100) / 100).toFixed(2));
  const y = Number((Math.round(lat * 100) / 100).toFixed(2));
  const htmcQuery = new URLSearchParams({
    where: "Category=1",
    geometry: `${x},${y}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: HTMC_FIELDS.join(","),
    returnGeometry: "false",
  });
  const tnmUrl = `${TNM_PRODUCTS}?${new URLSearchParams({ datasets: "Historical Topographic Maps", bbox: [Math.round(x * 1000) - 5, Math.round(y * 1000) - 5, Math.round(x * 1000) + 5, Math.round(y * 1000) + 5].map((v) => (v / 1000).toFixed(3)).join(","), max: "200", outputFormat: "JSON" })}`;
  const [sheetsR, tnmR] = await Promise.all([
    cached(`topo-sheets:${x},${y}`, TOPO_TTL, async () => {
      const rows = await arcgisRows("usgs-htmc", HTMC, Object.fromEntries(htmcQuery), { gate: "usgs-htmc", minIntervalMs: 200, timeoutMs: 20_000, tries: 2 });
      return parseHtmcSheets({ features: rows.map((attributes) => ({ attributes })) });
    }),
    // TNM only adds the download links; its failure never fails the op.
    cached(`topo-tnm:${x},${y}`, TOPO_TTL, async () => {
      const j = await retrying(() => polite("usgs-tnm", 300, 30_000, () => upstreamJson<unknown>("usgs-tnm", tnmUrl, { timeoutMs: 20_000 })), 2);
      return [...tnmFiles(j).entries()];
    }).catch(() => null),
  ]);
  const files: Map<number, TnmFiles> | null = tnmR ? new Map(tnmR.value) : null;
  const sheets = withTnmFiles(sheetsR.value, files);
  const years = topoYears(sheets);
  const caveats = [TOPO_CAVEAT];
  if (!sheets.length) caveats.push("No USGS topographic sheet in the collection covers this point (outside the United States, or open water off the coast).");
  if (!files) caveats.push("USGS TNM did not answer this time, so the sheets' GeoPDF and GeoTIFF links are missing (geopdf, geotiff: null); the sheets themselves are listed.");
  else if (sheets.some((s) => !s.geotiff)) caveats.push("A sheet with geotiff: null is one TNM did not list for this scan; it is not a sheet without a scan.");
  const prov = [
    provenance(source("usgs-htmc"), { kind: "published", seriesId: "USGS_Historical_Topographic_Maps ImageServer query (Category=1)", upstreamUrl: `${HTMC}/query`, retrievedAt: new Date(Date.now() - sheetsR.age).toISOString(), notes: [`point ${x},${y}`, `${sheets.length} sheets, ${years.length} edition years`] }),
  ];
  if (tnmR) prov.push(provenance(source("usgs-htmc"), { kind: "published", seriesId: "TNM Access products, Historical Topographic Maps (GeoPDF, GeoTIFF)", upstreamUrl: tnmUrl, retrievedAt: new Date(Date.now() - tnmR.age).toISOString() }));
  return ok(
    { lon: x, lat: y, years, sheets, tiles: topoTiles(0).replace("DateCurrent%3D0", "DateCurrent%3D{year}") },
    { meta: { source: source("usgs-htmc").name, attribution: HTMC_ATTRIBUTION, cacheAge: sheetsR.age }, ttlS: files ? 86400 : 600, provenance: prov, caveats },
  );
}

function opProducts(): Response {
  const rendered = Object.values(RENDER_PRODUCTS).map((p) => ({
    id: p.id,
    title: p.title,
    delivery: "route",
    tile: `/api/terrain?op=tile&product=${p.id}&z={z}&x={x}&y={y}`,
    tileSize: p.tileSize,
    minZoom: p.minZoom,
    maxZoom: p.maxZoom,
    edgeCacheS: p.ttlS,
    source: source(p.source),
    caveat: p.caveat,
  }));
  const direct = DIRECT_SOURCES.map((d) => ({ id: d.id, title: d.title, delivery: "direct", tile: d.template, host: d.host, maxZoom: d.maxZoom, source: source(d.source), note: d.note }));
  return ok(
    {
      products: [...rendered, ...direct],
      classes: { firehazard: WHP_CLASSES, landcover: NLCD_CLASSES, sealevel: SLR_LEGEND, wetlands: NWI_RASTER_CLASSES },
      sealevelFeet: SLR_FEET,
      caveats: { firehazard: WHP_CAVEAT, landslidesusc: LANDSLIDE_SUSC_CAVEAT, sealevel: SLR_CAVEAT, soils: SOIL_CAVEAT, wetlands: NWI_RASTER_CAVEAT },
      terrainAttribution: TERRARIUM_ATTRIBUTION,
    },
    { ttlS: 3600, provenance: [], caveats: ["The catalog of terrain pictures; each product's own source and caveat is on it."] },
  );
}

/** One Planetary Computer call through its gate (five a second), retrying a reset or a 5xx once. */
function pcJson<T>(url: string, body?: unknown): Promise<T> {
  const init = body === undefined ? { timeoutMs: 20_000 } : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, timeoutMs: 20_000 };
  return retrying(() => polite("planetary-computer", 200, 30_000, () => upstreamJson<T>("planetary-computer", url, init)), 2);
}

const NAIP_HELP = "op=naip needs lon and lat, e.g. lon=-93.62&lat=41.59";

/** NAIP years at a point: one STAC search (point snapped to 0.001 degrees), held 30 days. */
async function opNaip(q: URLSearchParams): Promise<Response> {
  const lon = numParam(q.get("lon"));
  const lat = numParam(q.get("lat"));
  if (lon == null || lat == null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return badRequest(NAIP_HELP);
  const x = Number(lon.toFixed(3));
  const y = Number(lat.toFixed(3));
  const r = await cached(`naip-years:${x},${y}`, 30 * DAY, async () => naipYears(await pcJson<unknown>(PC_STAC_SEARCH, stacBody(x, y))));
  const years = r.value;
  const caveats = [NAIP_CAVEAT];
  if (!years.length) caveats.push("Planetary Computer lists no NAIP photograph at this point: NAIP covers the conterminous United States.");
  return ok(
    { lon: x, lat: y, years },
    {
      meta: { source: "USDA FSA NAIP via Microsoft Planetary Computer (STAC search)", attribution: NAIP_ATTRIBUTION, cacheAge: r.age },
      ttlS: 7 * 86_400,
      provenance: [provenance(source("usda-naip-pc"), { kind: "published", seriesId: "STAC collection naip, items intersecting the point", upstreamUrl: PC_STAC_SEARCH, retrievedAt: new Date(Date.now() - r.age).toISOString(), notes: [`point ${x},${y}`, `${years.length} years`] })],
      caveats,
    },
  );
}

const NAIPMOSAIC_HELP = "op=naipmosaic needs year=yyyy, 2010 to this year, e.g. year=2023";

/** How long a /mosaic/{id}/info answer is trusted, and the deadlines that keep the op under 60 s. */
const NAIP_INFO_TTL_MS = 10 * 60_000;
const NAIP_REGISTER_DEADLINE_MS = 20_000;
const NAIP_INFO_DEADLINE_MS = 10_000;
const NAIP_REREGISTER_DEADLINE_MS = 15_000;
const NAIP_LISTED_DEADLINE_MS = 15_000;
/** When each year was last registered again after a "not found" (this instance). */
const naipReregisteredAt = new Map<number, number>();

/**
 * The per-year NAIP mosaic: Planetary Computer's searchid for the year's cql2 filter, registered
 * at run time and held 24 hours. A held id is checked (/mosaic/{id}/info, the answer held 10
 * minutes) and registered again when Planetary Computer answers that it does not know it, at
 * most once a year per NAIP_REREGISTER_COOLDOWN_MS; inside that the held id is served as is.
 * A check that fails any other way serves the held id: a timeout or a 5xx is not "forgotten".
 * Only a year the STAC search lists an item for is registered (asked once, held a day); a year
 * it lists none for is a 400, so the year this is written in is refused until NAIP publishes it.
 * A search that fails is not "none": the op goes on as before (meta.yearChecked false).
 */
async function opNaipMosaic(q: URLSearchParams): Promise<Response> {
  const year = parseNaipYear(q.get("year"));
  if (year == null) return badRequest(NAIPMOSAIC_HELP);
  // Only a definite "no item" is refused; a search that times out or fails is not "unlisted", so the
  // held id is served (or the year registered) as before, with meta.yearChecked false.
  const listed = await cached(`naip-year-listed:${year}`, DAY, async () => naipYearListed(await pcJson<unknown>(PC_STAC_SEARCH, stacYearBody(year)), year), {
    deadlineMs: NAIP_LISTED_DEADLINE_MS,
    coolMs: 60_000,
  }).catch(() => null);
  if (listed && !listed.value) return badRequest(naipUnlistedMessage(year));
  const yearChecked = listed != null;
  const key = `naip-mosaic:${year}`;
  const register = async () => {
    const id = parseSearchId(await pcJson<unknown>(`${PC_MOSAIC}/register`, registerBody(year)));
    if (!id) throw new UpstreamError("planetary-computer", 502, "planetary-computer: register answered no searchid");
    return id;
  };
  let r = await cached(key, DAY, register, { deadlineMs: NAIP_REGISTER_DEADLINE_MS });
  let reregistered = false;
  let reregisterCooling = false;
  let infoChecked = true;
  if (r.hit) {
    const infoKey = `naip-mosaic-info:${r.value}`;
    const known = await cached(
      infoKey,
      NAIP_INFO_TTL_MS,
      async () => {
        try {
          await pcJson<unknown>(`${PC_MOSAIC}/${r.value}/info`);
          return true;
        } catch (err) {
          if (err instanceof UpstreamError && isSearchIdNotFound(err.status, { detail: err.message })) return false;
          throw err;
        }
      },
      { deadlineMs: NAIP_INFO_DEADLINE_MS, coolMs: 60_000 },
    ).catch(() => null);
    if (known == null) infoChecked = false;
    else if (!known.value && Date.now() - (naipReregisteredAt.get(year) ?? -Infinity) < NAIP_REREGISTER_COOLDOWN_MS) {
      // Registered again moments ago and still "not found": serve the held id rather than loop.
      reregisterCooling = true;
    } else if (!known.value) {
      naipReregisteredAt.set(year, Date.now());
      cacheDelete(key);
      r = await cached(key, DAY, register, { deadlineMs: NAIP_REREGISTER_DEADLINE_MS });
      // The new id (often the same one: Planetary Computer derives it from the body) is checked afresh next time.
      cacheDelete(infoKey);
      reregistered = true;
    }
  }
  return ok(
    { year, searchid: r.value, tiles: naipTiles(r.value), minZoom: 11 },
    {
      meta: { source: "USDA FSA NAIP via Microsoft Planetary Computer (mosaic register)", attribution: NAIP_ATTRIBUTION, reregistered, reregisterCooling, infoChecked, yearChecked, cacheAge: r.age },
      ttlS: 3600,
      provenance: [provenance(source("usda-naip-pc"), { kind: "published", seriesId: `mosaic/register: collection = naip and naip:year = "${year}"`, upstreamUrl: `${PC_MOSAIC}/register`, retrievedAt: new Date(Date.now() - r.age).toISOString() })],
      caveats: [NAIP_CAVEAT, "Tiles load from Planetary Computer directly, below level 11 none (it answers 204). The searchid is Planetary Computer's and can change; ask this op again rather than keeping it."],
    },
  );
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "tile":
        return await opTile(q);
      case "point":
        return await opPoint(q);
      case "products":
        return opProducts();
      case "wayback":
        return await opWayback();
      case "topo":
        return await opTopo(q);
      case "waybackdate":
        return await opWaybackDate(q);
      case "naip":
        return await opNaip(q);
      case "naipmosaic":
        return await opNaipMosaic(q);
      default:
        return badRequest("unknown op: tile | point | products | wayback | topo | waybackdate | naip | naipmosaic");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
