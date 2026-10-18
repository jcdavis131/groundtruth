// NAIP aerial photographs by year (USDA Farm Service Agency's National
// Agriculture Imagery Program), 2010 onward, through Microsoft Planetary
// Computer. Pure: the STAC search body, the years-at-a-point parser, the
// per-year mosaic register body and the tile template.
//
//   years   POST /api/stac/v1/search {collections: ["naip"], intersects: point}
//           -> one row per year with each item's acquisition date and id
//   listed  POST /api/stac/v1/search {collections: ["naip"], query: naip:year}
//           limit 1 -> whether the year has any item; no item, no register
//   mosaic  POST /api/data/v1/mosaic/register with a cql2-json filter on
//           collection = naip and naip:year = "<yyyy>" (a string) -> searchid;
//           ids are registered at run time, never hard-coded (round 2 saw a
//           different id for the same body than this round did)
//   tiles   /api/data/v1/mosaic/{searchid}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x
//           loaded by the browser from Planetary Computer (CORS *); a tile below
//           level 11 answers 204 (no content), so the floor is 11
//
// NAIP is flown state by state, so the years differ by place (Des Moines 8,
// San Francisco 6, DC 11, Austin 6 in the imagery lane's probes).

export const PC_STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
export const PC_MOSAIC = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic";
export const PC_HOST = "planetarycomputer.microsoft.com";
export const NAIP_MIN_ZOOM = 11;
export const NAIP_MAX_ZOOM = 18;
export const NAIP_FIRST_YEAR = 2010;

export const NAIP_ATTRIBUTION = "USDA Farm Service Agency, National Agriculture Imagery Program (NAIP), via Microsoft Planetary Computer";

export const NAIP_CAVEAT =
  "Agricultural-season aerial photographs flown state by state, so the years available differ by place. Each year is a mosaic of flights; the date on click is the photo under the cursor. Not every state was flown every year.";

/** A whole year from NAIP_FIRST_YEAR to this year, else null (no year ahead is flown, so none is registered). */
export function parseNaipYear(v: unknown, now = new Date()): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= NAIP_FIRST_YEAR && n <= now.getUTCFullYear() ? n : null;
}

/** The STAC search for every NAIP item at a point (100 is more than any place has: 6-11 years, one item each). */
export function stacBody(lon: number, lat: number, year?: number): Record<string, unknown> {
  const body: Record<string, unknown> = { collections: ["naip"], intersects: { type: "Point", coordinates: [lon, lat] }, limit: 100 };
  if (year != null) body.query = { "naip:year": { eq: String(year) } };
  return body;
}

/**
 * The STAC search that says whether a year has any NAIP item anywhere: one item is enough. The
 * year this is written in can pass parseNaipYear long before it is published (2025 and 2026 had
 * none on 2026-10-16), so a year is registered only after this answers an item.
 */
export function stacYearBody(year: number): Record<string, unknown> {
  return { collections: ["naip"], query: { "naip:year": { eq: String(year) } }, limit: 1 };
}

/** True when a stacYearBody answer lists at least one item of that year. */
export function naipYearListed(j: unknown, year: number): boolean {
  const feats = (j as { features?: Array<{ properties?: Record<string, unknown> }> } | null)?.features ?? [];
  return feats.some((f) => parseNaipYear(f.properties?.["naip:year"]) === year);
}

/** op=naipmosaic's 400 for a year with no NAIP item anywhere; the layer reads it back by NAIP_UNLISTED. */
export const NAIP_UNLISTED = "Planetary Computer lists no NAIP item for";
export function naipUnlistedMessage(year: number): string {
  return `op=naipmosaic: ${NAIP_UNLISTED} ${year}, so there is no ${year} mosaic to register; op=naip gives the years flown at a point.`;
}

/** At most one register again per year in this long when Planetary Computer keeps answering "not found". */
export const NAIP_REREGISTER_COOLDOWN_MS = 10 * 60_000;

/** The mosaic register body for one year: naip:year is a string in the collection. */
export function registerBody(year: number): Record<string, unknown> {
  return {
    "filter-lang": "cql2-json",
    filter: { op: "and", args: [{ op: "=", args: [{ property: "collection" }, "naip"] }, { op: "=", args: [{ property: "naip:year" }, String(year)] }] },
  };
}

/** A searchid as Planetary Computer issues them (32 hex). */
export function isSearchId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{32}$/.test(v);
}

export function parseSearchId(j: unknown): string | null {
  const id = (j as { searchid?: unknown; id?: unknown } | null)?.searchid ?? (j as { id?: unknown } | null)?.id;
  return isSearchId(id) ? id : null;
}

/** Planetary Computer's answer for an id it does not hold: {"detail": "SearchId `...` not found"}. */
export function isSearchIdNotFound(status: number, body: unknown): boolean {
  const d = (body as { detail?: unknown } | null)?.detail;
  return status === 404 && typeof d === "string" && /SearchId .* not found/.test(d);
}

/** The XYZ template for a registered year (RGB, PNG). */
export function naipTiles(searchid: string): string {
  return `${PC_MOSAIC}/${searchid}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?collection=naip&assets=image&asset_bidx=image%7C1%2C2%2C3&format=png`;
}

export interface NaipItem {
  /** STAC item id, e.g. ia_m_4109328_nw_15_030_20230902_20240104. */
  id: string;
  /** Acquisition date, YYYY-MM-DD (STAC datetime). */
  date: string;
  /** Ground sample distance, m. */
  gsd: number | null;
  /** Two-letter state as NAIP records it, upper case. */
  state: string | null;
}

export interface NaipYear {
  year: number;
  items: NaipItem[];
}

/**
 * STAC items at a point -> years, oldest first, each item once (the same quarter-quad can be
 * listed twice for a year when it was re-released); an item with no naip:year or no datetime is
 * dropped, never given one.
 */
export function naipYears(j: unknown): NaipYear[] {
  const feats = (j as { features?: Array<{ id?: unknown; properties?: Record<string, unknown> }> } | null)?.features ?? [];
  const by = new Map<number, Map<string, NaipItem>>();
  for (const f of feats) {
    const p = f.properties ?? {};
    const year = parseNaipYear(p["naip:year"]);
    const dt = typeof p.datetime === "string" && /^\d{4}-\d{2}-\d{2}/.test(p.datetime) ? p.datetime.slice(0, 10) : null;
    if (year == null || !dt || typeof f.id !== "string") continue;
    if (!by.has(year)) by.set(year, new Map());
    by.get(year)!.set(f.id, {
      id: f.id,
      date: dt,
      gsd: typeof p.gsd === "number" && Number.isFinite(p.gsd) ? p.gsd : null,
      state: typeof p["naip:state"] === "string" ? (p["naip:state"] as string).toUpperCase() : null,
    });
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([year, items]) => ({ year, items: [...items.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) }));
}

/** The year to draw: the one asked for (kept where this view has none, so a link survives a pan), else the newest here. */
export function resolveNaipYear(years: NaipYear[], wanted: unknown): { year: number | null; present: boolean } {
  const asked = parseNaipYear(wanted);
  if (asked == null) {
    const newest = years.length ? years[years.length - 1].year : null;
    return { year: newest, present: newest != null };
  }
  return { year: asked, present: years.some((y) => y.year === asked) };
}

/** The click dossier's line for a year at a point. */
export function naipItemText(y: NaipYear): string {
  return y.items.map((i) => `flown ${i.date}${i.gsd != null ? `, ${i.gsd} m` : ""}${i.state ? `, ${i.state}` : ""} (${i.id})`).join("; ");
}
