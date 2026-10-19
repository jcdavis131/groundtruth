// MCP tool definitions for Embedding Atlas. Each tool is a thin, typed front
// on one of this app's own JSON routes: the handler builds the exact
// /api/... URL and relays whatever the route answered, so data logic lives in
// one place (the routes) and the MCP layer cannot drift from the HTTP API.
//
// Kept pure: no Next, no filesystem, and fetch is injected through
// ToolCtx.fetchJson so tests can assert the URL each tool asks for. Relative
// imports only (no "@/") so scripts/mcp-stdio.mjs can compile this directory
// on its own with tsc and run it outside Next.

import { z } from "zod";
import { replyCoverage } from "./coverage";
import { InvalidArguments } from "./errors";

/** What a route answered. `body` is the parsed JSON (or a string when the route did not send JSON). */
export interface JsonReply {
  status: number;
  body: unknown;
  /** The absolute URL that was fetched, for citations. */
  url: string;
}

export type FetchJson = (pathWithQuery: string) => Promise<JsonReply>;

export interface ToolCtx {
  fetchJson: FetchJson;
}

export type JsonObject = Record<string, unknown>;

/** What a tool handler returns: the route's JSON (verbatim, plus `note` when we had to add one) and the HTTP status it came with. */
export interface ToolReply {
  status: number;
  payload: JsonObject;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** Validate `input` against `inputSchema` (throws ZodError) and call the route. */
  run(input: unknown, ctx: ToolCtx): Promise<ToolReply>;
}

/** Added to the payload when a route answers 404: the server this MCP points at is older than the tool list. */
export const NOT_DEPLOYED_NOTE = "this route is not deployed on this server";

/** Character budget for one tool result before feature lists are halved (LLM context is the scarce resource). */
export const MAX_RESULT_CHARS = 400_000;

/** Default base URL for the stdio server and the Python client; the HTTP route uses its own origin. */
export const DEFAULT_BASE_URL = "http://localhost:3000";

type Param = string | number | boolean | undefined | null;

/**
 * Build "?a=1&b=x" from an ordered record. Undefined / null / empty values are
 * skipped. Commas and colons stay readable (bbox=w,s,e,n, site ids) because
 * the routes split on them and the URL is also the citation a reader sees.
 */
export function qs(params: Record<string, Param>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    const enc = encodeURIComponent(String(v)).replace(/%2C/gi, ",").replace(/%3A/gi, ":");
    parts.push(`${k}=${enc}`);
  }
  return parts.length ? "?" + parts.join("&") : "";
}

/** Coerce whatever the route sent into an object so we can attach a note without losing the payload. */
export function asObject(body: unknown): JsonObject {
  if (body && typeof body === "object" && !Array.isArray(body)) return body as JsonObject;
  return { data: body };
}

interface FeatureLike {
  geometry?: unknown;
  [k: string]: unknown;
}

function featuresOf(payload: JsonObject): FeatureLike[] | null {
  const data = payload.data;
  if (data && typeof data === "object" && Array.isArray((data as { features?: unknown }).features)) {
    return (data as { features: FeatureLike[] }).features;
  }
  return null;
}

function withFeatures(payload: JsonObject, features: FeatureLike[]): JsonObject {
  return { ...payload, data: { ...(payload.data as JsonObject), features } };
}

function addNote(payload: JsonObject, note: string): JsonObject {
  const prev = typeof payload.note === "string" && payload.note ? payload.note + " " : "";
  return { ...payload, note: prev + note };
}

/**
 * Replace polygon geometry with null on every feature of a FeatureCollection.
 * County and country outlines are megabytes; a model reading numbers does not
 * need them and can ask for `geometry: true` when it does.
 */
export function stripGeometry(payload: JsonObject): JsonObject {
  const feats = featuresOf(payload);
  if (!feats || !feats.some((f) => f.geometry)) return payload;
  return addNote(
    withFeatures(
      payload,
      feats.map((f) => ({ ...f, geometry: null })),
    ),
    "geometry omitted (pass geometry: true to include polygons, or call the HTTP route directly).",
  );
}

/**
 * Keep a result under MAX_RESULT_CHARS by halving the feature list (or a
 * top-level data array) until it fits, and say how many were dropped. Never
 * edits values; only shortens lists.
 */
export function boundPayload(payload: JsonObject, maxChars = MAX_RESULT_CHARS): JsonObject {
  let out = payload;
  let size = JSON.stringify(out).length;
  if (size <= maxChars) return out;
  const feats = featuresOf(out);
  const total = feats ? feats.length : Array.isArray(out.data) ? (out.data as unknown[]).length : 0;
  if (!total) return out;
  let keep = total;
  while (size > maxChars && keep > 1) {
    keep = Math.ceil(keep / 2);
    out = feats ? withFeatures(payload, feats.slice(0, keep)) : { ...payload, data: (payload.data as unknown[]).slice(0, keep) };
    size = JSON.stringify(out).length;
  }
  return addNote(out, `truncated to the first ${keep} of ${total} items to stay under ${maxChars} characters; narrow the box or call the HTTP route for the full set.`);
}

interface RelayOptions {
  /** Drop polygon geometry unless the caller asked for it. */
  dropGeometry?: boolean;
}

/**
 * Whether a reply came from a route handler. Routes answer JSON with an error
 * string, including their own 404s (an unknown ticker, a CIK that is not a
 * company). A path the server does not have answers Next's HTML not-found
 * page, which httpFetchJson turns into { error: "non-JSON reply", text }.
 */
function isRouteAnswer(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const error = (body as JsonObject).error;
  return typeof error === "string" && error !== "non-JSON reply";
}

/** Fetch a route and normalise its answer into a ToolReply. */
export async function relay(ctx: ToolCtx, path: string, opts: RelayOptions = {}): Promise<ToolReply> {
  const r = await ctx.fetchJson(path);
  let payload = asObject(r.body);
  if (r.status === 404 && !isRouteAnswer(r.body)) payload = addNote(payload, NOT_DEPLOYED_NOTE);
  else if (r.status >= 400) payload = addNote(payload, `route answered HTTP ${r.status}`);
  if (opts.dropGeometry) payload = stripGeometry(payload);
  const bounded = boundPayload(payload);
  const coverage = replyCoverage(bounded, bounded !== payload);
  payload = coverage ? { ...bounded, coverageStatus: coverage } : bounded;
  return { status: r.status, payload };
}

/**
 * A fetchJson over the real network for a base URL. Timeouts are generous
 * because the report ops fan out to several upstreams on a cold cache.
 */
export function httpFetchJson(baseUrl = DEFAULT_BASE_URL, fetchImpl: typeof fetch = fetch, timeoutMs = 55_000): FetchJson {
  const base = baseUrl.replace(/\/+$/, "");
  return async (pathWithQuery) => {
    const url = base + (pathWithQuery.startsWith("/") ? pathWithQuery : "/" + pathWithQuery);
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: "non-JSON reply", text: text.slice(0, 2000) };
    }
    return { status: res.status, body, url };
  };
}

// ---- shared field schemas -------------------------------------------------

const lon = z.number().min(-180).max(180).describe("Longitude in decimal degrees (WGS84, east positive).");
const lat = z.number().min(-90).max(90).describe("Latitude in decimal degrees (WGS84, north positive).");
const bbox = z
  .array(z.number())
  .length(4)
  .refine(([w, s, e, n]) => w < e && s < n && Math.abs(w) <= 180 && Math.abs(e) <= 180 && Math.abs(s) <= 90 && Math.abs(n) <= 90, "bbox must be [west, south, east, north] with west<east and south<north")
  .describe("[west, south, east, north] in decimal degrees. The route snaps it outward to a grid so nearby callers share a cache entry.");
const countyFips = z.string().regex(/^\d{5}$/, "5-digit county FIPS, e.g. 48453").describe("5-digit county FIPS (state 2 + county 3), e.g. 48453 for Travis County, TX.");
const areaFips = z
  .string()
  .regex(/^(\d{5}|US000)$/, "SSCCC for a county, SS000 for a state, US000 for the nation")
  .describe("5-digit county FIPS (48453), a state as SS000 (48000) or US000 for the nation.");
const iso3 = z.string().regex(/^[A-Za-z]{3}$/, "ISO 3166-1 alpha-3").describe("ISO 3166-1 alpha-3 country code, e.g. USA, MEX, CHN.");
const usgsSite = z.string().regex(/^USGS-\w+$/, "USGS-<site number>").describe("USGS monitoring location id with prefix, e.g. USGS-07032000 (Mississippi River at Memphis).");
const usgsParam = z
  .string()
  .regex(/^\d{5}$/, "5-digit USGS parameter code")
  .describe("USGS parameter code: 00060 discharge (ft3/s), 00065 gage height (ft), 00010 water temperature (degC), 00300 dissolved oxygen (mg/L), 00095 specific conductance (uS/cm), 00400 pH, 63680 turbidity (FNU), 00062/00054 reservoir elevation (ft) / storage (acre-ft).");
const seriesId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:_.\-]+$/, "series ids use letters, digits, ':', '_', '.', '-'")
  .describe("Series id, namespaced with ':' e.g. fred:MORTGAGE30US, zhvi:county:48453, indicator:mississippi-memphis-stage, snapshot:port-vessels:USLAX.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/, "YYYY-MM-DD or ISO 8601 Z").describe("YYYY-MM-DD (or full ISO 8601 with Z).");
const ticker = z.string().regex(/^[A-Za-z.\-]{1,10}$/, "ticker symbol").describe("Exchange ticker, e.g. AAPL, BRK.B.");
const cik = z.string().regex(/^\d{1,10}$/, "SEC CIK digits").describe("SEC Central Index Key, digits only (leading zeros optional), e.g. 320193.");
const geometry = z.boolean().optional().describe("Include polygon geometry (large). Default false: geometry is set to null on each feature.");

function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<S>;
  handler: (input: z.infer<z.ZodObject<S>>, ctx: ToolCtx) => Promise<ToolReply>;
}): ToolDef {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema as unknown as z.ZodObject<z.ZodRawShape>,
    // async so a ZodError (or a handler's own check) rejects instead of throwing before a promise exists.
    run: async (input, ctx) => def.handler(def.inputSchema.parse(input ?? {}), ctx),
  };
}

const bboxStr = (b: number[]) => b.join(",");

const ENVELOPE = "Every route answers { ...meta, data } where meta carries source, asOf/period and cacheAge; routes that opt in add provenance[] (see resource gev://docs/API.md).";

/**
 * FEMA's own note on where its social vulnerability comes from: the same text as NRI_SOVI_NOTE in
 * lib/hazards/nri.ts (kept literal: this directory compiles alone; tools.test.ts checks they agree).
 */
export const SOVI_LINEAGE_NOTE =
  "Social vulnerability as published in the National Risk Index. FEMA: \"Data for Social Vulnerability are provided by the U.S. Census Community Resilience Estimate\"; it is not the CDC/ATSDR Social Vulnerability Index, and the two can disagree.";

/** One side of a pairing: the route's answer verbatim, or what its 404 means; never a value made up. */
async function side(ctx: ToolCtx, path: string, missing: string): Promise<{ status: number; payload: JsonObject }> {
  const r = await relay(ctx, path);
  // A route's own 404 (an error string from the handler) means no row; a path the server lacks keeps relay's not-deployed note.
  if (r.status === 404 && typeof r.payload.error === "string" && r.payload.error !== "non-JSON reply") return { status: 404, payload: { ...r.payload, missing } };
  return r;
}

// ---- the tools ------------------------------------------------------------

/** Every MCP tool, in the order they are listed to clients. Append here to add one; the manifest, docs table and tests follow. */
export const TOOLS: ToolDef[] = [
  defineTool({
    name: "water_report",
    title: "Community water report for a point",
    description:
      "Server-built water report for a lon/lat: current US Drought Monitor class under the point, nearby USGS gauges (discharge ft3/s, stage ft, temperature degC, dissolved oxygen mg/L, conductance uS/cm, pH, turbidity FNU), NWS flood categories, Texas reservoirs (% full, acre-ft), groundwater wells (depth to water ft), and a water-stress estimate with its formula and caveats. No satellite turbidity term (that runs in a browser). Returns { source, county, globe (permalink), data: report }.",
    inputSchema: z.object({ lon, lat }),
    handler: (i, ctx) => relay(ctx, "/api/water" + qs({ op: "report", lon: i.lon, lat: i.lat })),
  }),
  defineTool({
    name: "market_report",
    title: "Market report for a point",
    description:
      "Server-built economy report for a lon/lat inside the US: county home value (Zillow ZHVI, USD, with yoy % and 5-year %), metro and national comparison, rent (ZORI, USD/month) and price-to-rent, an affordability estimate (mortgage payment vs county weekly wage, formula stated), jobs and average weekly wage (BLS QCEW, newest quarter), sector concentration with location quotients, ports and crossings within ~250 km, national pulse series (FRED + BTS) and a momentum index labelled as an estimate. " +
      ENVELOPE,
    inputSchema: z.object({ lon, lat }),
    handler: (i, ctx) => relay(ctx, "/api/economy" + qs({ op: "report", lon: i.lon, lat: i.lat })),
  }),
  defineTool({
    name: "areas",
    title: "Counties in a box, or every state",
    description:
      "GeoJSON FeatureCollection of US counties inside a bbox (or every state with level=state) joined with BLS QCEW employment, establishments and average weekly wage (USD, newest quarter, yoy %), Zillow ZHVI home value (USD, yoy %, 5y %) and ZORI rent (USD/month). Withheld QCEW cells stay null. Meta: asOf per source, polygons count, detail level. Geometry is nulled unless geometry=true. Boxes are clamped to 18 degrees and snapped to a 1 degree grid.",
    inputSchema: z.object({
      bbox: bbox.optional().describe("Required for level=county. [west, south, east, north] in degrees."),
      level: z.enum(["county", "state"]).optional().describe("county (default, needs bbox) or state (all 50 + DC + PR, no bbox)."),
      geometry,
    }),
    handler: (i, ctx) => {
      const level = i.level ?? "county";
      if (level === "county" && !i.bbox) throw new InvalidArguments("bbox is required for level=county (pass level: 'state' for all states)");
      const path = "/api/economy" + (level === "state" ? qs({ op: "areas", level: "state" }) : qs({ op: "areas", bbox: bboxStr(i.bbox!) }));
      return relay(ctx, path, { dropGeometry: !i.geometry });
    },
  }),
  defineTool({
    name: "sectors",
    title: "Private-sector NAICS mix for a county or state",
    description:
      "BLS QCEW private-sector employment by 2-digit NAICS sector for one county (SSCCC), state (SS000) or the nation (US000): employment (persons), establishments, average weekly wage (USD) and location quotient vs the US (>1 means over-represented). Newest published quarter; period is in the payload.",
    inputSchema: z.object({ fips: areaFips }),
    handler: (i, ctx) => relay(ctx, "/api/economy" + qs({ op: "sectors", fips: i.fips })),
  }),
  defineTool({
    name: "ports",
    title: "Harbours in a box with BTS volumes",
    description:
      "GeoJSON points for NGA World Port Index harbours inside a bbox (min = large | medium | small | all, default medium) with BTS Port Performance statistics where published: annual TEU, tonnage (short tons), vessel calls, dwell times (days). Meta says which BTS year and how many ports carry stats.",
    inputSchema: z.object({
      bbox,
      min: z.enum(["large", "medium", "small", "all"]).optional().describe("Smallest harbour size to include; default medium. Ports with BTS stats are always included."),
    }),
    handler: (i, ctx) => relay(ctx, "/api/economy" + qs({ op: "ports", bbox: bboxStr(i.bbox), min: i.min ?? "medium" })),
  }),
  defineTool({
    name: "border_crossings",
    title: "US land ports of entry",
    description:
      "GeoJSON points for every US land border port of entry with 25 months of BTS Border Crossing Entry Data: monthly counts of trucks, containers (loaded/empty), buses, personal vehicles, pedestrians. Meta: asOf month, number of ports.",
    inputSchema: z.object({}),
    handler: (_i, ctx) => relay(ctx, "/api/economy" + qs({ op: "border" })),
  }),
  defineTool({
    name: "countries",
    title: "Countries with World Bank indicators",
    description:
      "GeoJSON polygons (Natural Earth) for every country joined with World Bank WDI: GDP (current US$), exports and imports (% of GDP and current US$), trade/GDP, container port traffic (TEU), latest year per indicator. Geometry nulled unless geometry=true. Meta lists indicators that failed upstream.",
    inputSchema: z.object({ geometry }),
    handler: (i, ctx) => relay(ctx, "/api/economy" + qs({ op: "countries" }), { dropGeometry: !i.geometry }),
  }),
  defineTool({
    name: "trade_partners",
    title: "Top trading partners for a country",
    description: "World Bank WITS TradeStats: a country's top export and import partners for the latest available year, values in US$ thousands (meta.units). Partner ISO3 codes and names.",
    inputSchema: z.object({ iso3 }),
    handler: (i, ctx) => relay(ctx, "/api/economy" + qs({ op: "partners", iso3: i.iso3.toUpperCase() })),
  }),
  defineTool({
    name: "pulse",
    title: "National pulse series",
    description:
      "Latest observation and change for the national series the market report uses: FRED (30-year mortgage rate %, unemployment %, CPI, housing starts, industrial production, ...) and BTS Supply Chain Indicators (freight TSI, container imports TEU, ...). Each item: id, title, unit, latest value, previous, period, source. Meta lists ids that failed.",
    inputSchema: z.object({}),
    handler: (_i, ctx) => relay(ctx, "/api/economy" + qs({ op: "pulse" })),
  }),
  defineTool({
    name: "gauges",
    title: "Latest USGS gauge readings in a box",
    description:
      "USGS latest continuous readings for every monitoring location inside a bbox, one feature per site with its readings: discharge (ft3/s), gage height (ft), water temperature (degC), dissolved oxygen (mg/L), specific conductance (uS/cm), pH, turbidity (FNU), reservoir elevation (ft) and storage (acre-ft), each with its timestamp and approval status. Optional param code restricts to one parameter. Boxes are clamped to 4 degrees and snapped to 0.5 degrees.",
    inputSchema: z.object({ bbox, param: usgsParam.optional() }),
    handler: (i, ctx) => relay(ctx, "/api/water" + qs({ op: "gauges", bbox: bboxStr(i.bbox), param: i.param })),
  }),
  defineTool({
    name: "gauge_history",
    title: "365 days of daily means for one USGS site",
    description: "USGS daily values for one site and parameter code over the last 365 days: [{ time (ISO date), value, unit, approval }]. Units follow the parameter (00060 ft3/s, 00065 ft, 63680 FNU, ...).",
    inputSchema: z.object({ site: usgsSite, param: usgsParam }),
    handler: (i, ctx) => relay(ctx, "/api/water" + qs({ op: "history", site: i.site, param: i.param })),
  }),
  defineTool({
    name: "series_list",
    title: "List stored time series",
    description:
      "Metadata for every series in this server's series store, optionally filtered by id prefix (e.g. 'indicator:', 'snapshot:port-vessels:', 'zhvi:county:'): id, title, unit, frequency, geo, tags, provenance. Use before series_get. Answers 404 with a note on servers without the series route.",
    inputSchema: z.object({ prefix: z.string().max(200).optional().describe("Id prefix filter, e.g. 'indicator:'.") }),
    handler: (i, ctx) => relay(ctx, "/api/series" + qs({ op: "list", prefix: i.prefix })),
  }),
  defineTool({
    name: "series_get",
    title: "Read one time series",
    description:
      "Points for one series id: { t: epoch ms UTC, v: number | null } with unit, frequency and provenance. Optional from/to bound the window and rollup (daily | weekly | monthly) asks the route to aggregate. Null v means the upstream withheld or the feed was down; never interpolated.",
    inputSchema: z.object({
      id: seriesId,
      from: isoDate.optional(),
      to: isoDate.optional(),
      rollup: z.enum(["daily-mean", "daily-max", "daily-last"]).optional().describe("Reduce to one point per UTC day: mean, max or last sample. The store keeps sample cadence."),
    }),
    handler: (i, ctx) => relay(ctx, "/api/series" + qs({ op: "get", id: i.id, from: i.from, to: i.to, rollup: i.rollup })),
  }),
  defineTool({
    name: "screen",
    title: "Screen counties, states, ports, crossings or countries",
    description:
      "Rank and filter one entity set by its published metrics without loading polygons. query syntax: '<where> [SORT field [ASC|DESC]] [LIMIT n] [OFFSET n]' with comparisons (home.yoyPct > 5, jobs.yoy.emp <= 0, state == TX), BETWEEN, IN (...), CONTAINS, AND/OR and parentheses; e.g. 'home.yoyPct > 5 AND jobs.yoy.emp < 0 SORT momentum DESC LIMIT 50'. Returns data.rows [{ id, name, geo [lon,lat], values {field: value} }], count, total, stats per field, fields[] with label/unit/estimate method, provenance[]. Pass fields: true to get the field registry for a kind instead of running a query. Values the upstream withheld are null and never match.",
    inputSchema: z.object({
      kind: z.enum(["county", "state", "port", "crossing", "country"]).describe("Entity set to screen."),
      query: z.string().max(2000).optional().describe("Filter/sort expression in the screener syntax; required unless fields is true."),
      fields: z.boolean().optional().describe("true: return the field registry (key, label, unit, source, method) for kind and ignore query."),
    }),
    handler: (i, ctx) => {
      if (i.fields) return relay(ctx, "/api/screen" + qs({ kind: i.kind, fields: 1 }));
      if (!i.query) throw new InvalidArguments("query is required (or pass fields: true for the field list)");
      return relay(ctx, "/api/screen" + qs({ kind: i.kind, q: i.query }));
    },
  }),
  defineTool({
    name: "indicators",
    title: "Latest named indicators with status",
    description:
      "Latest value, yoy change and threshold status (ok | watch | alert) for the named indicators (freight, housing, water, energy, labour, trade, macro), each with unit, period, whyItMatters, the threshold rules with citations, and provenance. Filter by comma-separated ids or one category.",
    inputSchema: z.object({
      ids: z.array(z.string().regex(/^[a-z0-9\-]+$/)).max(50).optional().describe("Indicator ids (kebab-case), e.g. ['mississippi-memphis-stage']."),
      category: z.enum(["freight", "housing", "water", "energy", "labour", "trade", "macro"]).optional(),
    }),
    handler: (i, ctx) => relay(ctx, "/api/indicators" + qs({ op: "latest", ids: i.ids?.join(","), category: i.category })),
  }),
  defineTool({
    name: "indicator_history",
    title: "History of one indicator",
    description:
      "The series behind one indicator id (live upstream window merged with the stored indicator:<id> points): data is a Series { id, title, unit, frequency, points [{ t: epoch ms, v }], provenance } with a citation-ready upstream URL. Thresholds live on the indicator's meta (use indicators(ids: [id])). Optional from/to bound the window; limit caps points (newest kept, max 5000).",
    inputSchema: z.object({
      id: z.string().regex(/^[a-z0-9\-]+$/, "kebab-case id").describe("Indicator id, e.g. mississippi-memphis-stage."),
      from: isoDate.optional(),
      to: isoDate.optional(),
      limit: z.number().int().min(1).max(5000).optional(),
    }),
    handler: (i, ctx) => relay(ctx, "/api/indicators" + qs({ op: "history", id: i.id, from: i.from, to: i.to, limit: i.limit })),
  }),
  defineTool({
    name: "release_calendar",
    title: "Upcoming data releases",
    description: "Scheduled publication dates for the upstream releases this app depends on (BLS QCEW, Zillow, BTS, FRED series, USGS ...) between from and to (default: next 45 days): { id, name, publisher, releaseAt ISO, period, url }.",
    inputSchema: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
    handler: (i, ctx) => relay(ctx, "/api/releases" + qs({ op: "calendar", from: i.from, to: i.to })),
  }),
  defineTool({
    name: "movers",
    title: "Biggest movers since the last release",
    description:
      "Top n rows by change between the two latest vintages of one upstream table: zillow (metric zhviCounty | zoriCounty | zhviState ...), qcew (emp | wage ...), border (Trucks | Containers ...), ports (container ...). Each row: entity, previous and latest values with unit and period, change and % change. min drops rows whose latest value is below it (e.g. counties with fewer than 10,000 jobs). Default n = 20, max 200; the route names the valid metrics for a table when metric is omitted or wrong.",
    inputSchema: z.object({
      table: z.enum(["zillow", "qcew", "border", "ports"]).describe("Upstream table to rank."),
      metric: z.string().max(40).regex(/^[A-Za-z0-9_.\-]+$/, "metric name").optional().describe("Metric within the table; the route picks its default when omitted."),
      n: z.number().int().min(1).max(200).optional().describe("How many rows; default 20."),
      min: z.number().min(0).optional().describe("Minimum latest value to include a row."),
    }),
    handler: (i, ctx) => relay(ctx, "/api/releases" + qs({ op: "movers", table: i.table, metric: i.metric, n: i.n, min: i.min })),
  }),
  defineTool({
    name: "county_history",
    title: "Multi-year history for a county",
    description:
      "Backfilled research series for one county as data.series[]: QCEW employment and average weekly wage (USD, quarterly), Zillow ZHVI (USD) and ZORI (USD/month, monthly), momentum:county:<fips> (estimate, index -1..1, formula in provenance.method) and the affordability index, each a Series with points [{ t: epoch ms, v }] and provenance. years bounds the window (1..26, default 10); lag shifts the momentum inputs by months (0..12) for lead/lag studies. topic: \"hazards\" instead returns the county's hazard history (GET /api/hazards?op=history): FEMA disaster declarations per year by type (fema:dr/em/fm) and the newest 50 declarations, the U.S. Drought Monitor's weekly DSCI (0-500) since 2000 and this week's D0-D4 shares, NOAA Climate at a Glance annual temperature and precipitation since 1895, NOAA SPC tornadoes per year since 1950, USGS landslide susceptibility, and NCEI Storm Events county-coded event counts per year by type since 1996 (se:<type>:<fips>, e.g. se:hail; tornadoes are SPC's; a type's year in which 10 % or more of its reports nationally were zone-coded is null, never 0); years is then the last 1..26 years (default all) and lag is not accepted. Connecticut's planning regions get drought only; Alaska gets no storm events (NCEI's Alaska rows are its own areas).",
    inputSchema: z
      .object({
        fips: countyFips,
        years: z.number().int().min(1).max(26).optional().describe("Years of history to return; default 10 (economy) or all (hazards)."),
        lag: z.number().int().min(0).max(12).optional().describe("Months of lag applied to the momentum inputs; default 0. Economy only."),
        topic: z.enum(["economy", "hazards"]).optional().describe("economy (default) or hazards."),
      })
      .refine((v) => v.topic !== "hazards" || v.lag == null, "lag applies to the economy topic only"),
    handler: (i, ctx) =>
      i.topic === "hazards"
        ? relay(ctx, "/api/hazards" + qs({ op: "history", fips: i.fips, years: i.years, declarations: 50 }))
        : relay(ctx, "/api/economy/history" + qs({ op: "county", fips: i.fips, years: i.years, lag: i.lag })),
  }),
  defineTool({
    name: "company",
    title: "Public company from SEC filings",
    description:
      "One public company by ticker or CIK from SEC EDGAR: name, CIK, SIC and description, state of incorporation, business address at the county/state level, latest 10-K / 10-Q facts (revenue, net income, employees, USD as reported) and filing URLs. Public filings only; no people, no private companies.",
    inputSchema: z
      .object({ ticker: ticker.optional(), cik: cik.optional() })
      .refine((v) => !!v.ticker !== !!v.cik, "pass exactly one of ticker or cik"),
    handler: (i, ctx) => relay(ctx, "/api/companies" + qs({ op: "company", ticker: i.ticker?.toUpperCase(), cik: i.cik })),
  }),
  defineTool({
    name: "companies_near",
    title: "Public companies headquartered in a box or county",
    description: "SEC-registered public companies whose business address falls inside a bbox or a county FIPS: ticker, name, CIK, SIC, exchange, and the county they sit in. GeoJSON points. Pass exactly one of bbox or fips.",
    inputSchema: z.object({ bbox: bbox.optional(), fips: countyFips.optional() }).refine((v) => !!v.bbox !== !!v.fips, "pass exactly one of bbox or fips"),
    // Two ops upstream: near (bbox) and county (fips).
    handler: (i, ctx) => relay(ctx, "/api/companies" + (i.bbox ? qs({ op: "near", bbox: bboxStr(i.bbox) }) : qs({ op: "county", fips: i.fips }))),
  }),
  defineTool({
    name: "banks",
    title: "FDIC-insured bank offices in a county",
    description: "FDIC Summary of Deposits for one county: bank offices with institution name, deposits (USD thousands, as of the SOD date), and the county totals. Institutions only; no account holders.",
    inputSchema: z.object({ fips: countyFips }),
    handler: (i, ctx) => relay(ctx, "/api/finance" + qs({ op: "banks", fips: i.fips })),
  }),
  defineTool({
    name: "federal_spending",
    title: "Federal awards to a county",
    description: "USAspending.gov awards by place of performance for one county: totals by fiscal year and agency (USD obligated), top award types, with the query URL for citation. Aggregates only.",
    inputSchema: z.object({ fips: countyFips }),
    handler: (i, ctx) => relay(ctx, "/api/finance" + qs({ op: "spending", fips: i.fips })),
  }),
  defineTool({
    name: "place_fabric",
    title: "Every construct a point sits inside",
    description:
      "The place fabric for a lon/lat: the human and scientific constructs the point is inside, smallest first, each with kind, point of view (civic, representation, service, statistical, hydrologic, ecological, hazard, federal, world), name, code and published area (km2). US points get state, county, city, census tract, ZIP code area, school district, congressional and state legislative districts, metro area, urban area, tribal land, census division and region (Census TIGERweb); HUC-2 to HUC-12 watersheds with the downstream HUC (USGS WBD); level III/IV ecoregions (EPA); flood zone, NFIP community and FIRM panel (FEMA NFHL); NWS forecast office, zone and time zone; elevation (USGS 3DEP); EPA and FEMA regions and Federal Reserve district. Elsewhere, the country. edges[] carry only relations the unit systems define (nests-in, drains-to, assigned-to) with their basis. Upstreams that failed are listed in failed[]. Use it to connect reports: the county code feeds sectors / county_history / banks / federal_spending, the point feeds water_report and market_report. " +
      ENVELOPE,
    inputSchema: z.object({ lon, lat, geometry: z.boolean().optional().describe("Include each construct's generalised outline as rings of [lon, lat] (large). Default false.") }),
    handler: (i, ctx) => relay(ctx, "/api/fabric" + qs({ op: "stack", lon: i.lon, lat: i.lat, geometry: i.geometry ? 1 : undefined })),
  }),
  defineTool({
    name: "place_compare",
    title: "Which constructs two places share",
    description:
      "Compare the place fabric of two points: for every construct kind, whether both points are inside the same unit (shared), in different units of that kind (differs: same county, different congressional district), or only one point has a unit of that kind (only-a / only-b; a boundary published at one point is not a difference). Returns a one-line summary, counts, the smallest construct both are inside (meet), and one row per kind with each side's id, name, code and area, plus a globe link that opens the comparison. " +
      ENVELOPE,
    inputSchema: z.object({
      lon,
      lat,
      lon2: lon.describe("Longitude of point B, degrees."),
      lat2: lat.describe("Latitude of point B, degrees."),
    }),
    handler: (i, ctx) => relay(ctx, "/api/fabric" + qs({ op: "compare", lon: i.lon, lat: i.lat, lon2: i.lon2, lat2: i.lat2 })),
  }),
  defineTool({
    name: "construct_field",
    title: "One kind of construct tiled across a box",
    description:
      "Every unit of one construct kind inside a bbox (US): county, place, cd (congressional district), sldu, sldl, cbsa, tract, zcta, school, huc2..huc12 (USGS watersheds), eco3/eco4 (EPA ecoregions), state. Each unit: id, kind, name, code, areaKm2 (land for Census, total for WBD, computed from the outline where the upstream publishes none, flagged in facts), anchor [lon, lat], and rings when geometry=true. Pass pov (hydrologic | civic | representation | statistical | ecological | service) with h (camera height, m) instead of kind to get the kind that emerges at that scale. The bbox is clamped per kind and snapped; the payload says which box was asked. " +
      ENVELOPE,
    inputSchema: z.object({
      bbox,
      kind: z.string().optional().describe("Construct kind; omit when passing pov and h."),
      pov: z.enum(["hydrologic", "civic", "representation", "statistical", "ecological", "service"]).optional(),
      h: z.number().positive().optional().describe("Camera height in metres, with pov."),
      geometry: z.boolean().optional().describe("Keep each unit's generalised outline (large). Default false: rings are dropped."),
    }),
    handler: async (i, ctx) => {
      if (!i.kind && !(i.pov && i.h)) throw new InvalidArguments("pass kind, or pov and h");
      const reply = await relay(ctx, "/api/fabric" + qs({ op: "field", kind: i.kind, pov: i.kind ? undefined : i.pov, h: i.kind ? undefined : i.h, bbox: bboxStr(i.bbox) }));
      if (!i.geometry) {
        const data = reply.payload.data as { units?: Array<Record<string, unknown>> } | undefined;
        if (data?.units) for (const u of data.units) delete u.rings;
      }
      return reply;
    },
  }),
  defineTool({
    name: "downstream",
    title: "Where the water from a point goes",
    description:
      "Walks USGS WBD ToHUC from the HUC-12 under a lon/lat to its terminal (ocean, closed basin, canada, mexico): steps [{ hop, huc12, name, areaKm2, centroid [lon, lat], to }], terminal, basins (HUC-4 codes crossed), totalAreaKm2, centroidPathKm (straight lines between unit centroids; not river length), truncated. The first walk through a basin can take tens of seconds (WBD is slow); later calls are cached. " +
      ENVELOPE,
    inputSchema: z.object({ lon, lat }),
    handler: (i, ctx) => relay(ctx, "/api/fabric" + qs({ op: "downstream", lon: i.lon, lat: i.lat })),
  }),
  defineTool({
    name: "upstream",
    title: "Everything that drains to a point",
    description:
      "The catchment of the HUC-12 under a lon/lat, from the bundled national WBD ToHUC table read backwards: start, startName, huc12s (count upstream, the start included), cover [{ code, level }] (the smallest set of whole WBD units, level 2 to 12 digits, that is exactly the catchment), byLevel, basins (HUC-4). Names, outlines and published areas of the cover come from GET /api/fabric?op=units&codes=... Answers in about a second. " +
      ENVELOPE,
    inputSchema: z.object({ lon, lat }),
    handler: (i, ctx) => relay(ctx, "/api/fabric" + qs({ op: "upstream", lon: i.lon, lat: i.lat })),
  }),
  defineTool({
    name: "flow_normals",
    title: "Daily streamflow percentiles for USGS gauges",
    description:
      "USGS daily-mean discharge percentiles (5th, 10th, 25th, 50th, 75th, 90th, 95th, cfs) for one calendar day, per site, from the Water Data Statistics API: { <site>: { p: { 5: .., 50: .., 95: .. }, years } | null }. Place a gauge's latest flow (from gauges) among them to say whether its river is below, near or above normal for the date. " +
      ENVELOPE,
    inputSchema: z.object({
      sites: z.array(z.string().regex(/^(USGS-)?\d{8,15}$/)).min(1).max(200).describe("USGS site numbers, with or without the USGS- prefix"),
      date: z
        .string()
        .regex(/^\d{2}-\d{2}$/)
        .optional()
        .describe("MM-DD; today (UTC) when omitted"),
    }),
    handler: (i, ctx) => relay(ctx, "/api/water" + qs({ op: "normals", sites: i.sites.join(","), date: i.date })),
  }),
  defineTool({
    name: "water_trace",
    title: "The river reach a point drains to, and where its water goes",
    description:
      "Two steps on the NHDPlus V2 network through USGS NLDI. With lon and lat: the reach the point drains to (GET /api/water?op=reach): { comid, reach: { name, ftypeWord, streamOrder, drainageKm2, flowCfs (EROM gauge-adjusted mean annual flow, model output), runoffCfs, reachcode, fdate } }, comid null where there is no NHDPlus catchment. With comid and mode: one trace (GET /api/water?op=trace) as GeoJSON: down = main stem downstream (MultiLineString, distance default 100 km), basin = drainage basin polygon (at most 2,000 vertices), gauges = USGS stream gauges upstream (Points with identifier USGS-<site>, default 150 km); distance at most 500 km, and the gauge count depends on it. A river path by flowline, unlike downstream (HUC-12 watersheds). " +
      ENVELOPE,
    inputSchema: z
      .object({
        lon: lon.optional(),
        lat: lat.optional(),
        comid: z.number().int().positive().optional().describe("NHDPlus V2 comid from the lon/lat step"),
        mode: z.enum(["down", "basin", "gauges"]).optional(),
        distance: z.number().int().min(1).max(500).optional().describe("km of channel for down and gauges"),
      })
      .refine((v) => (v.lon != null && v.lat != null && v.comid == null && v.mode == null) || (v.comid != null && v.mode != null && v.lon == null && v.lat == null), "pass lon and lat (the reach), or comid and mode (a trace)"),
    handler: (i, ctx) =>
      relay(ctx, "/api/water" + (i.comid != null ? qs({ op: "trace", comid: i.comid, mode: i.mode, distance: i.distance }) : qs({ op: "reach", lon: i.lon, lat: i.lat }))),
  }),
  defineTool({
    name: "risk_index",
    title: "FEMA National Risk Index for counties or tracts in a box",
    description:
      "FEMA's National Risk Index (December 2025) as published (GET /api/hazards?op=nri): level county (default) gives attribute rows for every county touching the bbox (STCOFIPS, COUNTY, STATEABBRV, RISK_SCORE and RISK_RATNG, EAL_VALT in dollars a year and EAL_RATNG, SOVI_SCORE/SOVI_RATNG, RESL_SCORE/RESL_RATNG, and the 18 hazard ratings AVLN_RISKR to WNTW_RISKR); level tract gives tract polygons with the same fields plus TRACTFIPS (box at most 0.4 degrees). A relative index: ratings are percentiles among all counties (or tracts), not likelihoods; 'Not Applicable' and 'Insufficient Data' are not low. Social vulnerability here is FEMA's (from the Census Community Resilience Estimate), not CDC SVI. " +
      ENVELOPE,
    inputSchema: z.object({ bbox, level: z.enum(["county", "tract"]).optional() }),
    handler: (i, ctx) => relay(ctx, "/api/hazards" + qs({ op: "nri", bbox: bboxStr(i.bbox), level: i.level })),
  }),
  defineTool({
    name: "social_vulnerability",
    title: "CDC/ATSDR SVI beside FEMA's NRI social vulnerability for one county or tract",
    description:
      "Two different social vulnerability indices for one place, side by side and never merged: cdcSvi is CDC/ATSDR's Social Vulnerability Index 2022 (GET /api/civic?op=svi&level=place: overall and four theme percentiles 0-1, 0 least to 1 most vulnerable among US counties or tracts, flags, and 16 ACS 2018-2022 estimates with margins; null where CDC does not rank); femaNri is FEMA's National Risk Index row (GET /api/hazards?op=nri&fips=: SOVI_SCORE 0-100 and SOVI_RATNG, from the Census Community Resilience Estimate, plus the rest of the NRI row). Each keeps its native form; do not convert one to the other, average them or rank one against the other. A side FEMA or CDC has no row for comes back with HTTP 404 and `missing` ('not in this release' or 'not in the index'); the other side is still answered. " +
      ENVELOPE,
    inputSchema: z.object({ fips: z.string().regex(/^(\d{5}|\d{11})$/, "5-digit county or 11-digit tract FIPS").describe("5-digit county FIPS (48453, Travis County, TX) or 11-digit census tract FIPS (48453001308).") }),
    handler: async (i, ctx) => {
      const [cdc, fema] = await Promise.all([
        side(ctx, "/api/civic" + qs({ op: "svi", level: "place", fips: i.fips }), "not in this release: CDC/ATSDR SVI 2022 has no row for this FIPS"),
        side(ctx, "/api/hazards" + qs({ op: "nri", fips: i.fips }), "not in the index: FEMA's National Risk Index has no row for this FIPS"),
      ]);
      return {
        status: cdc.status === 200 || fema.status === 200 ? 200 : cdc.status,
        payload: {
          fips: i.fips,
          cdcSvi: { title: "CDC/ATSDR Social Vulnerability Index 2022 (ACS 2018-2022; percentile 0-1)", status: cdc.status, ...cdc.payload },
          femaNri: { title: "FEMA National Risk Index: social vulnerability (Census Community Resilience Estimate; score 0-100 and rating)", status: fema.status, ...fema.payload },
          note: `Two indices from different publishers and inputs, shown side by side; nothing here is derived from both. ${SOVI_LINEAGE_NOTE}`,
        },
      };
    },
  }),
  defineTool({
    name: "broadband_availability",
    title: "FCC broadband availability for one county (BDC December 2025, via Esri)",
    description:
      "Fixed broadband availability for one county from the FCC Broadband Data Collection, December 2025, as Esri summarizes it (GET /api/civic?op=broadband&level=place): Broadband Serviceable Locations in total and by the FCC's served (100/20 Mbps or more on low-latency fiber, cable, copper or licensed fixed wireless), underserved (25/3 up to 100/20) and unserved tiers, each by technology (copper, cable, fiber, licensed fixed wireless, licensed-by-rule fixed wireless), unique providers, and Esri's 6- and 12-month-previous counts as published. shares[] gives each share as a named ratio of two published counts (e.g. UnservedBSLs / TotalBSLs), null where there are no locations. Availability as providers report it: not subscription, not measured speed. Esri's layer is under the Esri Master License Agreement; the figures are the FCC's. Connecticut is published only in its legacy counties (09001-09015), so a planning-region FIPS (09110-09190) answers 404 'not in this release'. " +
      ENVELOPE,
    inputSchema: z.object({ fips: z.string().regex(/^\d{5}$/, "5-digit county FIPS").describe("5-digit county FIPS, e.g. 48453 (Travis County, TX).") }),
    handler: (i, ctx) => relay(ctx, "/api/civic" + qs({ op: "broadband", level: "place", fips: i.fips })),
  }),
  defineTool({
    name: "live_events",
    title: "Where the world is doing something unusual now",
    description:
      "NWS active alerts rated Severe or Extreme (event, severity, urgency, certainty, headline, areaDesc, onset, expires, outline rings) and the past day's M4.5+ earthquakes, plus both merged in tour order (items: kind, title, subtitle, lon, lat, bbox, time, until, url). The order uses only NWS and USGS published fields; it is not a risk score. " +
      ENVELOPE,
    inputSchema: z.object({}),
    handler: (_i, ctx) => relay(ctx, "/api/live"),
  }),
  defineTool({
    name: "catalog_search",
    title: "Find the right collection by meaning",
    description:
      "The catalogue's collections ranked by meaning for a query: the query is embedded with potion-base-8M (MinishLab, MIT; a static model run on the server) and compared with each card's own description (title, what it holds, what a record is). Collections only; records loaded on the globe are searched in the browser palette. Returns hits [{ id, title, layer, score (cosine), ops, catalog }], embedder { id, model, commit, tableSha256, licence } and matched (false when no word of the query is in the vocabulary). A score says two descriptions read alike, not that the data answer the question. Read a collection with GET /api/catalog?id=<id>. " +
      ENVELOPE,
    inputSchema: z.object({
      q: z.string().min(2).max(200).describe("What you are looking for, in words, e.g. 'wetland habitat' or 'leaking fuel tanks'."),
      limit: z.number().int().min(1).max(10).optional().describe("How many collections (default 5)."),
    }),
    handler: (i, ctx) => relay(ctx, "/api/catalog" + qs({ op: "search", q: i.q, limit: i.limit })),
  }),
  defineTool({
    name: "place_export",
    title: "A collection counted per county",
    description:
      "A committed per-county aggregate of a catalogued collection, as a candidate place tower, keyed by 5-digit county FIPS. npl-status: National Priorities List sites per county and year 2015-2025 (active, listed in the year, deleted in the year, construction complete cumulative), value[place][year][feature], with siteIds (the EPA IDs behind each count); a county in neither places nor nullPlaces has 0 (the NPL list is complete). ust-releases-county and ust-facilities-county: EPA UST Finder's county counts of leaking-tank releases (all, open, no further action) and of tank facilities and tanks (open, closed, temporarily out of service), one static snapshot of 2018-2021 state records, value[place][feature], with nullCells (a field the layer leaves null: null, not 0) and sourceIds. The release layer never publishes a 0 for its open or no-further-action counts, so a null there most likely means 0 for many counties; the nulls are kept and are not random (every Kentucky county's open count, every Puerto Rico county's no-further-action count, and scattered counties elsewhere; meta.nullCellNote, meta.counts.nullCellsByState). fuds-properties: USACE FUDS properties per county from the FY2024 inventory (all, with cleanup projects, with projects not all closed out), value[place][feature], with propertyIds and unlocated properties listed by state; a county in neither places nor nullPlaces has 0, meaning no property USACE locates in that county (265 properties with no county and no point are in no county's count; this zero rule is approved, and meta.counts.strictRule gives the stricter alternative's coverage for reference). Every export is served with meta (form series or static, always present, source query, page sha256s, fetch time, counts, join checks, zero and null rules) and nullPlaces (counties whose value is unknown, each with its reason). " +
      ENVELOPE,
    // The same ids as PLACE_EXPORTS in lib/catalog/placeExport.ts (kept literal: this directory compiles alone); tools.test.ts checks they agree.
    inputSchema: z.object({ collection: z.enum(["npl-status", "ust-releases-county", "ust-facilities-county", "fuds-properties"]).describe("Which aggregate.") }),
    handler: (i, ctx) => relay(ctx, "/api/catalog" + qs({ op: "place-export", collection: i.collection })),
  }),
  defineTool({
    name: "openapi",
    title: "OpenAPI description of the HTTP API",
    description: "The OpenAPI 3 document for this server's /api routes (paths, parameters, response envelopes). Use it to call routes this tool list does not cover.",
    inputSchema: z.object({}),
    handler: (_i, ctx) => relay(ctx, "/api/openapi"),
  }),
];

/** Look a tool up by name. */
export function toolByName(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
