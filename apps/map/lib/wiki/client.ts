// Server-side Wikipedia client. Keyless MediaWiki / Wikimedia APIs only.
//
//   geosearch   en.wikipedia.org/w/api.php generator=geosearch around a point
//   summary     en.wikipedia.org/api/rest_v1/page/summary/<title>
//   on this day api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/MM/DD
//
// The parsers are pure and tolerate missing fields: an article with no
// coordinates is dropped from geosearch (it cannot be drawn), a page with
// no coordinates in an On this day item is kept (the layer picks the first
// page that has them). Honest failure: a 404 summary is null (no article),
// every other upstream failure throws.

import { cached } from "@/lib/server/cache";
import { polite, upstream, upstreamJson, UpstreamError } from "@/lib/server/upstream";
import type { WikiArticle, WikiDayItem, WikiSummary } from "./types";

const API = "https://en.wikipedia.org/w/api.php";
const REST = "https://en.wikipedia.org/api/rest_v1";
const FEED = "https://api.wikimedia.org/feed/v1/wikipedia/en";

/** Plain text from a field that may carry HTML (display titles do). */
export function stripHtml(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finite(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Great-circle distance in metres between two WGS84 points. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function wikiUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

interface RawPage {
  pageid?: unknown;
  title?: unknown;
  normalizedtitle?: unknown;
  titles?: { canonical?: unknown; normalized?: unknown; display?: unknown };
  coordinates?: Array<{ lat?: unknown; lon?: unknown }> | { lat?: unknown; lon?: unknown };
  extract?: unknown;
  canonicalurl?: unknown;
  fullurl?: unknown;
  content_urls?: { desktop?: { page?: unknown } };
  description?: unknown;
  index?: unknown;
}

function pageTitle(p: RawPage): string {
  return stripHtml(p.titles?.canonical ?? p.title ?? p.normalizedtitle ?? p.titles?.normalized ?? "");
}

function pageCoords(p: RawPage): { lat: number; lon: number } | undefined {
  const c = Array.isArray(p.coordinates) ? p.coordinates[0] : p.coordinates;
  const lat = finite(c?.lat);
  const lon = finite(c?.lon);
  return lat != null && lon != null ? { lat, lon } : undefined;
}

function pageUrl(p: RawPage, title: string): string {
  const u = p.content_urls?.desktop?.page ?? p.canonicalurl ?? p.fullurl;
  return typeof u === "string" && /^https?:\/\//.test(u) ? u : wikiUrl(title);
}

/**
 * Geosearch answer -> articles. `origin` is the point the search was
 * centred on; when given, each article carries its real distance from it
 * (the generator form of geosearch does not return distances).
 */
export function parseGeosearch(json: unknown, origin?: { lat: number; lon: number }): WikiArticle[] {
  const pages = (json as { query?: { pages?: Record<string, RawPage> | RawPage[] } } | null)?.query?.pages;
  if (!pages) return [];
  const list = Array.isArray(pages) ? pages : Object.values(pages);
  const withIndex: Array<{ a: WikiArticle; index: number }> = [];
  for (const p of list) {
    const title = pageTitle(p);
    const coords = pageCoords(p);
    const pageid = finite(p.pageid);
    if (!title || !coords || pageid == null) continue;
    const extract = stripHtml(p.extract);
    withIndex.push({
      index: finite(p.index) ?? Number.MAX_SAFE_INTEGER,
      a: {
        pageid,
        title,
        lat: coords.lat,
        lon: coords.lon,
        ...(origin ? { distM: Math.round(haversineM(origin.lat, origin.lon, coords.lat, coords.lon)) } : {}),
        ...(extract ? { extract } : {}),
        url: pageUrl(p, title),
      },
    });
  }
  withIndex.sort((x, y) => x.index - y.index || (x.a.distM ?? 0) - (y.a.distM ?? 0));
  return withIndex.map((x) => x.a);
}

/** REST summary answer -> summary, or null when it carries no article. */
export function parseSummary(json: unknown): WikiSummary | null {
  if (!json || typeof json !== "object") return null;
  const p = json as RawPage & { type?: unknown };
  const title = pageTitle(p);
  const extract = stripHtml(p.extract);
  if (!title) return null;
  const coords = pageCoords(p);
  const description = stripHtml(p.description);
  return {
    title,
    extract,
    url: pageUrl(p, title),
    ...(description ? { description } : {}),
    ...(coords ? { lat: coords.lat, lon: coords.lon } : {}),
  };
}

const DAY_TYPES = [
  ["selected", "selected"],
  ["events", "event"],
  ["births", "birth"],
  ["deaths", "death"],
] as const;

/** On this day feed -> dated items (holidays carry no year and are left off). */
export function parseOnThisDay(json: unknown): WikiDayItem[] {
  if (!json || typeof json !== "object") return [];
  const feed = json as Record<string, unknown>;
  const out: WikiDayItem[] = [];
  for (const [key, type] of DAY_TYPES) {
    const items = feed[key];
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      const it = raw as { text?: unknown; year?: unknown; pages?: RawPage[] };
      const year = finite(it.year);
      const text = stripHtml(it.text);
      if (year == null || !text) continue;
      const pages: WikiDayItem["pages"] = [];
      for (const p of it.pages ?? []) {
        const title = pageTitle(p);
        if (!title) continue;
        const coords = pageCoords(p);
        const extract = stripHtml(p.extract);
        pages.push({
          title,
          url: pageUrl(p, title),
          ...(extract ? { extract } : {}),
          ...(coords ? { lat: coords.lat, lon: coords.lon } : {}),
        });
      }
      out.push({ year, text, type, pages });
    }
  }
  return out;
}

export interface NearbyOptions {
  radiusM?: number;
  limit?: number;
}

/** Geotagged articles within `radiusM` (max 10 km, the API's cap) of a point. */
export async function wikiNearby(lat: number, lon: number, opts: NearbyOptions = {}): Promise<WikiArticle[]> {
  const radiusM = Math.min(10_000, Math.max(500, Math.round(opts.radiusM ?? 10_000)));
  const limit = Math.min(100, Math.max(1, Math.round(opts.limit ?? 50)));
  const key = `wiki:nearby:${lat.toFixed(4)},${lon.toFixed(4)}:${radiusM}:${limit}`;
  const r = await cached(key, 5 * 60_000, () =>
    polite("wikipedia", 100, 30_000, async () => {
      const q = new URLSearchParams({
        action: "query",
        generator: "geosearch",
        ggscoord: `${lat}|${lon}`,
        ggsradius: String(radiusM),
        ggslimit: String(limit),
        ggsnamespace: "0",
        prop: "coordinates|extracts|pageimages|info",
        // Without these the props answer for only their own default batch
        // (10 coordinates, 20 extracts) and the rest arrive coordinate-less.
        colimit: "max",
        exlimit: "max",
        inprop: "url",
        exintro: "1",
        explaintext: "1",
        exsentences: "3",
        format: "json",
      });
      const json = await upstreamJson<unknown>("wikipedia", `${API}?${q.toString()}`);
      return parseGeosearch(json, { lat, lon });
    }),
  );
  return r.value;
}

/** One article's summary, or null when Wikipedia has no such article (404). */
export async function wikiSummary(title: string): Promise<WikiSummary | null> {
  const clean = title.trim();
  if (!clean) return null;
  const key = `wiki:summary:${clean.toLowerCase()}`;
  const r = await cached(key, 6 * 3600_000, () =>
    polite("wikipedia", 100, 30_000, async () => {
      try {
        const res = await upstream("wikipedia", `${REST}/page/summary/${encodeURIComponent(clean.replace(/ /g, "_"))}`);
        return parseSummary(await res.json());
      } catch (err) {
        if (err instanceof UpstreamError && err.status === 404) return null;
        throw err;
      }
    }),
  );
  return r.value;
}

/** Everything Wikipedia lists for one calendar day (events, births, deaths, selected). */
export async function wikiOnThisDay(mm: number, dd: number): Promise<WikiDayItem[]> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = `wiki:onthisday:${pad(mm)}/${pad(dd)}`;
  const r = await cached(key, 6 * 3600_000, () =>
    polite("wikipedia", 100, 30_000, async () => {
      const json = await upstreamJson<unknown>("wikipedia", `${FEED}/onthisday/all/${pad(mm)}/${pad(dd)}`);
      return parseOnThisDay(json);
    }),
  );
  return r.value;
}
