// GDELT 2.0 events, coded automatically from the world's news every 15
// minutes, shown under three rules that keep the layer about places and
// public events rather than people:
//
//   - city-level locations only (ActionGeo_Type 3, a US city, or 4, a world
//     city). Country- and state-level rows sit at a centroid GDELT assigns, not
//     where anything happened, so they are counted and left off the map;
//   - conflict only (QuadClass 3, verbal conflict, and 4, material conflict):
//     cooperation events are mostly statements and meetings; and every event is
//     folded into its place, so the map shows how many conflict events GDELT
//     coded at a city, never one story;
//   - no actors: Actor1Name, Actor2Name and every other actor column are never
//     read, and no article link is shown (a story can be about a private
//     person); only the publishing sites' domains are listed.
//
// GDELT's terms (gdeltproject.org/about.html, read 2026-09-26): "unlimited and
// unrestricted use for any academic, commercial, or governmental use of any
// kind without fee", and "any use or redistribution of the data must include a
// citation to the GDELT Project and a link to this website
// (https://www.gdeltproject.org/)".
//
// Pure: parsing and folding, tested on a captured export file.

import type { LayerFeature } from "@/lib/layers/types";

/** Column positions in a GDELT 2.0 event export row (61 tab-separated columns). */
export const GDELT_COL = {
  id: 0,
  sqlDate: 1,
  eventCode: 26,
  baseCode: 27,
  rootCode: 28,
  quadClass: 29,
  goldstein: 30,
  mentions: 31,
  sources: 32,
  articles: 33,
  tone: 34,
  geoType: 51,
  geoName: 52,
  geoCountry: 53,
  geoAdm1: 54,
  geoLat: 56,
  geoLon: 57,
  geoFeatureId: 58,
  dateAdded: 59,
  sourceUrl: 60,
} as const;
export const GDELT_COLUMNS = 61;

/** CAMEO root event classes (the CAMEO codebook's names). */
export const CAMEO_ROOT: Record<string, string> = {
  "01": "Make public statement",
  "02": "Appeal",
  "03": "Express intent to cooperate",
  "04": "Consult",
  "05": "Engage in diplomatic cooperation",
  "06": "Engage in material cooperation",
  "07": "Provide aid",
  "08": "Yield",
  "09": "Investigate",
  "10": "Demand",
  "11": "Disapprove",
  "12": "Reject",
  "13": "Threaten",
  "14": "Protest",
  "15": "Exhibit force posture",
  "16": "Reduce relations",
  "17": "Coerce",
  "18": "Assault",
  "19": "Fight",
  "20": "Use unconventional mass violence",
};

export const QUAD_CLASS: Record<string, string> = {
  "1": "Verbal cooperation",
  "2": "Material cooperation",
  "3": "Verbal conflict",
  "4": "Material conflict",
};

export interface EventPlace {
  featureId: string;
  name: string;
  lat: number;
  lon: number;
  /** FIPS country code as GDELT publishes it. */
  country?: string;
  geoType: "3" | "4";
  events: number;
  verbal: number;
  material: number;
  byRoot: Record<string, number>;
  articles: number;
  mentions: number;
  goldsteinMin?: number;
  goldsteinMax?: number;
  /** Event dates as coded (SQLDATE), YYYY-MM-DD. */
  firstEventDate?: string;
  lastEventDate?: string;
  /** Publishing sites, most frequent first (hostnames only). */
  domains: string[];
}

export interface FoldResult {
  places: EventPlace[];
  /** Rows read, and why rows were left off the map. */
  rows: number;
  notConflict: number;
  notCityLevel: number;
  noPosition: number;
}

const day = (s: string | undefined) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : undefined);

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Fold export rows (tab-separated text, any number of files) into conflict events per city. */
export function foldEvents(texts: string[]): FoldResult {
  const byPlace = new Map<string, EventPlace & { hosts: Map<string, number> }>();
  const seen = new Set<string>();
  let rows = 0;
  let notConflict = 0;
  let notCityLevel = 0;
  let noPosition = 0;
  for (const text of texts) {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const r = line.replace(/\r$/, "").split("\t");
      if (r.length < GDELT_COLUMNS) continue;
      const id = r[GDELT_COL.id];
      if (seen.has(id)) continue;
      seen.add(id);
      rows++;
      const quad = r[GDELT_COL.quadClass];
      if (quad !== "3" && quad !== "4") {
        notConflict++;
        continue;
      }
      const geoType = r[GDELT_COL.geoType];
      if (geoType !== "3" && geoType !== "4") {
        notCityLevel++;
        continue;
      }
      const lat = Number(r[GDELT_COL.geoLat]);
      const lon = Number(r[GDELT_COL.geoLon]);
      const fid = r[GDELT_COL.geoFeatureId].trim();
      if (r[GDELT_COL.geoLat].trim() === "" || r[GDELT_COL.geoLon].trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lon) || !fid) {
        noPosition++;
        continue;
      }
      const key = `${geoType}:${fid}`;
      let p = byPlace.get(key);
      if (!p) {
        p = {
          featureId: fid,
          name: r[GDELT_COL.geoName].trim() || fid,
          lat,
          lon,
          country: r[GDELT_COL.geoCountry].trim() || undefined,
          geoType,
          events: 0,
          verbal: 0,
          material: 0,
          byRoot: {},
          articles: 0,
          mentions: 0,
          domains: [],
          hosts: new Map(),
        };
        byPlace.set(key, p);
      }
      p.events++;
      if (quad === "3") p.verbal++;
      else p.material++;
      const root = r[GDELT_COL.rootCode].trim().padStart(2, "0");
      p.byRoot[root] = (p.byRoot[root] ?? 0) + 1;
      const n = (i: number) => {
        const v = Number(r[i]);
        return r[i].trim() !== "" && Number.isFinite(v) ? v : undefined;
      };
      p.articles += n(GDELT_COL.articles) ?? 0;
      p.mentions += n(GDELT_COL.mentions) ?? 0;
      const g = n(GDELT_COL.goldstein);
      if (g != null) {
        p.goldsteinMin = p.goldsteinMin == null ? g : Math.min(p.goldsteinMin, g);
        p.goldsteinMax = p.goldsteinMax == null ? g : Math.max(p.goldsteinMax, g);
      }
      const d = day(r[GDELT_COL.sqlDate]);
      if (d) {
        if (!p.firstEventDate || d < p.firstEventDate) p.firstEventDate = d;
        if (!p.lastEventDate || d > p.lastEventDate) p.lastEventDate = d;
      }
      // The domain of the story only: never the article's address.
      const h = hostOf(r[GDELT_COL.sourceUrl]);
      if (h) p.hosts.set(h, (p.hosts.get(h) ?? 0) + 1);
    }
  }
  const places = [...byPlace.values()]
    .map(({ hosts, ...p }) => ({ ...p, domains: [...hosts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([h]) => h) }))
    .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  return { places, rows, notConflict, notCityLevel, noPosition };
}

/** GDELT's 15-minute export file names: YYYYMMDDHHMMSS.export.CSV.zip, every quarter hour. */
export function exportUrl(stamp: string): string {
  return `https://data.gdeltproject.org/gdeltv2/${stamp}.export.CSV.zip`;
}

/** The export stamp in lastupdate.txt, and the quarter hours before it. */
export function exportStamps(lastUpdateTxt: string, count: number): string[] {
  const m = lastUpdateTxt.match(/gdeltv2\/(\d{14})\.export\.CSV\.zip/);
  if (!m) throw new Error("GDELT lastupdate.txt: no export file listed");
  const s = m[1];
  const t0 = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(t0 - i * 15 * 60_000);
    const p = (n: number) => String(n).padStart(2, "0");
    out.push(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`);
  }
  return out;
}

export interface EventsExtra {
  events: number;
  material: number;
  verbal: number;
}

export function eventFeature(p: EventPlace, window: string): LayerFeature {
  const roots = Object.entries(p.byRoot)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c, n]) => `${CAMEO_ROOT[c] ?? `CAMEO ${c}`} ${n}`)
    .join("; ");
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.lon, p.lat, 0] },
    properties: {
      id: `gdelt:${p.geoType}:${p.featureId}`,
      layer: "events",
      name: `${p.name.split(",")[0]} · ${p.events} conflict event${p.events === 1 ? "" : "s"}`,
      kind: p.material > 0 ? "material" : "verbal",
      source: "GDELT 2.0",
      details: {
        place: p.name,
        "conflict events coded here": `${p.events} (${p.material} material conflict, ${p.verbal} verbal conflict)`,
        "by CAMEO event class": roots,
        window,
        "event dates as coded": p.firstEventDate ? (p.firstEventDate === p.lastEventDate ? p.firstEventDate : `${p.firstEventDate} to ${p.lastEventDate}`) : undefined,
        "Goldstein scale (published range)": p.goldsteinMin != null ? (p.goldsteinMin === p.goldsteinMax ? `${p.goldsteinMin}` : `${p.goldsteinMin} to ${p.goldsteinMax}`) : undefined,
        "articles / mentions": `${p.articles} / ${p.mentions}`,
        "reported by (sites)": p.domains.join(", ") || undefined,
        "location level": p.geoType === "3" ? "US city (GDELT geocode)" : "world city (GDELT geocode)",
        "what this is": "events a machine coded from news reports: counts of reports' events, not verified incidents; no actors and no article links are shown",
        credit: "The GDELT Project, https://www.gdeltproject.org/",
      },
      extra: { events: p.events, material: p.material, verbal: p.verbal } satisfies EventsExtra,
    },
  };
}
