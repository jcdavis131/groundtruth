// USGS Historical Topographic Map Collection (HTMC): every scale and edition
// of the topographic map USGS published, 1879-2006, scanned and served by
// Esri's USGS_Historical_Topographic_Maps ImageServer, one edition year at a
// time. Pure: the tile template for a year, the point-query parser (the
// years and sheets under a point), and the match of each sheet to its GeoTIFF
// in USGS TNM Access by scan id.
//
// The years offered are the years with a sheet at the view centre: an
// exportImage for a year with no sheet under the tile answers a blank PNG,
// and so does a tile coarser than the sheet's MaxPS (a 20 km tile came back
// as a 334-byte blank on 2026-10-13), hence the floor at level 11.

/** Esri's HTMC ImageServer (Living Atlas item ee19794feeed4e068ba99b2ddcb6c2db points at it). */
export const HTMC = "https://historical1.arcgis.com/arcgis/rest/services/USGS_Historical_Topographic_Maps/ImageServer";
export const HTMC_HOST = "historical1.arcgis.com";
/** USGS TNM Access products API: each sheet's GeoPDF and GeoTIFF on prd-tnm S3. */
export const TNM_PRODUCTS = "https://tnmaccess.nationalmap.gov/api/v1/products";
/** The service's own copyrightText (read 2026-10-13), used as the credit. */
export const HTMC_ATTRIBUTION = "Historical Topographic Map Collection courtesy of the U.S. Geological Survey, Esri";
/** Tiles coarser than this draw nothing (a 1:62,500 sheet needs about 77 m a pixel or finer). */
export const TOPO_MIN_ZOOM = 11;
export const TOPO_MAX_ZOOM = 16;
/** The collection is closed: nothing after 2006. */
export const TOPO_FIRST_YEAR = 1879;
export const TOPO_LAST_YEAR = 2006;
/**
 * The fields the point query asks for (named, never *). Download_GeoPDF is not asked for:
 * its host (ims.er.usgs.gov) no longer resolves (2026-10-13); both files come from TNM.
 */
export const HTMC_FIELDS = ["OBJECTID", "Scan_Id", "DateCurrent", "Map_Scale", "Map_Name", "Citation", "Imprint_Year", "Survey_Year"] as const;

export const TOPO_CAVEAT =
  "USGS topographic maps as published, 1879-2006, one edition at a time. A map shows what USGS surveyed or revised for that edition; the edition year is not a survey date, and parts of a sheet can be decades older. Sheets of different scales and editions can sit side by side. Sheet collars and stamps are part of the scan. Draws only when zoomed in.";

/** A whole year inside the collection's range, else null. */
export function parseTopoYear(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= TOPO_FIRST_YEAR && n <= TOPO_LAST_YEAR ? n : null;
}

/** Esri's mosaic rule for one edition year: the most detailed scale on top. */
export function topoMosaicRule(year: number): string {
  return JSON.stringify({ mosaicMethod: "esriMosaicAttribute", sortField: "Map_Scale", sortValue: "0", ascending: true, where: `Category=1 AND DateCurrent=${year}` });
}

/**
 * The exportImage tile template for one edition year, Web Mercator. The mosaic rule is
 * percent-encoded whole, so the only braces left are the imagery provider's own tokens.
 * jpgpng: JPEG where the tile is covered, PNG (transparent) at sheet edges.
 */
export function topoTiles(year: number): string {
  return `${HTMC}/exportImage?bbox={westProjected},{southProjected},{eastProjected},{northProjected}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image&mosaicRule=${encodeURIComponent(topoMosaicRule(year))}`;
}

export interface TopoSheet {
  /** HTMC OBJECTID. */
  id: number;
  /** USGS scan id; the key into TNM's file names. */
  scanId: number | null;
  name: string | null;
  /** Edition year (DateCurrent): what the year picker selects. */
  year: number;
  /** Scale denominator, e.g. 24000 for 1:24,000. */
  scale: number | null;
  imprintYear: number | null;
  surveyYear: number | null;
  /** USGS's citation, verbatim. */
  citation: string | null;
  /** The sheet's GeoPDF and GeoTIFF in TNM (prd-tnm S3), matched by scan id; null when TNM did not list it. */
  geopdf: string | null;
  geotiff: string | null;
}

export interface TopoYear {
  year: number;
  scales: number[];
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}
function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

/**
 * HTMC point-query rows (f=json) -> sheets, newest edition first, then larger scale first.
 * A row with no edition year is dropped, never given one.
 */
export function parseHtmcSheets(j: unknown): TopoSheet[] {
  const feats = (j as { features?: Array<{ attributes?: Record<string, unknown> }> } | null)?.features ?? [];
  const out: TopoSheet[] = [];
  for (const f of feats) {
    const a = f.attributes ?? {};
    const year = int(a.DateCurrent);
    const id = int(a.OBJECTID);
    if (year == null || id == null) continue;
    out.push({
      id,
      scanId: typeof a.Scan_Id === "number" && Number.isFinite(a.Scan_Id) ? Math.round(a.Scan_Id) : null,
      name: text(a.Map_Name),
      year,
      scale: int(a.Map_Scale),
      imprintYear: int(a.Imprint_Year),
      surveyYear: int(a.Survey_Year),
      citation: text(a.Citation),
      geopdf: null,
      geotiff: null,
    });
  }
  return out.sort((x, y) => y.year - x.year || (x.scale ?? Infinity) - (y.scale ?? Infinity) || x.id - y.id);
}

/** The edition years under a point, oldest first, each with its scales (largest scale first). */
export function topoYears(sheets: TopoSheet[]): TopoYear[] {
  const by = new Map<number, Set<number>>();
  for (const s of sheets) {
    if (!by.has(s.year)) by.set(s.year, new Set());
    if (s.scale != null) by.get(s.year)!.add(s.scale);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([year, scales]) => ({ year, scales: [...scales].sort((a, b) => a - b) }));
}

export interface TnmFiles {
  geotiff: string | null;
  geopdf: string | null;
}

const S3 = /^https:\/\/prd-tnm\.s3\.amazonaws\.com\//;

/**
 * TNM products -> scan id -> the sheet's files, the scan id read from the file name
 * "..._<scanId>_<year>_<scale>_geo.tif|pdf". Only prd-tnm S3 links are kept.
 */
export function tnmFiles(j: unknown): Map<number, TnmFiles> {
  const items = (j as { items?: Array<{ urls?: { GeoTIFF?: unknown; GeoPDF?: unknown } }> } | null)?.items ?? [];
  const out = new Map<number, TnmFiles>();
  for (const it of items) {
    const tif = typeof it?.urls?.GeoTIFF === "string" && S3.test(it.urls.GeoTIFF) ? it.urls.GeoTIFF : null;
    const pdf = typeof it?.urls?.GeoPDF === "string" && S3.test(it.urls.GeoPDF) ? it.urls.GeoPDF : null;
    const m = (tif ?? pdf)?.match(/_(\d+)_\d{4}_\d+_geo\.(tif|pdf)$/);
    if (m) out.set(Number(m[1]), { geotiff: tif, geopdf: pdf });
  }
  return out;
}

/** Sheets with their TNM files where TNM lists the same scan; a miss stays null. */
export function withTnmFiles(sheets: TopoSheet[], files: Map<number, TnmFiles> | null): TopoSheet[] {
  if (!files) return sheets;
  return sheets.map((s) => {
    const f = s.scanId != null ? files.get(s.scanId) : undefined;
    return { ...s, geotiff: f?.geotiff ?? null, geopdf: f?.geopdf ?? null };
  });
}

/** "1:24,000" */
export function scaleText(scale: number | null): string {
  return scale == null ? "scale not given" : `1:${scale.toLocaleString("en-US")}`;
}

/** The picker's label for a year: "1956 (1:24,000, 1:62,500)". */
export function yearLabel(y: TopoYear): string {
  return y.scales.length ? `${y.year} (${y.scales.map(scaleText).join(", ")})` : String(y.year);
}

/**
 * The edition to draw: the one asked for (kept even where this view has no sheet of it,
 * so a link's year survives a pan), else the newest at the view centre.
 * `present` says whether the asked year has a sheet at the centre; `nearest` the closest years that do.
 */
export function resolveTopoYear(years: TopoYear[], wanted: unknown): { year: number | null; present: boolean; nearest: number[] } {
  const asked = parseTopoYear(wanted);
  if (asked == null) {
    const newest = years.length ? years[years.length - 1].year : null;
    return { year: newest, present: newest != null, nearest: [] };
  }
  if (years.some((y) => y.year === asked)) return { year: asked, present: true, nearest: [] };
  const nearest = [...years].sort((a, b) => Math.abs(a.year - asked) - Math.abs(b.year - asked) || a.year - b.year).slice(0, 2).map((y) => y.year).sort((a, b) => a - b);
  return { year: asked, present: false, nearest };
}

/** One sheet's line in the ground dossier. */
export function sheetText(s: TopoSheet): string {
  const years = [s.imprintYear != null ? `printed ${s.imprintYear}` : null, s.surveyYear != null ? `surveyed ${s.surveyYear}` : null].filter(Boolean).join(", ");
  return `${s.name ?? "sheet not named"} · ${scaleText(s.scale)} · ${s.year} edition${years ? ` (${years})` : ""}`;
}
