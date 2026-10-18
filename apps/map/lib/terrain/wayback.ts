// Esri World Imagery Wayback: every published release of the World Imagery
// basemap since 2014-02-20, as its own tile set. Pure: the release index
// parser, the tile template, and which release a link or a preference means.
//
// The index (waybackconfig.json) is read by /api/terrain?op=wayback and held
// a day; the tiles are loaded by the browser straight from Esri, never
// proxied or cached here (the item's licence: "not intended to be used to
// export tiles for offline"). A release date is when Esri published that
// version of the basemap, not when its pixels were captured.

export const WAYBACK_CONFIG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";
export const WAYBACK_HOST = "wayback.maptiles.arcgis.com";
export const WAYBACK_MAX_ZOOM = 19;
/** The Wayback item's own attribution (ArcGIS item ab83ada1bd3145978eecfb115aaa10c3, accessInformation, 2026-10-12). */
export const WAYBACK_ATTRIBUTION = "Esri, Vantor, Earthstar Geographics, and the GIS User Community";

export const WAYBACK_CAVEAT =
  "Esri World Imagery as published on each release date, 2014-02-20 onward. A release date is not a capture date: pixels can be years older, and an area that did not change shows the same image across releases. This is not pre-2014 aerial history.";

/** The tile template of one release: Esri's WMTS REST path, {z}/{y}/{x}. */
export function waybackTiles(release: number): string {
  return `https://${WAYBACK_HOST}/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/{z}/{y}/{x}`;
}

export interface WaybackRelease {
  /** Esri's release number (the {release} in the tile path). */
  release: number;
  /** Release date, YYYY-MM-DD, from the item title "World Imagery (Wayback YYYY-MM-DD)". */
  date: string;
}

/**
 * waybackconfig.json -> releases, newest first. An entry whose key is not a release number
 * or whose title carries no date is dropped, never guessed.
 */
export function parseWaybackConfig(j: unknown): WaybackRelease[] {
  if (!j || typeof j !== "object" || Array.isArray(j)) return [];
  const out: WaybackRelease[] = [];
  for (const [k, v] of Object.entries(j as Record<string, { itemTitle?: unknown }>)) {
    if (!/^\d{1,9}$/.test(k)) continue;
    const m = typeof v?.itemTitle === "string" ? v.itemTitle.match(/\(Wayback (\d{4})-(\d{2})-(\d{2})\)/) : null;
    if (!m) continue;
    const [, y, mo, d] = m;
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) continue;
    out.push({ release: Number(k), date: `${y}-${mo}-${d}` });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.release - a.release));
}

/** A release id from a link or a preference: a positive whole number, else null. */
export function parseReleaseId(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 && v < 1e9 ? v : null;
  if (typeof v !== "string" || !/^\d{1,9}$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return n > 0 ? n : null;
}

/**
 * The release to draw: the one asked for when Esri lists it, else the newest, saying that
 * it fell back (`fallback`: an id was asked for that the index does not hold).
 */
export function resolveRelease(list: WaybackRelease[], wanted: unknown): { release: WaybackRelease | null; fallback: boolean } {
  if (!list.length) return { release: null, fallback: false };
  const id = parseReleaseId(wanted);
  if (id == null) return { release: list[0], fallback: false };
  const hit = list.find((r) => r.release === id);
  return hit ? { release: hit, fallback: false } : { release: list[0], fallback: true };
}

// ---------------------------------------------------------------- capture dates

/**
 * Each release's imagery metadata service (World_Imagery_Metadata_<YYYY>_r<NN>): polygons
 * saying which capture each region of that release came from, in 14 resolution bands
 * (layer 0 the finest, 1.9 cm, to layer 13, 150 m). The route reads the URL from Esri's
 * own index by release id and never takes one from the caller.
 */
export const WAYBACK_METADATA_URL = /^https:\/\/metadata\.maptiles\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery_Metadata_[A-Za-z0-9_]+\/MapServer$/;
/** The metadata services' own copyrightText (read 2026-10-13, as published). */
export const WAYBACK_METADATA_ATTRIBUTION = "Esri, DigitalGlobe, Earthstar Geograpics, CNES/Airbus DS, USDA FSA, USGS, Aerogrid, IGN, IGP, and the GIS User Community";
export const WAYBACK_CAPTURE_CAVEAT =
  "Capture dates are Esri's own metadata for the release shown. A point can sit on more than one capture. Esri publishes no capture metadata for some areas.";
/** The metadata layers: 0 (finest) to 13. */
export const WAYBACK_METADATA_LAYERS = 14;
/** The fields the capture query asks for (named, never *). */
export const WAYBACK_METADATA_FIELDS = ["SRC_DATE", "SRC_DATE2", "SRC_RES", "SRC_ACC", "SRC_DESC", "NICE_NAME", "NICE_DESC", "MinMapLevel", "MaxMapLevel", "DrawOrder"] as const;

/**
 * waybackconfig.json -> release -> its metadata service URL. An entry whose URL is not one of
 * Esri's metadata services is left out (its imagery stays in the picker; only its dates are unknown).
 */
export function waybackMetadataUrls(j: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!j || typeof j !== "object" || Array.isArray(j)) return out;
  for (const [k, v] of Object.entries(j as Record<string, { metadataLayerUrl?: unknown }>)) {
    if (!/^\d{1,9}$/.test(k)) continue;
    const u = v?.metadataLayerUrl;
    if (typeof u === "string" && WAYBACK_METADATA_URL.test(u)) out.set(Number(k), u);
  }
  return out;
}

/** The metadata layer for a zoom level: 23 - z, inside 0..13 (z 19 -> layer 4, z 18 -> layer 5). */
export function metadataLayerFor(z: number): number {
  return Math.min(WAYBACK_METADATA_LAYERS - 1, Math.max(0, 23 - z));
}

/**
 * The tile level the globe draws imagery at from a camera height, roughly: a 256 px Web
 * Mercator tile at that level is about as fine as a screen pixel looking straight down
 * through a 60 degree field of view on a 1,000 px wide view. An estimate, said as one.
 */
export function zoomForHeight(heightM: number, lat: number): number {
  const h = Math.max(1, heightM);
  const metresPerScreenPx = (2 * h * Math.tan(Math.PI / 6)) / 1000;
  const z = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / metresPerScreenPx);
  return Math.min(23, Math.max(0, Math.round(z)));
}

export interface WaybackCapture {
  /** Capture date, YYYY-MM-DD, from SRC_DATE (yyyymmdd); null when it does not parse. */
  date: string | null;
  /** Ground resolution in metres per pixel (SRC_RES). */
  resolutionM: number | null;
  /** Horizontal accuracy in metres (SRC_ACC). */
  accuracyM: number | null;
  /** Esri's source code for the capture (SRC_DESC), e.g. "UC-G". */
  sourceCode: string | null;
  /** Esri's name for the collection (NICE_NAME); a blank is null. */
  name: string | null;
  /** Provider (NICE_DESC), e.g. "Microsoft", "Vantor". */
  provider: string | null;
  /** The zoom levels this capture is drawn at in that release. */
  levels: [number, number] | null;
  drawOrder: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

/** 20101026 -> "2010-10-26"; anything else is null. */
export function srcDate(v: unknown): string | null {
  const m = String(v ?? "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  if (Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Metadata point-query rows (f=json attributes) -> captures, oldest first. Every row is kept. */
export function parseCaptures(rows: Array<Record<string, unknown>>): WaybackCapture[] {
  const out = rows.map((a) => {
    const lo = num(a.MinMapLevel);
    const hi = num(a.MaxMapLevel);
    return {
      date: srcDate(a.SRC_DATE),
      resolutionM: num(a.SRC_RES) != null ? Math.round(num(a.SRC_RES)! * 1000) / 1000 : null,
      accuracyM: num(a.SRC_ACC) != null ? Math.round(num(a.SRC_ACC)! * 100) / 100 : null,
      sourceCode: str(a.SRC_DESC),
      name: str(a.NICE_NAME),
      provider: str(a.NICE_DESC),
      levels: lo != null && hi != null ? ([lo, hi] as [number, number]) : null,
      drawOrder: num(a.DrawOrder),
    };
  });
  return out.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
}

/**
 * Whether the rows' bands miss z, and which neighbouring layer to try once: the finer one
 * (index - 1) when every band stops below z, the coarser one (index + 1) when every band starts above it.
 */
export function neighbourLayer(captures: WaybackCapture[], z: number, index: number): number | null {
  const banded = captures.filter((c) => c.levels);
  if (!banded.length || banded.some((c) => c.levels![0] <= z && z <= c.levels![1])) return null;
  if (banded.every((c) => c.levels![1] < z)) return index > 0 ? index - 1 : null;
  if (banded.every((c) => c.levels![0] > z)) return index < WAYBACK_METADATA_LAYERS - 1 ? index + 1 : null;
  return null;
}

/** The ground dossier line: "captured 2010-10-26 and 2010-11-02 · 0.3 m · Microsoft (UC-G)". */
export function captureText(cs: WaybackCapture[]): string {
  if (!cs.length) return "Esri lists no capture date here";
  const dates = [...new Set(cs.map((c) => c.date ?? "date not given"))];
  const res = [...new Set(cs.map((c) => c.resolutionM).filter((r): r is number => r != null))].map((r) => `${r} m`);
  const who = [...new Set(cs.map((c) => [c.provider, c.sourceCode ? `(${c.sourceCode})` : null].filter(Boolean).join(" ")).filter(Boolean))];
  const join = (a: string[]) => (a.length <= 2 ? a.join(" and ") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
  return [`captured ${join(dates)}`, res.length ? res.join(", ") : null, who.length ? who.join("; ") : null].filter(Boolean).join(" · ");
}

/** Releases grouped by year, newest year first (the picker's optgroups). */
export function releasesByYear(list: WaybackRelease[]): Array<{ year: string; releases: WaybackRelease[] }> {
  const by = new Map<string, WaybackRelease[]>();
  for (const r of list) {
    const y = r.date.slice(0, 4);
    if (!by.has(y)) by.set(y, []);
    by.get(y)!.push(r);
  }
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([year, releases]) => ({ year, releases }));
}
