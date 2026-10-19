// world_context: personal-world-jev slice 1. One call gives an agent the cited
// world context for a place before it acts: who the place is (names, FIPS,
// metro), the fabric at its point, its hazard baseline and what is live now,
// its economic baseline, social vulnerability, nearby public institutions and
// when its numbers are next revised.
//
// It composes this app's own routes server-side (the same ones place_fabric,
// screen, risk_index, county_history, social_vulnerability, live_events,
// companies_near, release_calendar and catalog_search call, plus the
// hospitals and dams record routes for a box, and the fabric's county outlines
// for a box) and calls no upstream of its own. Rules it keeps:
//   - An item cites only its own source, from the route it came from; a source
//     that route lists as missing, or sends no provenance for, gives no value.
//   - Every item carries sourceId, publisher, upstreamUrl, retrievedAt and a
//     link: the exact route URL that, fetched, returns the cited thing.
//   - Missing is absent with a reason (topics[t].missing), never a placeholder;
//     a value BLS withheld is null with the reason, not 0.
//   - A sub-route that fails or times out costs only its own items: the reply
//     says coverageStatus partial and names it. Only a reply with no item at
//     all is an error.
//   - Fields are whitelisted per item type. Record names appear only where the
//     route's own record text carries them (the PUBLIC_NAME_RULE cards:
//     hospitals and dams with a non-private owner); companies are labelled by
//     ticker and CIK; no address, website, owner or free text is copied.
//   - The whole reply stays under WORLD_MAX_BYTES (UTF-8 JSON, with the error
//     envelope's fields when it is an error), cutting rows of lists before
//     summaries, from the topic with the most rows, and saying so.
//
// Relative imports only (see ./tools.ts for why); only types come from
// ./tools, so there is no import cycle at run time.

import type { CoverageStatus } from "./coverage";
import { envelopeForStatus } from "./errors";
import type { JsonObject, JsonReply, ToolCtx, ToolReply } from "./tools";

/** Topics a caller can ask for. identity is always included. */
export const WORLD_TOPICS = ["fabric", "hazards", "economy", "vulnerability", "institutions", "freshness", "collections"] as const;
export type WorldTopic = (typeof WORLD_TOPICS)[number];

/** Hard cap on the reply: UTF-8 bytes of the JSON text. */
export const WORLD_MAX_BYTES = 24_000;
/** Records per list (hospitals, dams, declarations, alerts, ...) when max_records is not given. */
export const WORLD_DEFAULT_RECORDS = 3;
export const WORLD_MAX_RECORDS = 10;
/** Each phase of sub-route calls gives up after this long; two phases fit inside the route's 60 s. */
export const WORLD_STEP_MS = 25_000;
/** Largest box side accepted, degrees. world_context is about a place; areas and risk_index serve regions. */
export const WORLD_MAX_BOX_DEG = 2;

export interface WorldInput {
  lon?: number;
  lat?: number;
  fips?: string;
  bbox?: number[];
  topics?: WorldTopic[];
  max_records?: number;
  about?: string;
}

export interface WorldItem {
  fact: string;
  value: string | number | boolean | null;
  unit?: string;
  code?: string;
  period?: string;
  note?: string;
  point?: [number, number];
  sourceId: string;
  publisher: string;
  upstreamUrl: string;
  retrievedAt: string;
  link: string;
}

export interface WorldSection {
  items: WorldItem[];
  missing?: { what: string; reason: string }[];
  coverageStatus?: CoverageStatus;
}

type Section = WorldSection & { cut: string[] };

// ---- fetching ----------------------------------------------------------------

interface Got {
  ok: boolean;
  status: number;
  body: JsonObject;
  url: string;
  reason?: string;
}

function q(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${k}=${encodeURIComponent(String(v)).replace(/%2C/gi, ",").replace(/%3A/gi, ":")}`);
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function obj(v: unknown): JsonObject {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 200) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Fetch one route with a deadline; never throws. */
function fetcher(ctx: ToolCtx, stepMs: number) {
  const memo = new Map<string, Promise<Got>>();
  const one = async (path: string): Promise<Got> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((res) => {
      timer = setTimeout(() => res("timeout"), stepMs);
    });
    try {
      const r = await Promise.race([ctx.fetchJson(path), deadline]);
      if (r === "timeout") return { ok: false, status: 504, body: {}, url: path, reason: `no answer within ${stepMs / 1000} s` };
      const reply = r as JsonReply;
      const body = obj(reply.body);
      if (reply.status >= 400) {
        const err = typeof body.error === "string" ? body.error : "";
        const reason = reply.status === 404 && err === "non-JSON reply" ? "this route is not deployed on this server" : `HTTP ${reply.status}${err ? ": " + err.slice(0, 160) : ""}`;
        return { ok: false, status: reply.status, body, url: reply.url, reason };
      }
      return { ok: true, status: reply.status, body, url: reply.url };
    } catch (err) {
      return { ok: false, status: 0, body: {}, url: path, reason: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return (path: string): Promise<Got> => {
    let p = memo.get(path);
    if (!p) {
      p = one(path);
      memo.set(path, p);
    }
    return p;
  };
}

// ---- citations ---------------------------------------------------------------

interface Prov {
  source: JsonObject;
  upstreamUrl?: string;
  retrievedAt?: string;
}

/**
 * The provenance entry for exactly this source id (the first passing `pick`,
 * else the first with the id). Never another source's entry: a source the
 * route did not cite gets no citation, so its item is listed as missing.
 */
function provOf(body: JsonObject, id: string, pick?: (p: Prov) => boolean): Prov | null {
  const byId = arr(body.provenance)
    .map((p) => obj(p) as unknown as Prov)
    .filter((p) => obj(p.source).id === id);
  return (pick ? byId.find(pick) : undefined) ?? byId[0] ?? null;
}

/**
 * Names the routes use in their own `missing` lists (lib/hazards/history.ts), by
 * source id. A route's `missing` or `failed` entry may also name the id itself.
 */
export const MISSING_NAMES: Record<string, string> = {
  FEMA: "fema-openfema",
  USDM: "usdm",
  SPC: "noaa-spc",
  "NCEI Storm Events": "ncei-storm-events",
  "USGS landslide susceptibility": "usgs-landslide-susc",
  "NOAA Climate at a Glance (tavg)": "noaa-cag",
  "NOAA Climate at a Glance (pcp)": "noaa-cag",
};

/** Plain words for the routes' reason codes; the code stays in brackets. */
const REASONS: Record<string, (who: string) => string> = {
  "join:legacy_ct_counties": (who) => `${who} lists Connecticut under its 8 legacy counties (09001-09015), not the planning regions (09110-09190) Census now uses, so it has nothing filed under this region`,
  "source:not_published_for_puerto_rico": (who) => `${who} does not publish Puerto Rico`,
  "join:boundary_changed_since_2010": (who) => `this county's boundary changed after 2010, so ${who}'s 2010-based row is not attached to it`,
  "source:not_in_release": (who) => `${who}'s current release has no row for this place`,
  "join:ncei_areas_not_counties": (who) => `${who} files Alaska by forecast zones and areas, not by county`,
  "source:failed": (who) => `${who} failed on this call`,
  "join:area_not_placed": (who) => `${who}: FEMA filed a row under a former, split county code for a designated area that no cited source places in this county, so it is not attached here`,
};

export function explainReason(code: string, who: string, detail?: string | null): string {
  const f = REASONS[code];
  const base = f ? `${f(who)} (${code})` : code;
  return detail ? `${base}: ${detail}` : base;
}

/** The route's own entry saying this source is missing or failed, if any. */
function routeMissing(got: Got, id: string): { source: string; reason: string } | null {
  const d = obj(got.body.data);
  for (const m of [...arr(d.missing), ...arr(d.failed), ...arr(got.body.missing)].map(obj)) {
    const name = str(m.source ?? m.id);
    if (name && (name === id || MISSING_NAMES[name] === id)) {
      const code = str(m.reason) ?? (str(m.error) ? "source:failed" : "");
      return { source: name, reason: explainReason(code || "source:failed", name, str(m.detail) ?? str(m.error)) };
    }
  }
  return null;
}

interface Cite {
  sourceId: string;
  publisher: string;
  upstreamUrl: string;
  retrievedAt: string;
  link: string;
}

/** Why a source has no citation on this call: the route lists it missing, or sent no provenance for it. */
interface NoCite {
  none: string;
  reason: string;
}

/** The citation for `id` from this route's reply, or why there is none. */
function cite(got: Got, id: string, pick?: (p: Prov) => boolean): Cite | NoCite {
  const gone = routeMissing(got, id);
  if (gone) return { none: id, reason: `${id}: the route lists it as missing: ${gone.reason}` };
  const p = provOf(got.body, id, pick);
  const src = obj(p?.source);
  const publisher = str(src.publisher);
  if (!p || !publisher) return { none: id, reason: `${id}: the route sent no provenance for it, so nothing from it is shown` };
  const upstreamUrl = (typeof p.upstreamUrl === "string" && p.upstreamUrl) || (typeof src.url === "string" && src.url) || got.url;
  const retrievedAt = (typeof p.retrievedAt === "string" && p.retrievedAt) || (typeof got.body.generatedAt === "string" && got.body.generatedAt) || new Date().toISOString();
  return { sourceId: id, publisher, upstreamUrl, retrievedAt, link: got.url };
}

function isCite(c: Cite | NoCite): c is Cite {
  return !("none" in c);
}

/** An item, or the fact it would have stated and why it has no citation. */
type Built = WorldItem | { uncited: string; reason: string };

function item(c: Cite | NoCite, fact: string, value: WorldItem["value"], extra: Partial<Omit<WorldItem, "fact" | "value" | keyof Cite>> = {}): Built {
  if (!isCite(c)) return { uncited: fact, reason: c.reason };
  const out = { fact, value } as WorldItem;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== "") (out as unknown as JsonObject)[k] = v;
  return Object.assign(out, c);
}

function section(): Section {
  return { items: [], cut: [] };
}

/** Items that are rows of a list (declarations, records, events, companies); the byte cap drops these before summaries. */
const LIST_ROWS = new WeakSet<object>();

function listRow(b: Built): Built {
  if (!("uncited" in b)) LIST_ROWS.add(b);
  return b;
}

/** Add an item; one without a citation is never shown, and is listed as missing instead. */
function push(s: Section, it: Built): void {
  if ("uncited" in it) miss(s, it.uncited, it.reason);
  else s.items.push(it);
}

function miss(s: Section, what: string, reason: string): void {
  (s.missing ??= []).push({ what, reason });
}

// ---- boxes -------------------------------------------------------------------

type Box = [number, number, number, number];

function boxAround(lon: number, lat: number, d: number): Box {
  return [round(Math.max(-180, lon - d), 4), round(Math.max(-90, lat - d), 4), round(Math.min(180, lon + d), 4), round(Math.min(90, lat + d), 4)];
}

function inBox(b: Box, lon: number, lat: number): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

function boxesTouch(a: Box, b: number[]): boolean {
  return b.length === 4 && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Every ring (a list of [lon, lat]) in a nested rings array, however deep. */
function ringsIn(v: unknown[], out: number[][][] = []): number[][][] {
  const first = v[0];
  if (Array.isArray(first) && typeof first[0] === "number") out.push(v as number[][]);
  else for (const x of v) if (Array.isArray(x)) ringsIn(x, out);
  return out;
}

/** Does segment a-b cross or touch the box? (Liang-Barsky clip.) */
function segmentTouchesBox(a: number[], b2: number[], box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b2[0] - a[0];
  const dy = b2[1] - a[1];
  for (const [p, q2] of [
    [-dx, a[0] - box[0]],
    [dx, box[2] - a[0]],
    [-dy, a[1] - box[1]],
    [dy, box[3] - a[1]],
  ]) {
    if (p === 0) {
      if (q2 < 0) return false;
    } else {
      const t = q2 / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Does a polygon (its rings) touch the box: an edge crosses it, or the box sits inside the polygon? */
export function ringsTouchBox(rings: unknown[], box: Box): boolean {
  const rs = ringsIn(rings);
  for (const ring of rs) for (let i = 1; i < ring.length; i++) if (segmentTouchesBox(ring[i - 1], ring[i], box)) return true;
  // No edge in the box: the box is wholly inside the polygon or wholly outside it. Test its centre (even-odd).
  const x = (box[0] + box[2]) / 2;
  const y = (box[1] + box[3]) / 2;
  let inside = false;
  for (const ring of rs) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function pointOf(f: JsonObject): [number, number] | null {
  const c = arr(obj(f.geometry).coordinates);
  const lon = num(c[0]);
  const lat = num(c[1]);
  return lon == null || lat == null ? null : [round(lon, 4), round(lat, 4)];
}

/**
 * A record's name, only when the route's own record text carries it: route
 * builders put "name: <name>" in extra.embedText only under PUBLIC_NAME_RULE
 * (hospitals; dams with a published non-private owner). Anything else is
 * labelled by its id.
 */
function publicName(props: JsonObject): string | null {
  const name = str(props.name);
  const text = obj(props.extra).embedText;
  if (!name || typeof text !== "string") return null;
  return text.includes(`name: ${name}`) ? name : null;
}

// ---- topic builders ------------------------------------------------------------

const IDENTITY_KINDS: Record<string, string> = { county: "county", state: "state", cbsa: "metro or micro area (CBSA)", place: "city or town", tract: "census tract", zcta: "ZIP code area (ZCTA)" };
const FABRIC_KINDS: Record<string, string> = {
  timezone: "time zone",
  "nws-office": "NWS forecast office",
  huc12: "HUC-12 watershed",
  flood: "FEMA flood zone",
  "flood-community": "NFIP community",
  school: "school district",
  cd: "congressional district",
  tribal: "tribal land",
  eco3: "EPA level III ecoregion",
};
/** Facts copied from a fabric node, by kind: published codes only, never free text. */
const FABRIC_FACTS: Record<string, string[]> = { flood: ["special flood hazard area", "FIRM panel"], huc12: ["drains to"], cbsa: ["type"] };
/** Kinds that hold for a whole county, so they can be read at its representative point. */
const COUNTY_WIDE = new Set(["county", "state", "cbsa"]);

interface Node {
  kind: string;
  name: string | null;
  code: string | null;
  source: string;
  facts: JsonObject;
}

function nodesOf(fabric: Got): Node[] {
  return arr(obj(fabric.body.data).nodes).map((n) => {
    const o = obj(n);
    return { kind: String(o.kind ?? ""), name: str(o.name), code: str(o.code), source: String(o.source ?? ""), facts: obj(o.facts) };
  });
}

function nodeNote(n: Node): string | undefined {
  const keys = FABRIC_FACTS[n.kind] ?? [];
  const parts = keys.map((k) => (str(n.facts[k]) ? `${k}: ${str(n.facts[k])}` : null)).filter(Boolean);
  return parts.length ? parts.join("; ") : undefined;
}

function fabricItems(s: Section, fabric: Got, kinds: Record<string, string>, only?: Set<string>, note?: string): void {
  for (const n of nodesOf(fabric)) {
    const label = kinds[n.kind];
    if (!label || (only && !only.has(n.kind))) continue;
    const extra = [nodeNote(n), note].filter(Boolean).join("; ");
    push(s, item(cite(fabric, n.source), label, n.name, { code: n.code ?? undefined, note: extra || undefined }));
  }
}

/**
 * What the fabric's identity nodes leave out, said with its reason: a TIGERweb
 * failure, no county under the point (offshore, or outside the US), no state,
 * or a county that is in no CBSA. `expect` is the county FIPS asked for, when
 * one was (its own county item comes from the screener, not from here).
 */
function identityGaps(s: Section, fabric: Got, expect: string | null, at: string): void {
  const nodes = nodesOf(fabric);
  const has = (k: string) => nodes.some((n) => n.kind === k);
  const failed = arr(obj(fabric.body.data).failed).map((f) => obj(f));
  const tiger = failed.find((f) => str(f.source ?? f.id) === "census-tigerweb");
  if (tiger) {
    miss(s, expect ? "state and metro area (CBSA)" : "county, state and metro area (CBSA)", `Census TIGERweb failed on this call (/api/fabric failed[]${str(tiger.error) ? `: ${str(tiger.error)}` : ""})`);
    return;
  }
  if (!has("county")) {
    const why = str(obj(fabric.body.data).coverage);
    miss(s, expect ? "state and metro area (CBSA)" : "county, state and metro area (CBSA)", `the place fabric answered but has no county polygon at ${at}: it is offshore or outside the US${why ? ` (the fabric says: ${why})` : ""}`);
    return;
  }
  if (!has("state")) miss(s, "state", `the place fabric returned no state at ${at}`);
  if (!has("cbsa")) miss(s, "metro area (CBSA)", "none: this county is in no metropolitan or micropolitan statistical area (Census TIGERweb answered and returned no CBSA here)");
}

function fabricFailed(fabric: Got, s: Section): void {
  for (const f of arr(obj(fabric.body.data).failed)) {
    const id = str(typeof f === "string" ? f : obj(f).id ?? obj(f).source);
    if (id) miss(s, `place fabric: ${id}`, "that upstream failed on this call (listed in /api/fabric failed[])");
  }
}

const NRI_HAZARDS: Record<string, string> = {
  AVLN: "avalanche",
  CFLD: "coastal flooding",
  CWAV: "cold wave",
  DRGT: "drought",
  ERQK: "earthquake",
  HAIL: "hail",
  HWAV: "heat wave",
  HRCN: "hurricane",
  ISTM: "ice storm",
  IFLD: "riverine flooding",
  LNDS: "landslide",
  LTNG: "lightning",
  SWND: "strong wind",
  TRND: "tornado",
  TSUN: "tsunami",
  VLCN: "volcanic activity",
  WFIR: "wildfire",
  WNTW: "winter weather",
};

function nriRow(nri: Got): JsonObject | null {
  const row = obj(obj(nri.body.data).row);
  return Object.keys(row).length ? row : null;
}

const NRI_CLASSES = new Set(["Very Low", "Relatively Low", "Relatively Moderate", "Relatively High", "Very High"]);

/** A FEMA NRI rating word when it is a class; FEMA's other words ("Insufficient Data", "Data Unavailable", ...) are not a value. */
function nriRating(v: unknown): { rating: string | null; reason?: string } {
  const w = str(v);
  if (w && NRI_CLASSES.has(w)) return { rating: w };
  return { rating: null, reason: w ? `FEMA publishes "${w}" here, which is not a rating (and never means low)` : "FEMA's row has no rating here" };
}

function capList<T>(s: Section, label: string, list: T[], max: number): T[] {
  if (list.length > max) s.cut.push(`${label}: ${max} of ${list.length} shown (max_records)`);
  return list.slice(0, max);
}

// ---- the tool ------------------------------------------------------------------

interface Resolved {
  kind: "point" | "county" | "state" | "bbox";
  name: string | null;
  countyFips: string | null;
  stateFips: string | null;
  usps: string | null;
  point: { lon: number; lat: number; basis: string } | null;
  box: Box | null;
}

function bytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}

/** Build the bundle. Pure over ctx.fetchJson; `stepMs` is a test seam. */
export async function worldContext(input: WorldInput, ctx: ToolCtx, opts: { stepMs?: number } = {}): Promise<ToolReply> {
  const get = fetcher(ctx, opts.stepMs ?? WORLD_STEP_MS);
  const max = input.max_records ?? WORLD_DEFAULT_RECORDS;
  const topics = new Set<WorldTopic>(input.topics ?? WORLD_TOPICS.filter((t) => t !== "collections" || input.about));
  const want = (t: WorldTopic) => topics.has(t);
  const S: Record<"identity" | WorldTopic, Section> = { identity: section(), fabric: section(), hazards: section(), economy: section(), vulnerability: section(), institutions: section(), freshness: section(), collections: section() };
  const id = S.identity;

  // ---- phase 1: resolve the place ----
  const r: Resolved = { kind: "point", name: null, countyFips: null, stateFips: null, usps: null, point: null, box: null };
  let fabric: Got | null = null;
  let screen: Got | null = null;
  if (input.bbox) {
    const [w, s, e, n] = input.bbox;
    r.kind = "bbox";
    r.box = [w, s, e, n];
    r.point = { lon: round((w + e) / 2, 4), lat: round((s + n) / 2, 4), basis: "centre of the box" };
  } else if (input.fips) {
    const f = input.fips;
    const state = f.length === 2 || f.endsWith("000");
    r.kind = state ? "state" : "county";
    r.stateFips = f.slice(0, 2);
    if (!state) r.countyFips = f;
  } else {
    r.point = { lon: input.lon!, lat: input.lat!, basis: "as given" };
    r.box = boxAround(input.lon!, input.lat!, 0.1);
  }

  if (r.point) {
    fabric = await get("/api/fabric" + q({ op: "stack", lon: r.point.lon, lat: r.point.lat }));
    if (fabric.ok) {
      const nodes = nodesOf(fabric);
      r.countyFips = nodes.find((n) => n.kind === "county")?.code ?? null;
      r.stateFips = nodes.find((n) => n.kind === "state")?.code ?? (r.countyFips ? r.countyFips.slice(0, 2) : null);
      r.name = nodes.find((n) => n.kind === "county")?.name ?? nodes.find((n) => n.kind === "country")?.name ?? null;
    } else miss(id, "place fabric at the point", fabric.reason ?? "failed");
  } else {
    const kind = r.kind === "state" ? "state" : "county";
    const geoid = r.kind === "state" ? r.stateFips! : r.countyFips!;
    screen = await get("/api/screen" + q({ kind, q: `geoid == "${geoid}" LIMIT 1` }));
    const row = obj(arr(obj(screen.body.data).rows)[0]);
    if (screen.ok && !Object.keys(row).length) {
      const legacyCt = kind === "county" && /^090(0[1-9]|1[0-5])$/.test(geoid);
      const hint = legacyCt ? `; ${geoid} is one of Connecticut's 8 legacy counties (09001-09015), which Census replaced with 9 planning regions (09110-09190) as county equivalents in 2022: pass a planning region's FIPS or a point` : "";
      return { status: 404, payload: { error: `no ${kind} with FIPS ${input.fips} in eye's ${kind} table (GET /api/screen)${hint}`, input } };
    }
    if (screen.ok) {
      r.name = str(row.name);
      r.usps = str(obj(row.values).state);
      const geo = arr(row.geo);
      const lon = num(geo[0]);
      const lat = num(geo[1]);
      if (lon != null && lat != null) {
        r.point = { lon: round(lon, 4), lat: round(lat, 4), basis: `the ${kind}'s representative point as /api/screen publishes it` };
        if (r.kind === "county") r.box = boxAround(lon, lat, 0.25);
      }
    } else miss(id, `${kind} row`, screen.reason ?? "failed");
  }

  // ---- phase 2: everything else, in parallel ----
  const cf = r.countyFips;
  const needNri = !!cf && (want("hazards") || want("vulnerability") || want("economy"));
  const calls = {
    fabric: r.kind === "county" && r.point ? get("/api/fabric" + q({ op: "stack", lon: r.point.lon, lat: r.point.lat })) : null,
    screen: !screen && cf && want("economy") ? get("/api/screen" + q({ kind: "county", q: `geoid == "${cf}" LIMIT 1` })) : null,
    nri: needNri ? get("/api/hazards" + q({ op: "nri", fips: cf! })) : null,
    // Census TIGERweb county outlines in the box (the fabric's field op); filtered below to those that touch it.
    counties: r.kind === "bbox" ? get("/api/fabric" + q({ op: "field", kind: "county", bbox: r.box!.join(",") })) : null,
    // FEMA lists a disaster once per designated area: ask for more rows than max so `max` distinct disasters survive the dedupe.
    history: cf && want("hazards") ? get("/api/hazards" + q({ op: "history", fips: cf, years: 10, declarations: Math.min(50, max * 5) })) : null,
    live: want("hazards") && r.box ? get("/api/live") : null,
    svi: cf && want("vulnerability") ? get("/api/civic" + q({ op: "svi", level: "place", fips: cf })) : null,
    hospitals: want("institutions") && r.box ? get("/api/infra" + q({ op: "hospitals", bbox: r.box.join(",") })) : null,
    dams: want("institutions") && r.box ? get("/api/infra" + q({ op: "dams", bbox: r.box.join(",") })) : null,
    companies: want("institutions") ? (r.kind === "bbox" ? get("/api/companies" + q({ op: "near", bbox: r.box!.join(",") })) : cf ? get("/api/companies" + q({ op: "county", fips: cf })) : null) : null,
    calendar: want("freshness") ? get("/api/releases" + q({ op: "calendar" })) : null,
    catalog: want("collections") && input.about ? get("/api/catalog" + q({ op: "search", q: input.about, limit: max })) : null,
  };
  const keys = Object.keys(calls) as (keyof typeof calls)[];
  const settled = await Promise.all(keys.map((k) => calls[k]));
  const got = Object.fromEntries(keys.map((k, i) => [k, settled[i]])) as Record<keyof typeof calls, Got | null>;
  if (got.screen) screen = got.screen;

  // ---- identity ----
  // A county FIPS: the screener's row names the county asked for. The fabric read at
  // its representative point adds state and CBSA only when it lands in that county.
  if (screen?.ok && (r.kind === "county" || r.kind === "state")) {
    const row = obj(arr(obj(screen.body.data).rows)[0]);
    const v = obj(row.values);
    push(id, item(cite(screen, "census-tigerweb"), r.kind, str(row.name), { code: str(v.geoid) ?? undefined }));
  }
  if (fabric?.ok && (r.kind === "point" || r.kind === "bbox")) {
    fabricItems(id, fabric, IDENTITY_KINDS, undefined, r.kind === "bbox" ? "at the centre of the box" : undefined);
    identityGaps(id, fabric, null, r.kind === "bbox" ? "the centre of the box" : "this point");
  }
  if (r.kind === "county") {
    const g = got.fabric;
    if (g?.ok) {
      const at = r.point ? `the county's representative point (${r.point.lon}, ${r.point.lat})` : "the county's representative point";
      const there = nodesOf(g).find((n) => n.kind === "county");
      if (there && there.code !== cf) {
        miss(id, "state and metro area (CBSA) from the place fabric", `the fabric at ${at} resolved to county ${there.code}${there.name ? ` (${there.name})` : ""}, not ${cf}; that county's state and CBSA are not shown for this one`);
      } else {
        fabricItems(id, g, IDENTITY_KINDS, new Set(["state", "cbsa"]), "read at the county's representative point");
        identityGaps(id, g, cf, at);
      }
    } else if (g) miss(id, "state and metro area (CBSA) from the place fabric", g.reason ?? "failed");
  }
  if (r.kind === "state") miss(id, "metro area (CBSA)", "a state has no single metro; pass a county FIPS or a point");
  if (got.counties && r.box) {
    const g = got.counties;
    if (g.ok) {
      const b = r.box;
      const units = arr(obj(g.body.data).units).map(obj);
      // The route pads the box to its own grid; keep only outlines that really touch the box asked.
      const touching = units.filter((u) => ringsTouchBox(arr(u.rings), b));
      // The county under the centre of the box first, so the cap never drops it.
      touching.sort((a, b2) => Number(str(b2.code) === cf) - Number(str(a.code) === cf));
      const c = cite(g, "census-tigerweb");
      if (obj(g.body.data).truncated === true) id.cut.push("counties touching the box: the route hit its record limit, so some may be missing");
      if (!touching.length) miss(id, "counties touching the box", units.length ? "none of the county outlines the route returned touches the box" : "Census TIGERweb returned no county in the box (offshore or outside the US)");
      for (const u of capList(id, "counties touching the box", touching, max)) {
        push(id, listRow(item(c, "county touching the box", str(u.name), { code: str(u.code) ?? undefined, note: "its Census TIGERweb outline (generalised) touches the box" })));
      }
    } else miss(id, "counties touching the box", g.reason ?? "failed");
  }
  if (r.stateFips === "09" && (r.kind === "county" || r.kind === "point" || r.kind === "bbox")) {
    miss(id, "Connecticut county id", "Census uses planning regions (09110-09190) as county equivalents; some sources publish only legacy counties (09001-09015), so a county-keyed fact can be absent here for that reason alone");
  }
  if (!cf && r.kind !== "state" && !fabric?.ok) miss(id, "county", r.point ? "the place fabric did not answer, so no county was resolved" : "the place could not be resolved");

  // ---- fabric ----
  if (want("fabric")) {
    const s = S.fabric;
    if (r.kind === "state" || r.kind === "county") miss(s, "place fabric", `the fabric is per point; call world_context with lon/lat${r.point ? ` (the ${r.kind}'s point is ${r.point.lon}, ${r.point.lat})` : ""}`);
    else if (fabric?.ok) {
      fabricItems(s, fabric, FABRIC_KINDS, undefined, r.kind === "bbox" ? "at the centre of the box" : undefined);
      const elev = num(obj(obj(fabric.body.data).point).elevationM);
      if (elev != null) push(s, item(cite(fabric, "usgs-epqs"), "elevation", elev, { unit: "m", note: r.kind === "bbox" ? "at the centre of the box" : undefined }));
      else miss(s, "elevation", "USGS 3DEP gave no elevation for this point");
      fabricFailed(fabric, s);
    } else miss(s, "place fabric", fabric?.reason ?? "not asked");
  }

  // ---- hazards ----
  const nri = got.nri;
  const row = nri?.ok ? nriRow(nri) : null;
  if (want("hazards")) {
    const s = S.hazards;
    if (!cf) miss(s, "county hazard baseline (FEMA NRI, declarations, drought)", r.kind === "state" ? "not asked for a state: county-level sources only; pass a county FIPS" : "no county resolved");
    if (r.kind === "state") miss(s, "live events (NWS alerts, earthquakes)", "not asked for a state: the live list is matched to a search box; pass a county FIPS, a point or a box");
    if (nri) {
      if (row) {
        const c = cite(nri, "fema-nri");
        const risk = nriRating(row.RISK_RATNG);
        if (risk.rating) push(s, item(c, "FEMA NRI overall risk rating", risk.rating, { note: num(row.RISK_SCORE) != null ? `score ${round(num(row.RISK_SCORE)!, 1)} (percentile among US counties, not a likelihood)` : undefined, period: str(row.NRI_VER) ?? undefined }));
        else miss(s, "FEMA NRI overall risk rating", risk.reason!);
        const eal = num(row.EAL_VALT);
        const ealR = nriRating(row.EAL_RATNG);
        if (eal != null) push(s, item(c, "FEMA NRI expected annual loss", Math.round(eal), { unit: "USD a year (modelled)", note: ealR.rating ? `rating ${ealR.rating}` : `rating not given: ${ealR.reason}` }));
        else miss(s, "FEMA NRI expected annual loss", "FEMA's row has no expected annual loss for this county");
        const by: Record<string, string[]> = {};
        for (const [code, name] of Object.entries(NRI_HAZARDS)) {
          const rating = str(row[`${code}_RISKR`]);
          if (rating === "Very High" || rating === "Relatively High") (by[rating] ??= []).push(name);
        }
        const top = ["Very High", "Relatively High"].filter((k) => by[k]).map((k) => `${k}: ${by[k].join(", ")}`).join("; ");
        if (top) push(s, item(c, "NRI hazards rated Very High or Relatively High", top));
      } else miss(s, "FEMA National Risk Index", nri.ok ? "FEMA's index has no row for this county" : nri.reason ?? "failed");
    }
    const h = got.history;
    if (h) {
      if (h.ok) {
        const d = obj(h.body.data);
        // FEMA's declarations only with FEMA's own citation, and never when the route lists FEMA missing:
        // an empty list is "none filed" only when OpenFEMA was actually read for this county.
        const fema = cite(h, "fema-openfema");
        // FEMA lists one row per designated area: one disaster can be several rows. Keep each disaster once, newest first.
        const seenDecl = new Set<string>();
        const decls = arr(d.declarations)
          .map(obj)
          .filter((x) => {
            const k = x.disasterNumber != null ? `${str(x.declarationType) ?? ""}-${str(x.disasterNumber)}` : JSON.stringify(x);
            if (seenDecl.has(k)) return false;
            seenDecl.add(k);
            return true;
          });
        const rowsTotal = num(d.declarationRows);
        // Any boundary or join gap the route reports for this county means an empty list is not proof of none.
        const gap = arr(d.missing)
          .map(obj)
          .find((m) => /^join:|boundary/.test(str(m.reason) ?? ""));
        if (!isCite(fema)) miss(s, "FEMA declarations", fema.reason);
        else if (!decls.length) {
          if (gap) miss(s, "FEMA declarations", `the route reports a boundary or join gap for this county (${explainReason(str(gap.reason) ?? "", str(gap.source) ?? "a source", str(gap.detail))}), so an empty FEMA list is not proof that none were declared`);
          else if (rowsTotal !== 0) miss(s, "FEMA declarations", `the route listed none but did not report reading zero rows (declarationRows ${rowsTotal ?? "absent"}), so no count is given`);
          else push(s, item(fema, "FEMA declarations listed", 0, { note: "OpenFEMA lists no declaration naming this county, at any date (declarationRows 0)" }));
        } else {
          const shown = decls.slice(0, max);
          if (rowsTotal == null || rowsTotal > shown.length) s.cut.push(`FEMA declarations: the latest ${shown.length} distinct shown, any date (FEMA files ${rowsTotal ?? "an unstated number of"} rows for this county; a disaster can have one row per designated area)`);
          for (const x of shown) {
            const filed = str(x.filedUnder);
            push(
              s,
              listRow(
                item(fema, "FEMA declaration", str(x.declarationTitle), {
                  code: x.disasterNumber != null ? `${str(x.declarationType) ?? ""}-${str(x.disasterNumber)}` : undefined,
                  period: str(x.declarationDate) ?? undefined,
                  note: [str(x.incidentType), filed ? `filed by FEMA under the former county code ${filed} (the route's caveats say how that code relates to this county)` : null].filter(Boolean).join("; ") || undefined,
                }),
              ),
            );
          }
        }
        const dn = obj(d.droughtNow);
        if (Object.keys(dn).length) {
          const usdm = cite(h, "usdm", (p) => String(p.upstreamUrl ?? "").includes("Severity"));
          const shares = ["d0", "d1", "d2", "d3", "d4"].map((k) => `${k.toUpperCase()} ${num(dn[k]) ?? "?"}%`).join(", ");
          push(s, item(usdm, "U.S. Drought Monitor this week (share of county area per class)", shares, { period: str(dn.mapDate) ?? undefined, note: `none ${num(dn.none) ?? "?"}%; shares as published` }));
        } else miss(s, "U.S. Drought Monitor this week", "not in the hazard history reply");
        // The route's other gaps (sources this tool does not read), in plain words.
        for (const m of arr(d.missing).map(obj)) {
          const who = str(m.source);
          if (!who || MISSING_NAMES[who] === "fema-openfema" || MISSING_NAMES[who] === "usdm") continue;
          miss(s, who, explainReason(str(m.reason) ?? "", who, str(m.detail)));
        }
      } else miss(s, "hazard history (FEMA, drought)", h.reason ?? "failed");
    }
    const live = got.live;
    if (live && r.box) {
      if (live.ok) {
        const b = r.box;
        const hits = arr(obj(live.body.data).items)
          .map(obj)
          .filter((x) => {
            const lon = num(x.lon);
            const lat = num(x.lat);
            return boxesTouch(b, arr(x.bbox).map(Number)) || (lon != null && lat != null && inBox(b, lon, lat));
          });
        const where = r.kind === "county" ? `the box 0.25 degrees around the county's representative point (${b.join(",")}), not the whole county` : r.kind === "point" ? `the box 0.1 degrees around the point (${b.join(",")})` : `the box ${b.join(",")}`;
        // One count per source, each cited to its own feed, and only when that feed answered in full.
        const alerts = hits.filter((x) => x.kind !== "quake");
        const quakes = hits.filter((x) => x.kind === "quake");
        const unmapped = num(obj(live.body.data).unmapped) ?? 0;
        const nws = cite(live, "nws-api");
        if (!isCite(nws)) miss(s, "Severe or Extreme NWS alerts touching the box now", nws.reason);
        else if (unmapped > 0) miss(s, "count of Severe or Extreme NWS alerts touching the box now", `${unmapped} alert${unmapped === 1 ? "" : "s"} in the national list could not be outlined, so a count for this box could miss them; the alerts that do touch it are listed`);
        else push(s, item(nws, "Severe or Extreme NWS alerts touching the box now", alerts.length, { note: where }));
        const usgs = cite(live, "usgs-earthquakes");
        if (!isCite(usgs)) miss(s, "M4.5+ earthquakes in the past day touching the box", usgs.reason);
        else push(s, item(usgs, "M4.5+ earthquakes in the past day touching the box", quakes.length, { note: where }));
        for (const x of capList(s, "live events", hits, max)) {
          const quake = x.kind === "quake";
          const c = quake ? usgs : nws;
          const t = num(x.time);
          const u = num(x.until);
          push(s, listRow(item(isCite(c) && typeof x.url === "string" ? { ...c, upstreamUrl: x.url } : c, quake ? "earthquake" : "NWS alert", str(x.title), { note: str(x.subtitle) ?? undefined, period: t != null ? new Date(t).toISOString() + (u != null ? "/" + new Date(u).toISOString() : "") : undefined })));
        }
      } else miss(s, "live events", live.reason ?? "failed");
    }
  }

  // ---- economy ----
  if (want("economy")) {
    const s = S.economy;
    if (screen?.ok) {
      const v = obj(obj(arr(obj(screen.body.data).rows)[0]).values);
      if (!Object.keys(v).length) miss(s, "county economy row", "the screener has no row for this county");
      else {
        const qcew = cite(screen, "bls-qcew");
        const period = str(v["jobs.period"]) ?? undefined;
        const withheld = v["jobs.suppressed"] === true || v["jobs.suppressed"] === "true";
        for (const [k, fact, unit] of [
          ["jobs.emp", "covered employment (BLS QCEW, all industries)", "jobs"],
          ["jobs.avgWeeklyWage", "average weekly wage (BLS QCEW)", "USD"],
        ] as const) {
          const n = num(v[k]);
          if (n != null) push(s, item(qcew, fact, n, { unit, period }));
          else if (withheld) push(s, item(qcew, fact, null, { unit, period, note: "withheld by BLS for confidentiality: null, not 0" }));
          else miss(s, fact, "not published for this place");
        }
        const home = num(v["home.latest"]);
        if (home != null) push(s, item(cite(screen, "zillow-zhvi"), "typical home value (Zillow ZHVI)", Math.round(home), { unit: "USD", period: str(v["home.asOf"]) ?? undefined, note: num(v["home.yoyPct"]) != null ? `${round(num(v["home.yoyPct"])!, 1)}% over the year` : undefined }));
        else miss(s, "typical home value (Zillow ZHVI)", "Zillow publishes no value for this place");
        const rent = num(v["rent.latest"]);
        if (rent != null) push(s, item(cite(screen, "zillow-zori"), "typical asking rent (Zillow ZORI)", Math.round(rent), { unit: "USD a month" }));
        else miss(s, "typical asking rent (Zillow ZORI)", "Zillow publishes no rent index for this place");
      }
    } else miss(s, "jobs, wages, home value and rent", screen?.reason ?? "no county resolved");
    if (row) {
      const pop = num(row.POPULATION);
      if (pop != null) push(s, item(cite(nri!, "fema-nri"), "population (as carried in FEMA's NRI row)", pop, { unit: "people", note: `FEMA NRI ${str(row.NRI_VER) ?? ""}`.trim() + "; NRI's own population input, not a Census table eye reads directly" }));
    } else if (cf) miss(s, "population", "eye serves population only through FEMA's NRI row, which did not answer for this county");
  }

  // ---- vulnerability ----
  if (want("vulnerability")) {
    const s = S.vulnerability;
    if (!cf) miss(s, "social vulnerability", r.kind === "state" ? "county-level indices only; pass a county FIPS" : "no county resolved");
    const svi = got.svi;
    if (svi) {
      const rpl = arr(obj(obj(svi.body.data).row).rpl);
      const overall = num(rpl[0]);
      if (svi.ok && overall != null && overall >= 0) push(s, item(cite(svi, "cdc-svi"), "CDC/ATSDR SVI 2022 overall percentile", overall, { unit: "0 least to 1 most vulnerable among US counties" }));
      else miss(s, "CDC/ATSDR SVI 2022", svi.ok ? "CDC does not rank this place" : svi.reason ?? "failed");
    }
    const sovi = row ? nriRating(row.SOVI_RATNG) : null;
    if (row && sovi && !sovi.rating) miss(s, "FEMA NRI social vulnerability", sovi.reason!);
    else if (row && sovi?.rating) {
      push(s, item(cite(nri!, "fema-nri"), "FEMA NRI social vulnerability rating (Census Community Resilience Estimate; not CDC SVI)", sovi.rating, { note: num(row.SOVI_SCORE) != null ? `score ${round(num(row.SOVI_SCORE)!, 1)} of 100` : undefined }));
    } else if (cf) miss(s, "FEMA NRI social vulnerability", nri?.reason ?? "FEMA's index has no row for this county");
  }

  // ---- institutions ----
  if (want("institutions")) {
    const s = S.institutions;
    if (!r.box) miss(s, "hospitals and dams", r.kind === "state" ? "a state is too large for the record routes; pass a county FIPS, a point or a box" : "no box to search");
    const b = r.box;
    const boxNote = b ? (r.kind === "county" ? `within 0.25 degrees of the county's representative point, not the whole county` : r.kind === "point" ? "within 0.1 degrees of the point" : "inside the box") : undefined;
    const records = (g: Got | null, label: string, sourceId: string, build: (p: JsonObject, pt: [number, number] | null, c: Cite) => Built) => {
      if (!g || !b) return;
      if (!g.ok) return miss(s, label, g.reason ?? "failed");
      const feats = arr(obj(g.body.data).features)
        .map(obj)
        .filter((f) => {
          const pt = pointOf(f);
          return pt != null && inBox(b, pt[0], pt[1]);
        });
      const c = cite(g, sourceId);
      if (!isCite(c)) return miss(s, label, c.reason);
      // The route's own flag: its upstream's record limit was hit, so what came back is not every record in the box.
      const routeCut = g.body.truncated === true;
      if (routeCut) {
        s.cut.push(`${label}: the route hit its upstream's record limit for this box, so the ${feats.length} it returned inside the box are not all of them`);
        if (!feats.length) miss(s, `${label} found`, "the route hit its record limit and returned none inside the box; a count of 0 would not be true");
      } else if (!feats.length) push(s, item(c, `${label} found`, 0, { note: boxNote }));
      if (routeCut && feats.length > max) s.cut.push(`${label}: ${max} of at least ${feats.length} shown (max_records)`);
      const shown = routeCut ? feats.slice(0, max) : capList(s, label, feats, max);
      for (const f of shown) push(s, listRow(build(obj(f.properties), pointOf(f), c)));
    };
    records(got.hospitals, "hospitals", "hifld-hospitals", (p, pt, c) => {
      const x = obj(p.extra);
      const cms = obj(x.cms);
      const rating = num(cms.rating);
      return item(c, "hospital", publicName(p), {
        code: str(p.id) ?? undefined,
        point: pt ?? undefined,
        note: [str(obj(p.details).type), str(x.status)?.toLowerCase(), rating != null ? `CMS overall star rating ${rating}` : cms.ccn ? "CMS lists it but has not rated it" : null, boxNote].filter(Boolean).join("; "),
      });
    });
    records(got.dams, "dams", "usace-nid", (p, pt, c) => {
      const d = obj(p.details);
      const name = publicName(p);
      const owner = str(d["owner type"]);
      const unnamed = name ? null : owner && /private/i.test(owner) ? "name withheld (private owner); labelled by NID id" : "name not in the route's record text; labelled by NID id";
      return item(c, "dam", name, {
        code: str(p.id) ?? undefined,
        point: pt ?? undefined,
        note: [unnamed, str(d["hazard potential"]) ? `hazard potential ${str(d["hazard potential"])}` : null, str(d["condition assessment"]) ? `condition ${str(d["condition assessment"])}` : null, str(d["year completed"]) ? `completed ${str(d["year completed"])}` : null, str(d["owner type"]) ? `owner type ${str(d["owner type"])}` : null, boxNote]
          .filter(Boolean)
          .join("; "),
      });
    });
    const co = got.companies;
    const coCite = co?.ok ? cite(co, "sec-edgar") : null;
    if (co && coCite && !isCite(coCite)) miss(s, "public companies", coCite.reason);
    else if (co) {
      if (co.ok) {
        const feats = arr(obj(co.body.data).features).map(obj);
        const c = coCite!;
        const where = r.kind === "bbox" ? "inside the box" : "headquartered in the county";
        // The route reads a bundled SEC snapshot. `pulled` is the date of a full pull; null means the
        // committed hand-checked fixture, so a count from it is a count within that bundle, never a census.
        const pulled = str(co.body.pulled);
        const size = num(obj(co.body.bundle).companies);
        const universe = `within eye's SEC bundle${size != null ? ` of ${size} companies` : ""}${pulled ? ` pulled ${pulled}` : " (a committed fixture, pulled: null)"}; not every registrant`;
        if (!pulled) miss(s, `SEC-registered public companies ${where}`, `eye's SEC bundle is a committed fixture (pulled: null), not a full pull of EDGAR registrants, so it cannot say how many are ${where}; any listed are ${universe}`);
        else if (!feats.length) push(s, item(c, `public companies in eye's SEC bundle ${where}`, 0, { note: universe }));
        for (const f of capList(s, "public companies", feats, max)) {
          const x = obj(obj(f.properties).extra);
          const ticker = str(x.ticker);
          push(s, listRow(item(c, "public company (by ticker; names are not copied)", ticker, { code: x.cik != null ? `CIK ${str(x.cik)}` : undefined, note: [str(x.exchange), where, universe].filter(Boolean).join("; ") })));
        }
      } else miss(s, "public companies", co.reason ?? "failed");
    }
  }

  // ---- collections ----
  if (want("collections")) {
    const s = S.collections;
    if (!input.about) miss(s, "collections", "pass `about` (what you are looking for, in words) to rank eye's collections");
    const cat = got.catalog;
    if (cat) {
      if (cat.ok) {
        const hits = arr(obj(cat.body.data).hits).map(obj);
        // The ranking is cited to the catalogue's own provenance on the search route; the card is at ?id=.
        const c = cite(cat, "eye-catalog");
        if (obj(cat.body.data).matched === false) miss(s, "collections", "no word of `about` is in the embedder's vocabulary");
        if (!isCite(c)) {
          if (hits.length) miss(s, "collections", c.reason);
        } else
          for (const hit of hits.slice(0, max)) {
            const hid = str(hit.id);
            if (!hid) continue;
            const card = "/api/catalog" + q({ id: hid });
            push(s, listRow(item(c, "collection", str(hit.title), { code: hid, note: [num(hit.score) != null ? `cosine ${round(num(hit.score)!, 3)} between descriptions; not proof the collection answers the question` : null, `card: ${card}`].filter(Boolean).join("; ") })));
          }
      } else miss(s, "collections", cat.reason ?? "failed");
    }
  }

  // ---- freshness: next scheduled releases of the sources this reply cites ----
  if (want("freshness")) {
    const s = S.freshness;
    const cal = got.calendar;
    if (cal?.ok) {
      const publishers = new Map<string, string>();
      for (const sec of Object.values(S)) for (const it of sec.items) publishers.set(it.sourceId, it.publisher);
      // Soonest first, one per release title (a weekly release is listed once, at its next date).
      const seen = new Set<string>();
      const rel = arr(obj(cal.body.data).releases)
        .map(obj)
        .filter((x) => publishers.has(String(x.sourceId ?? "")))
        .sort((a, b2) => String(obj(a.window).nominal ?? "").localeCompare(String(obj(b2.window).nominal ?? "")))
        .filter((x) => {
          const k = `${String(x.sourceId)}|${String(x.title ?? x.id ?? "")}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      const span = [str(obj(cal.body.data).from), str(obj(cal.body.data).to)].filter(Boolean).join(" to ");
      if (!rel.length) miss(s, "next releases", `none of the sources cited here has a scheduled release on eye's calendar${span ? ` (${span})` : ""}`);
      for (const x of capList(s, "next releases", rel, max)) {
        const w = obj(x.window);
        const sid = String(x.sourceId);
        const it = item({ sourceId: sid, publisher: publishers.get(sid)!, upstreamUrl: str(x.scheduleUrl) ?? cal.url, retrievedAt: typeof cal.body.generatedAt === "string" ? cal.body.generatedAt : new Date().toISOString(), link: cal.url }, "next scheduled release", str(x.title), {
          period: str(w.nominal) ?? undefined,
          note: [str(x.precision) ? `${str(x.precision)} date` : null, str(w.earliest) && str(w.latest) ? `window ${str(w.earliest)} to ${str(w.latest)}` : null].filter(Boolean).join("; "),
        });
        push(s, it);
      }
    } else if (cal) miss(s, "next releases", cal.reason ?? "failed");
  }

  // ---- assemble, cap, report coverage ----
  const order: ("identity" | WorldTopic)[] = ["identity", ...WORLD_TOPICS.filter(want)];
  const out: Record<string, WorldSection> = {};
  for (const k of order) {
    const sec = S[k];
    out[k] = { items: sec.items, ...(sec.missing?.length ? { missing: sec.missing } : {}) };
  }
  const total = order.reduce((n, k) => n + S[k].items.length, 0);
  const place = {
    kind: r.kind,
    name: r.name,
    countyFips: r.countyFips,
    stateFips: r.stateFips,
    ...(r.usps ? { usps: r.usps } : {}),
    point: r.point,
    ...(r.kind === "bbox" || r.kind === "point" || r.kind === "county" ? { searchBox: r.box } : {}),
  };
  // An error reply is decided before the cap, so the cap is measured on what the client gets:
  // the payload plus the typed envelope fields toCallResult adds (code, category, retryable, remediation).
  let status = 200;
  const head: JsonObject = {};
  if (!total) {
    // Every route refusing with 401/403 is this server being turned away (deployment protection, a
    // missing credential), not an upstream outage: retrying the same call will not help.
    const answered = [fabric, screen, ...settled].filter((g): g is Got => !!g);
    if (answered.length && answered.every((g) => g.status === 401 || g.status === 403)) {
      status = 403;
      head.error = `auth refusal: every route this tool called answered HTTP 401 or 403 (${answered.length} calls), so the server behind this MCP is refusing it (deployment protection or a missing credential); this is not an upstream outage and retrying will not help`;
      head.refusal = "auth";
    } else {
      status = 502;
      head.error = "no source answered for this place; every part of the bundle is missing (see topics[*].missing)";
    }
  }
  const payload: JsonObject = {
    ...head,
    place,
    topics: out,
    limits: { maxBytes: WORLD_MAX_BYTES, maxRecords: max },
    note: "Every item cites sourceId, publisher, upstreamUrl and retrievedAt; `link` is the eye route that returns it. Missing is listed with its reason, never filled in. Names appear only on places, hospitals and non-private dams.",
  };

  let dropped = 0;
  const finish = () => {
    const basis: string[] = [];
    for (const k of order) {
      const sec = S[k];
      const lines = [...(sec.missing ?? []).map((m) => `${m.what}: ${m.reason}`), ...sec.cut];
      if (lines.length) out[k].coverageStatus = { status: "partial", basis: lines };
      else delete out[k].coverageStatus;
      for (const l of lines) basis.push(`${k}: ${l}`);
    }
    if (dropped) {
      payload.truncated = { droppedItems: dropped, note: `items cut from the longest topics to stay under ${WORLD_MAX_BYTES} bytes; ask fewer topics or a smaller max_records` };
      basis.push(`the reply was cut to ${WORLD_MAX_BYTES} bytes (${dropped} items dropped)`);
    }
    if (basis.length) payload.coverageStatus = { status: "partial", basis: basis.slice(0, 40) };
    else delete payload.coverageStatus;
    return sent();
  };
  const sent = () => bytes(status < 400 ? payload : { ...payload, ...envelopeForStatus(status, payload, false) });
  const popOne = (): boolean => {
    // List rows go first (the last row of the topic with the most of them): the 4th declaration or a
    // hospital is cut before a summary such as the drought reading or a live count.
    let rowsBest: ("identity" | WorldTopic) | null = null;
    let rowsN = 0;
    // Identity's list rows (counties touching a box) only once no other topic has any.
    for (const k of [...order.filter((x) => x !== "identity"), "identity" as const]) {
      const n = out[k].items.filter((i) => LIST_ROWS.has(i)).length;
      if (k === "identity" && rowsBest) break;
      if (n > rowsN) {
        rowsBest = k;
        rowsN = n;
      }
    }
    if (rowsBest) {
      const list = out[rowsBest].items;
      for (let i = list.length - 1; i >= 0; i--)
        if (LIST_ROWS.has(list[i])) {
          list.splice(i, 1);
          return true;
        }
    }
    let best: ("identity" | WorldTopic) | null = null;
    for (const k of order) if (k !== "identity" && out[k].items.length && (!best || out[k].items.length > out[best].items.length)) best = k;
    if (!best && out.identity.items.length > 1) best = "identity";
    if (!best) return false;
    out[best].items.pop();
    return true;
  };
  while (finish() > WORLD_MAX_BYTES && popOne()) dropped++;
  // A reply where everything failed can be long in its missing lists; trim those, then the summary basis.
  for (const k of [...order].reverse()) {
    while (finish() > WORLD_MAX_BYTES && (out[k].missing?.length ?? 0) > 1) out[k].missing!.pop();
  }
  const cs = payload.coverageStatus as CoverageStatus | undefined;
  while (cs && sent() > WORLD_MAX_BYTES && cs.basis.length > 1) cs.basis.pop();

  return { status, payload };
}
