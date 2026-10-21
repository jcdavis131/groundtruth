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
//   - An item also carries upstreamRecordUrl, a keyless query URL on its own
//     publisher's host for exactly that record (a GEOID, a disaster number, a
//     PWSID), or its note says "no record-level URL" and why. Agents cite the
//     publisher for the fact and use link to reproduce it.
//   - A county is centred on Census's internal point from the bundled county
//     table (ctx.countyPoint), never on a map anchor.
//   - Items about eye's own catalogue are kind "about-eye": claims about what
//     eye holds, not about the world.
//   - A count this tool makes from a route's list (alerts or quakes touching a box, hospitals or
//     dams found, companies in the bundle) is kind "estimate": the publisher states no such
//     number. It names its inputs (the source, the route whose reply held the rows, that
//     source's own retrieval time) where another item has a record URL, and says so in its note.
//   - Every item says when the data eye serves for its source was fixed (snapshotAt: the retrievedAt its
//     route sent, or a bundle's own recorded date; null, with the reason in the note, where none is
//     recorded), the date the publisher itself puts on the data where the item's route states one
//     (publishedAt: PUBLISHED below reads it from named fields, never from retrievedAt, never from today;
//     null where the route states none) and, where eye's release calendar has an entry for the publisher,
//     how often it releases (cadence; absent where the calendar has none). A source whose publishedAt, else
//     snapshotAt, is older than its cadence allows (STALE_AFTER_DAYS) is listed in its topic's missing with
//     the code `stale`, once; its items are still shown. Stale is a label.
//   - Missing is absent with a reason (topics[t].missing), never a placeholder;
//     a value BLS withheld is null with the reason, not 0. Every missing entry also
//     carries a code and the action the agent may take (./absence): not_published and
//     withheld come only from a route's own missing entry or the publisher's own flag.
//   - The reply says schemaVersion "world/2" and is validated against ./worldSchema
//     (the outputSchema in tools/list and GET /api/mcp) before it is sent.
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

import { absence, codeForRouteEntry, type AbsenceCode, type AbsenceEntry, type BasisLine } from "./absence";
import type { CoverageStatus } from "./coverage";
import { envelopeForStatus } from "./errors";
import type { JsonObject, JsonReply, ReleaseCadence, ToolCtx, ToolReply } from "./tools";
import { WORLD_SCHEMA_VERSION } from "./worldSchema";

/** Topics a caller can ask for. identity is always included. */
export const WORLD_TOPICS = ["fabric", "hazards", "economy", "vulnerability", "institutions", "water", "freshness", "collections"] as const;
export type WorldTopic = (typeof WORLD_TOPICS)[number];

/**
 * Hard cap on the reply: UTF-8 bytes of the JSON text. 40,000 since record-level URLs and the water
 * topic (2026-10-19): they add 150 to 250 bytes an item, and at 24,000 the default Austin and
 * Collegeville replies dropped 12 and 11 items, and at 32,000 Austin still dropped its 2 companies.
 * 40,000 keeps every recorded default reply whole, with room for a point with more fabric.
 */
export const WORLD_MAX_BYTES = 40_000;
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
  /** The publisher's own keyless URL for exactly this record; absent when none exists (the note says so). */
  upstreamRecordUrl?: string;
  retrievedAt: string;
  /**
   * When the data eye serves for this source was fixed: the retrievedAt its route sent, or for a bundle its own recorded
   * date (the SEC bundle's `pulled`), as written (a date or a UTC datetime). null where none is recorded, and the reason
   * ends the note ("no snapshot date: ..."). Never the reply's own time.
   */
  snapshotAt?: string | null;
  /**
   * The date the publisher itself puts on the data behind this item (a last-edit date, or the Drought Monitor's map date), as
   * the item's route states it (a date or a UTC datetime, as written). null where the route states none, which most do; the
   * reply's note says so once. Never the retrievedAt, never the reply's time, never today. Added with 0.7.0.
   */
  publishedAt?: string | null;
  /**
   * How often the publisher releases, from eye's release calendar (kind, whether the date is official or approximate, the
   * calendar entry's id). Absent where the calendar has no entry for the publisher (that says nothing about how often it
   * releases) and when this server was given no calendar.
   */
  cadence?: ReleaseCadence;
  link: string;
  /**
   * "about-eye": a claim about eye's own catalogue, not about the world; it has no upstream to confirm.
   * "estimate": a value this tool computed from a route's list (a count inside a box), not a number the publisher states;
   * it names its `inputs`.
   */
  kind?: "about-eye" | "estimate";
  /** For kind "estimate": what the value was computed from. */
  inputs?: WorldItemInput[];
  /** "withheld": the value is null because the publisher's own suppression flag says so (BLS QCEW jobs.suppressed). */
  absence?: "withheld";
}

/** One input of an estimate (worldSchema.ts INPUT_SCHEMA): the source, the eye route whose reply held the rows, the publisher's URL for what the route read, and when. */
export interface WorldItemInput {
  sourceId: string;
  /** The eye route that returned the rows (the item's `link`). */
  route: string;
  /** The publisher's own https URL for the layer, list or feed the route read; absent when the source states none. */
  upstreamRecordUrl?: string;
  /** When this source was retrieved, ISO 8601 UTC: the source's own entry in the route's provenance, not the reply's time. */
  retrievedAt: string;
}

export interface WorldSection {
  items: WorldItem[];
  missing?: AbsenceEntry[];
  coverageStatus?: CoverageStatus;
}

type Section = WorldSection & { cut: BasisLine[] };

// ---- fetching ----------------------------------------------------------------

interface Got {
  ok: boolean;
  status: number;
  body: JsonObject;
  url: string;
  reason?: string;
  /** Why the call has no body: timeout (a deadline or an HTTP 408/504), else failed. Set whenever reason is. */
  code?: AbsenceCode;
  /** The release calendar's lookup (ctx.releaseCadence), carried so cite() can state a source's cadence. Absent when the server has none. */
  cadenceOf?: ToolCtx["releaseCadence"];
}

/** The absence code of a call that did not answer. */
function codeOf(g: Got): AbsenceCode {
  return g.code ?? "failed";
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
  const cadenceOf = ctx.releaseCadence ? { cadenceOf: ctx.releaseCadence } : {};
  const one = async (path: string): Promise<Got> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((res) => {
      timer = setTimeout(() => res("timeout"), stepMs);
    });
    try {
      const r = await Promise.race([ctx.fetchJson(path), deadline]);
      if (r === "timeout") return { ok: false, status: 504, body: {}, url: path, reason: `no answer within ${stepMs / 1000} s`, code: "timeout", ...cadenceOf };
      const reply = r as JsonReply;
      const body = obj(reply.body);
      if (reply.status >= 400) {
        const err = typeof body.error === "string" ? body.error : "";
        const reason = reply.status === 404 && err === "non-JSON reply" ? "this route is not deployed on this server" : `HTTP ${reply.status}${err ? ": " + err.slice(0, 160) : ""}`;
        return { ok: false, status: reply.status, body, url: reply.url, reason, code: reply.status === 408 || reply.status === 504 ? "timeout" : "failed", ...cadenceOf };
      }
      return { ok: true, status: reply.status, body, url: reply.url, ...cadenceOf };
    } catch (err) {
      return { ok: false, status: 0, body: {}, url: path, reason: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160), code: err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError") ? "timeout" : "failed", ...cadenceOf };
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
  /** The period or note the route writes beside the entry; CMS's is "dataset modified YYYY-MM-DD". */
  period?: string;
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
  "USDM this week": "usdm",
  SPC: "noaa-spc",
  "NCEI Storm Events": "ncei-storm-events",
  "USGS landslide susceptibility": "usgs-landslide-susc",
  "NOAA Climate at a Glance (tavg)": "noaa-cag",
  "NOAA Climate at a Glance (pcp)": "noaa-cag",
};

/** Plain words for the routes' reason codes; the code stays in brackets. */
export const REASONS: Record<string, (who: string) => string> = {
  "join:legacy_ct_counties": (who) => `${who} lists Connecticut under its 8 legacy counties (09001-09015), not the planning regions (09110-09190) Census now uses, so it has nothing filed under this region`,
  "source:not_published_for_puerto_rico": (who) => `${who} does not publish Puerto Rico`,
  "join:boundary_changed_since_2010": (who) => `this county's boundary changed after 2010, so ${who}'s 2010-based row is not attached to it`,
  "source:not_in_release": (who) => `${who}'s current release has no row for this place`,
  "join:ncei_areas_not_counties": (who) => `${who} files Alaska by forecast zones and areas, not by county`,
  "source:failed": (who) => `${who} failed on this call`,
  "join:area_not_placed": (who) => `${who}: FEMA filed a row under a former, split county code for a designated area that no cited source places in this county, so it is not attached here`,
  "join:filed_under_other_code": (who) => `${who}: FEMA files declarations for an area lying in this county under another county's code, and they are not attached here, so this county's FEMA count may be short`,
};

export function explainReason(code: string, who: string, detail?: string | null): string {
  const f = REASONS[code];
  const base = f ? `${f(who)} (${code})` : code;
  return detail ? `${base}: ${detail}` : base;
}

/** The route's own entry saying this source is missing or failed, if any. */
function routeMissing(got: Got, id: string): { source: string; reason: string; code: AbsenceCode } | null {
  const d = obj(got.body.data);
  for (const m of [...arr(d.missing), ...arr(d.failed), ...arr(got.body.missing)].map(obj)) {
    const name = str(m.source ?? m.id);
    if (name && (name === id || MISSING_NAMES[name] === id)) {
      const code = str(m.reason) ?? (str(m.error) ? "source:failed" : "");
      return { source: name, reason: explainReason(code || "source:failed", name, str(m.detail) ?? str(m.error)), code: codeForRouteEntry({ reason: code || "source:failed", detail: str(m.detail), error: str(m.error) }) };
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
  /** When the data behind this citation was fixed, or why no date is recorded. Not copied onto the item as it is: item() states snapshotAt and the reason. */
  snap: Snap;
  /** The date the publisher puts on the data, as this source's route states it (PUBLISHED); null where it states none. */
  pub: string | null;
  /** The release calendar's entry for this source; absent when it has none, and when the server has no calendar. */
  cadence?: ReleaseCadence;
}

/** The date the data behind a citation was fixed (as the route or bundle wrote it), or null and why not. */
interface Snap {
  at: string | null;
  why?: string;
}

/** A date or a UTC datetime, the two ways a route or a bundle writes when something was fixed. */
const SNAP_DATE = /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z)?$/;

/**
 * Sources whose rows eye serves from a file committed in the repo (a bundle, or its own catalogue), and what the route's
 * reply says about when that file was built. A source not listed is a live or cached route: its snapshot is the
 * retrievedAt its provenance entry states. A bundle that records no build date has none here; the route may type one in its
 * own code (app/api/infra/route.ts does for CMS) and that is not the bundle's record. world.test.ts holds the CMS claim to
 * the bundle's own meta.
 */
const BUNDLES: Record<string, (body: JsonObject) => Snap> = {
  // companies route: `pulled` is the date of a full EDGAR pull, null for the committed hand-checked fixture
  "sec-edgar": (body) => {
    const pulled = str(body.pulled);
    return pulled && SNAP_DATE.test(pulled) ? { at: pulled } : { at: null, why: "the SEC bundle is a committed fixture (pulled: null)" };
  },
  "cms-provider-data": () => ({ at: null, why: "the CMS-to-HIFLD bundle records no build date" }),
  "eye-catalog": () => ({ at: null, why: "eye's own catalogue is code, not a dated pull" }),
};

function snapOf(got: Got, id: string, p: Prov): Snap {
  const bundle = Object.prototype.hasOwnProperty.call(BUNDLES, id) ? BUNDLES[id] : undefined;
  if (bundle) return bundle(got.body);
  // The provenance entry's own retrievedAt; never the fallback cite() uses for an item's retrievedAt (the reply's time).
  const at = typeof p.retrievedAt === "string" ? p.retrievedAt : "";
  if (SNAP_DATE.test(at)) return { at };
  return { at: null, why: at ? `the route's retrievedAt (${at.slice(0, 40)}) is not an ISO 8601 UTC date` : "the route sent no retrievedAt for it" };
}

/** A date as a route writes one, only when it is a real date: the schema pattern checks the shape, this the calendar. */
function dateOf(v: unknown): string | null {
  return typeof v === "string" && SNAP_DATE.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
}

/**
 * The date the publisher itself puts on the data behind a citation, read from the one field its route states it in. A
 * whitelist by source id (like BUNDLES): a source not listed has none, so a route that starts sending a date is read
 * only once someone has checked what the date is. Never the retrievedAt, never the reply's time. What each route sent
 * was read from the live replies on 2026-10-21 (CHANGELOG.md, 0.7.0, has the table).
 *   - hifld-hospitals: the infra route's `dataLastEdited`, the HIFLD layer's data-last-edited date. It is a constant in
 *     lib/infra/hospitals.ts that the route sends, not read from the layer on each call.
 *   - cms-provider-data: the infra route's provenance entry for CMS, whose period reads "dataset modified YYYY-MM-DD".
 *   - usdm: the hazards route's Drought Monitor map date. The Monitor dates its weekly map by the Tuesday it is valid for
 *     and releases it two days later.
 * Not read: the screen route's period for BLS QCEW and Zillow ("2026 Q1", "2026-09-30") is the period the value describes,
 * not a release date; the companies route's releasedAt for SEC EDGAR is BUNDLE.pulled, the day eye pulled the file, which is
 * the item's snapshotAt already.
 */
const PUBLISHED: Record<string, (got: Got, p: Prov) => string | null> = {
  "hifld-hospitals": (got) => dateOf(got.body.dataLastEdited),
  "cms-provider-data": (_got, p) => dateOf(/^dataset modified (\d{4}-\d{2}-\d{2})$/.exec(typeof p.period === "string" ? p.period : "")?.[1]),
  usdm: (got) => dateOf(obj(obj(got.body.data).droughtNow).mapDate),
};

function publishedOf(got: Got, id: string, p: Prov): string | null {
  return Object.prototype.hasOwnProperty.call(PUBLISHED, id) ? PUBLISHED[id](got, p) : null;
}

/** Why a source has no citation on this call: the route lists it missing, or sent no provenance for it. */
interface NoCite {
  none: string;
  reason: string;
  /** no_citation (the route sent no provenance), about_eye for eye's own catalogue, else the code of the route's own missing entry. */
  code: AbsenceCode;
}

/** The citation for `id` from this route's reply, or why there is none. */
function cite(got: Got, id: string, pick?: (p: Prov) => boolean): Cite | NoCite {
  const gone = routeMissing(got, id);
  if (gone) return { none: id, reason: `${id}: the route lists it as missing: ${gone.reason}`, code: gone.code };
  const p = provOf(got.body, id, pick);
  const src = obj(p?.source);
  const publisher = str(src.publisher);
  if (!p || !publisher) return { none: id, reason: `${id}: the route sent no provenance for it, so nothing from it is shown`, code: id === "eye-catalog" ? "about_eye" : "no_citation" };
  const upstreamUrl = (typeof p.upstreamUrl === "string" && p.upstreamUrl) || (typeof src.url === "string" && src.url) || got.url;
  const retrievedAt = (typeof p.retrievedAt === "string" && p.retrievedAt) || (typeof got.body.generatedAt === "string" && got.body.generatedAt) || new Date().toISOString();
  const cadence = got.cadenceOf?.(id);
  return { sourceId: id, publisher, upstreamUrl, retrievedAt, link: got.url, snap: snapOf(got, id, p), pub: publishedOf(got, id, p), ...(cadence ? { cadence } : {}) };
}

function isCite(c: Cite | NoCite): c is Cite {
  return !("none" in c);
}

/** An item, or the fact it would have stated and why it has no citation. */
type Built = WorldItem | { uncited: string; reason: string; code: AbsenceCode };

/** Why an item has no record-level URL; said in its note as "no record-level URL: <why>". */
interface NoRecord {
  noRecord: string;
}

const noRecord = (why: string): NoRecord => ({ noRecord: why });

type Extra = Partial<Omit<WorldItem, "fact" | "value" | "upstreamRecordUrl" | keyof Cite>> & {
  /** The publisher's URL for exactly this record, or why there is none. Every call site says which. */
  record: string | NoRecord;
};

function item(c: Cite | NoCite, fact: string, value: WorldItem["value"], extra: Extra): Built {
  if (!isCite(c)) return { uncited: fact, reason: c.reason, code: c.code };
  const out = { fact, value } as WorldItem;
  const { record, ...rest } = extra;
  if (typeof record !== "string") rest.note = [rest.note, `no record-level URL: ${record.noRecord}`].filter(Boolean).join("; ");
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null && v !== "") (out as unknown as JsonObject)[k] = v;
  const { snap, pub, cadence, ...cited } = c;
  Object.assign(out, cited);
  // Set outside the loop above, which drops null: a null snapshotAt is the claim "none recorded", with its reason in the note;
  // a null publishedAt is the claim "the route states none", which the reply's note says once.
  out.snapshotAt = snap.at;
  out.publishedAt = pub;
  if (cadence) out.cadence = cadence;
  if (snap.at === null) out.note = [out.note, `no snapshot date: ${snap.why ?? "none is recorded for this source"}`].filter(Boolean).join("; ");
  if (typeof record === "string") out.upstreamRecordUrl = record;
  if (rest.kind) {
    // Keep kind next to the link, and inputs after it: they qualify the whole item.
    delete out.kind;
    out.kind = rest.kind;
  }
  if (rest.inputs) {
    delete out.inputs;
    out.inputs = rest.inputs;
  }
  return out;
}

/**
 * A count this tool makes from a route's list: the publisher states no such number, so it is an estimate and names what it
 * was computed from instead of a record URL. The input is the source (the cited one), the route whose reply held the rows,
 * the publisher's own URL for the list or layer the route read, and that source's own retrieval time.
 */
function counted(c: Cite | NoCite, fact: string, value: number, note: string | undefined, why: string): Built {
  return item(c, fact, value, {
    note,
    kind: "estimate",
    inputs: isCite(c) ? [{ sourceId: c.sourceId, route: c.link, ...(c.upstreamUrl.startsWith("https://") ? { upstreamRecordUrl: c.upstreamUrl } : {}), retrievedAt: c.retrievedAt }] : undefined,
    record: noRecord(why),
  });
}

// ---- record-level URLs at the publisher ------------------------------------------
//
// Each is a keyless GET on the cited source's own host that returns exactly the record
// an item states, checked by hand on 2026-10-18 (see world.test.ts, "record-level URLs").

const enc = encodeURIComponent;

/**
 * An ArcGIS layer query for one record, on the layer the item's own provenance names; else why not.
 * `outFields` narrows the reply where `*` would show a field the item withholds (a private dam's name).
 */
function arcgisRecord(c: Cite | NoCite, where: string, outFields = "*"): string | NoRecord {
  if (!isCite(c)) return noRecord("no citation");
  const base = c.upstreamUrl.replace(/\/+$/, "");
  if (!/\/(FeatureServer|MapServer)\/\d+$/.test(base)) return noRecord("the cited source is not a single ArcGIS layer this tool can query by id");
  return `${base}/query?where=${enc(where)}&outFields=${outFields}&returnGeometry=false&f=json`;
}

const TIGER_CURRENT = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";
/** The bundled county table's layer: Census internal points (INTPTLAT/INTPTLON), ACS 2023 vintage. */
export const TIGER_ACS2023_COUNTIES = "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/State_County/MapServer/13";

/** tigerWMS_Current layer per construct, as lib/fabric/parse.ts reads them (TIGER_LAYERS). */
const TIGER_LAYER: Record<string, number> = { zcta: 2, tract: 8, place: 28, cd: 54, state: 80, county: 82 };
const SCHOOL_LAYER: Record<string, number> = { unified: 14, secondary: 16, elementary: 18 };

function tigerRecord(kind: string, geoid: string | null, facts: JsonObject = {}): string | NoRecord {
  if (!geoid) return noRecord("the fabric gave no GEOID");
  const layer = kind === "cbsa" ? (facts.type === "micropolitan" ? 91 : facts.type === "metropolitan" ? 93 : null) : kind === "school" ? (SCHOOL_LAYER[String(facts.type ?? "")] ?? null) : (TIGER_LAYER[kind] ?? null);
  if (layer == null) return noRecord(kind === "tribal" ? "TIGERweb files tribal lands in four layers and the fabric does not say which one holds this one" : `the fabric does not say which TIGERweb layer holds this ${kind}`);
  return `${TIGER_CURRENT}/${layer}/query?where=${enc(`GEOID='${geoid}'`)}&outFields=GEOID,NAME&returnGeometry=false&f=json`;
}

/** The fabric's per-point upstream calls, as lib/fabric/fetch.ts makes them: the record for this point. */
function pointRecord(sourceId: string, kind: string, code: string | null, lon: number, lat: number): string | NoRecord {
  switch (sourceId) {
    case "nws-api":
      return `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
    case "usgs-epqs":
      return `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Meters&wkid=4326`;
    case "usgs-wbd":
      return code ? `https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6/query?where=${enc(`huc12='${code}'`)}&outFields=huc12,name,tohuc&returnGeometry=false&f=json` : noRecord("the fabric gave no HUC-12 code");
    case "fema-nfhl":
      if (kind === "flood-community") return code ? `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/22/query?where=${enc(`CID='${code}'`)}&outFields=CID,POL_NAME1&returnGeometry=false&f=json` : noRecord("the fabric gave no NFIP community id");
      return `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_AR_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID&returnGeometry=false&f=json`;
    case "epa-ecoregions":
      return code ? `https://geodata.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer/11/query?where=${enc(`US_L3CODE='${code}'`)}&outFields=US_L3CODE,US_L3NAME&returnGeometry=false&resultRecordCount=1&f=json` : noRecord("the fabric gave no ecoregion code");
    default:
      return noRecord(`no query URL is known for ${sourceId}`);
  }
}

/** OpenFEMA's declaration rows for one disaster number. */
const femaDisasterRecord = (n: string) => `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=${enc(`disasterNumber eq ${n}`)}`;

/** The BLS QCEW area CSV for the quarter the item states ("2026 Q1") and an area (county FIPS, or SS000 for a state). */
function qcewRecord(period: string | undefined, area: string | null): string | NoRecord {
  const m = /^(\d{4}) Q([1-4])$/.exec(period ?? "");
  if (!m || !area) return noRecord("the screener gave no quarter or area for this value");
  return `https://data.bls.gov/cew/data/api/${m[1]}/${m[2]}/area/${area}.csv`;
}

/** NID fields a dam item states (owner type, hazard, condition, year), besides NIDID and, for a named dam, NAME. */
/** Water record URLs name their fields: the ones the cite-check matchers read, so a water system's name and the sampling facilities never ride along. */
const CWS_RECORD_FIELDS = "PWSID,Population_Served_Count";
const UCMR_RECORD_FIELDS = "F_PWS_ID,Contaminant,Analytical_Result_Value__ng_L_,Result_At_or_Above_UCMR_MRL,Minimum_Reporting_Level__ng_L_,Collection_Date,UCMR_Cycle";
const DAM_RECORD_FIELDS = ["PRIMARY_OWNER_TYPE", "OWNER_TYPES", "HAZARD_POTENTIAL", "CONDITION_ASSESSMENT", "YEAR_COMPLETED"];

/** USDM's county area-percent statistics for the one map date the item states. */
function usdmRecord(fips: string, mapDate: string | null): string | NoRecord {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mapDate ?? "");
  if (!m) return noRecord("the route gave no map date");
  const d = `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
  // statisticsType=2 is categorical (per-class shares summing to 100), as the item states them; 1 is cumulative (D0 includes D1-D4).
  return `https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=${fips}&startdate=${d}&enddate=${d}&statisticsType=2`;
}

/** CMS Provider Data: the Hospital General Information row for one CCN, on the dataset the route cites. */
function cmsRecord(c: Cite | NoCite, ccn: string): string | NoRecord {
  if (!isCite(c)) return noRecord("no citation");
  if (!/\/datastore\/query\/[a-z0-9-]+\/\d+$/.test(c.upstreamUrl)) return noRecord("the cited CMS URL is not a datastore query");
  return `${c.upstreamUrl}?conditions%5B0%5D%5Bproperty%5D=facility_id&conditions%5B0%5D%5Bvalue%5D=${enc(ccn)}&conditions%5B0%5D%5Boperator%5D=%3D`;
}

/** SEC EDGAR's submissions file for one CIK (keyless; SEC asks for a User-Agent naming the caller). */
const secRecord = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;

const ZILLOW_NO_RECORD = noRecord("Zillow publishes one CSV of every region, with no URL per region");

/**
 * Schedule pages that answer HTTP 403 to a non-browser client (curl -A groundtruth-eval/0.1,
 * 2026-10-18), including BLS's machine-readable bls.ics. The release item keeps the page as its
 * upstreamUrl and says so, rather than citing a page an agent cannot open without saying why.
 */
export const SCHEDULE_BLOCKED_PREFIXES = ["https://www.bls.gov/", "https://www.zillow.com/", "https://www.spglobal.com/", "https://www.bts.gov/"] as const;
export const SCHEDULE_BLOCKED_NOTE = "the publisher's schedule page blocks automated clients (HTTP 403 to a non-browser user agent, checked 2026-10-18)";

function scheduleBlocked(url: string | null): boolean {
  return !!url && SCHEDULE_BLOCKED_PREFIXES.some((p) => url.startsWith(p));
}

/**
 * How old a date may be, in days, before its source is stale, by the cadence of its release-calendar entry: one period of
 * the cadence and a few days' grace for a release that runs late (annual 366, a year with a leap day; quarterly 100 against
 * a quarter's 91; monthly 35 against 31; daily 2). The cadence is the publisher's, as the calendar records it; the grace is
 * eye's. A date exactly that old is not stale; one older is. `continuous` has no row: a source that releases continuously
 * is never stale by age. Committed here and held by world.test.ts ("the committed age table ..."), which keeps its own copy.
 *
 * Weekly is 12 = 7 + 2 + 3. 7 is the cadence. 2 is the lag between the date and the release, for the one weekly source that
 * states a date: the Drought Monitor dates its map on a Tuesday and releases it on the Thursday after (calendar.ts: weekly
 * THU, 08:30 ET = 12:30Z), so the newest map is already 9.5 days old on the day the next one appears. 3 is the grace for a
 * release that runs late. A county reading is also served from the hazards route's one-day cache and its edge copy (s-maxage
 * 3600 plus stale-while-revalidate 3600), so a reading fetched just before a release can be shown for 26 hours after it: 10.6
 * days old. A window of 10 labelled that reading stale for up to 14.5 hours after every release, and any release more than
 * 11.5 hours late; with 12 a release up to 33 hours late, cache included, still reads current.
 */
export const STALE_AFTER_DAYS = { annual: 366, quarterly: 100, monthly: 35, weekly: 12, daily: 2 } as const;

const DAY_MS = 86_400_000;

/** How far past its window a snapshot is, or null when it is within it (or has no window, or is not a date). */
export function staleBy(snapshotAt: string, kind: string, now: number): { ageDays: number; limit: number } | null {
  if (!Object.prototype.hasOwnProperty.call(STALE_AFTER_DAYS, kind)) return null;
  const limit = STALE_AFTER_DAYS[kind as keyof typeof STALE_AFTER_DAYS];
  const age = (now - Date.parse(snapshotAt)) / DAY_MS;
  return Number.isFinite(age) && age > limit ? { ageDays: Math.floor(age), limit } : null;
}

/** What the reply says about every item, once (not per item, for the byte cap). */
export const WORLD_REPLY_NOTE =
  "Cite upstreamRecordUrl for a fact (the publisher's own URL for that exact record), or upstreamUrl where an item's note says it has no record-level URL; `link` is the eye route that reproduces it. kind about-eye marks a claim about eye's own catalogue, not about the world. kind estimate marks a count eye computed from a route's list, not a number the publisher states; its inputs name the source, the route and when that source was retrieved. Missing is listed with its reason, never filled in. snapshotAt is when the data eye serves for that source was fixed: the retrievedAt its route sent, or a bundle's own recorded date; null, with the reason in the note, where none is recorded. publishedAt is the publisher's own date, which eye reads for three sources only (hifld-hospitals, cms-provider-data, usdm), else null; it declines pull dates and periods. cadence is the publisher's release cadence from eye's release calendar, absent where the calendar has no entry; a source whose publishedAt, else snapshotAt, is older than its cadence allows is listed in missing as stale, its items still shown. Names appear only on places, hospitals and non-private dams.";

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
  if ("uncited" in it) miss(s, it.uncited, it.reason, it.code);
  else s.items.push(it);
}

/** Record what is missing, why in words, and the code that says what the agent may do about it. */
function miss(s: Section, what: string, reason: string, code: AbsenceCode): void {
  (s.missing ??= []).push(absence(what, code, reason));
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
/** Is the point inside the polygon (its rings, however nested), even-odd? */
export function ringsContain(rings: unknown[], lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of ringsIn(rings)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The 0.02-degree cell holding a point, on the grid /api/water?op=pfas snaps to (so the route keeps it as asked). */
export function waterBox(lon: number, lat: number): Box {
  const g = 0.02;
  const f = (x: number) => Number((Math.floor(x / g + 1e-9) * g).toFixed(4));
  return [f(lon), f(lat), Number((f(lon) + g).toFixed(4)), Number((f(lat) + g).toFixed(4))];
}

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

/**
 * The point the fabric read at: the route snaps the asked point to a 0.001 grid and reads every
 * upstream there, so a record URL built from the asked point can return a different value. Only
 * the reply's own point (data.point, else meta.snapped) is used; never the query.
 */
function fabricPoint(fabric: Got): [number, number] | null {
  for (const p of [obj(obj(fabric.body.data).point), obj(obj(fabric.body.meta).snapped)]) {
    const lon = num(p.lon);
    const lat = num(p.lat);
    if (lon != null && lat != null) return [lon, lat];
  }
  return null;
}

/** A fabric node's record at its publisher: TIGERweb by GEOID, the rest by code or by the point. */
function nodeRecord(fabric: Got, n: Node): string | NoRecord {
  if (n.source === "census-tigerweb") return tigerRecord(n.kind, n.code, n.facts);
  const at = fabricPoint(fabric);
  if (!at) return noRecord("the fabric reply does not state the point it was read at");
  return pointRecord(n.source, n.kind, n.code, at[0], at[1]);
}

function fabricItems(s: Section, fabric: Got, kinds: Record<string, string>, only?: Set<string>, note?: string): void {
  for (const n of nodesOf(fabric)) {
    const label = kinds[n.kind];
    if (!label || (only && !only.has(n.kind))) continue;
    const extra = [nodeNote(n), note].filter(Boolean).join("; ");
    push(s, item(cite(fabric, n.source), label, n.name, { code: n.code ?? undefined, note: extra || undefined, record: nodeRecord(fabric, n) }));
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
    miss(s, expect ? "state and metro area (CBSA)" : "county, state and metro area (CBSA)", `Census TIGERweb failed on this call (/api/fabric failed[]${str(tiger.error) ? `: ${str(tiger.error)}` : ""})`, codeForRouteEntry({ detail: str(tiger.error) }));
    return;
  }
  if (!has("county")) {
    const why = str(obj(fabric.body.data).coverage);
    miss(s, expect ? "state and metro area (CBSA)" : "county, state and metro area (CBSA)", `the place fabric answered but has no county polygon at ${at}: it is offshore or outside the US${why ? ` (the fabric says: ${why})` : ""}`, "not_in_release");
    return;
  }
  if (!has("state")) miss(s, "state", `the place fabric returned no state at ${at}`, "not_in_release");
  if (!has("cbsa")) miss(s, "metro area (CBSA)", "none: this county is in no metropolitan or micropolitan statistical area (Census TIGERweb answered and returned no CBSA here)", "not_in_release");
}

function fabricFailed(fabric: Got, s: Section): void {
  for (const f of arr(obj(fabric.body.data).failed)) {
    const id = str(typeof f === "string" ? f : obj(f).id ?? obj(f).source);
    if (id) miss(s, `place fabric: ${id}`, "that upstream failed on this call (listed in /api/fabric failed[])", "failed");
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
function nriRating(v: unknown): { rating: string | null; reason?: string; code?: AbsenceCode } {
  const w = str(v);
  if (w && NRI_CLASSES.has(w)) return { rating: w };
  // Not not_published: the word arrives as a row value, not in a route missing entry or a suppression flag, and
  // FEMA's definitions of its words could not be retrieved to quote ("Not Applicable", "Insufficient Data",
  // "Data Unavailable", "No Rating"). The row has no rating to show: not_in_release, which abstains all the same.
  return { rating: null, reason: w ? `FEMA publishes "${w}" here, which is not a rating (and never means low)` : "FEMA's row has no rating here", code: "not_in_release" };
}

function capList<T>(s: Section, label: string, list: T[], max: number): T[] {
  if (list.length > max) s.cut.push({ code: "cut_by_max_records", text: `${label}: ${max} of ${list.length} shown (max_records)` });
  return list.slice(0, max);
}

// ---- the tool ------------------------------------------------------------------

interface Resolved {
  kind: "point" | "county" | "state" | "bbox";
  name: string | null;
  countyFips: string | null;
  stateFips: string | null;
  usps: string | null;
  point: { lon: number; lat: number; basis: string; census?: { geoid: string; pulled: string | null } } | null;
  box: Box | null;
}

/**
 * place.point as sent: a county's point carries its own Census citation, record-level. The county table is a bundle with a
 * recorded pull date (`pulled`), which is both when it was retrieved and its snapshot; with none recorded, snapshotAt is null
 * and the basis says so.
 */
function pointOut(p: Resolved["point"], cadenceOf?: ToolCtx["releaseCadence"]): JsonObject | null {
  if (!p) return null;
  const { census, ...rest } = p;
  if (!census) return rest;
  const cadence = cadenceOf?.("census-tigerweb");
  const dated = !!census.pulled && SNAP_DATE.test(census.pulled);
  return {
    ...rest,
    ...(dated ? {} : { basis: `${rest.basis}; the county table records no pull date, so snapshotAt is null` }),
    sourceId: "census-tigerweb",
    publisher: "U.S. Census Bureau",
    upstreamUrl: TIGER_ACS2023_COUNTIES,
    upstreamRecordUrl: `${TIGER_ACS2023_COUNTIES}/query?where=${enc(`GEOID='${census.geoid}'`)}&outFields=GEOID,NAME,INTPTLAT,INTPTLON&returnGeometry=false&f=json`,
    ...(census.pulled ? { retrievedAt: census.pulled } : {}),
    snapshotAt: dated ? census.pulled : null,
    ...(cadence ? { cadence } : {}),
  };
}

function bytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}

/** Build the bundle. Pure over ctx.fetchJson; `stepMs` and `now` (epoch ms, what a snapshot's age is measured to) are test seams. */
export async function worldContext(input: WorldInput, ctx: ToolCtx, opts: { stepMs?: number; now?: number } = {}): Promise<ToolReply> {
  const get = fetcher(ctx, opts.stepMs ?? WORLD_STEP_MS);
  const max = input.max_records ?? WORLD_DEFAULT_RECORDS;
  const topics = new Set<WorldTopic>(input.topics ?? WORLD_TOPICS.filter((t) => t !== "collections" || input.about));
  const want = (t: WorldTopic) => topics.has(t);
  const S: Record<"identity" | WorldTopic, Section> = { identity: section(), fabric: section(), hazards: section(), economy: section(), vulnerability: section(), institutions: section(), water: section(), freshness: section(), collections: section() };
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
    } else miss(id, "place fabric at the point", fabric.reason ?? "failed", codeOf(fabric));
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
    } else miss(id, `${kind} row`, screen.reason ?? "failed", codeOf(screen));
    if (r.kind === "county") {
      // Census's own internal point for the county (INTPTLON/INTPTLAT), from the bundled county table,
      // never the screener's map anchor (Mobile 01097's was 11 km off it).
      const cp = ctx.countyPoint?.(geoid) ?? null;
      if (cp) {
        r.point = { lon: round(cp.lon, 4), lat: round(cp.lat, 4), basis: "Census internal point (INTPTLON/INTPTLAT) of the county, from eye's county table", census: { geoid, pulled: cp.pulled } };
        r.box = boxAround(cp.lon, cp.lat, 0.25);
      } else miss(id, "the county's point", ctx.countyPoint ? `eye's county table has no county ${geoid}, so nothing is centred on it` : "this server was started without eye's county table (ctx.countyPoint), so the county has no point and no search box", ctx.countyPoint ? "not_in_release" : "not_loaded");
    } else if (screen.ok) {
      // A state: the screener's representative point, said as such (no box is searched for a state).
      const geo = arr(row.geo);
      const lon = num(geo[0]);
      const lat = num(geo[1]);
      if (lon != null && lat != null) r.point = { lon: round(lon, 4), lat: round(lat, 4), basis: "the state's representative point as /api/screen publishes it" };
    }
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
    // EPA's CWS service areas and UCMR 5 results for the one 0.02-degree cell holding the point (the route's own grid).
    water: want("water") && r.point && r.kind !== "state" ? get("/api/water" + q({ op: "pfas", bbox: waterBox(r.point.lon, r.point.lat).join(","), polygons: 1 })) : null,
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
    push(id, item(cite(screen, "census-tigerweb"), r.kind, str(row.name), { code: str(v.geoid) ?? undefined, record: tigerRecord(r.kind, str(v.geoid)) }));
  }
  if (fabric?.ok && (r.kind === "point" || r.kind === "bbox")) {
    fabricItems(id, fabric, IDENTITY_KINDS, undefined, r.kind === "bbox" ? "at the centre of the box" : undefined);
    identityGaps(id, fabric, null, r.kind === "bbox" ? "the centre of the box" : "this point");
  }
  if (r.kind === "county") {
    const g = got.fabric;
    if (g?.ok) {
      const at = r.point ? `the county's Census internal point (${r.point.lon}, ${r.point.lat})` : "the county's Census internal point";
      const there = nodesOf(g).find((n) => n.kind === "county");
      if (there && there.code !== cf) {
        miss(id, "state and metro area (CBSA) from the place fabric", `the fabric at ${at} resolved to county ${there.code}${there.name ? ` (${there.name})` : ""}, not ${cf}; that county's state and CBSA are not shown for this one`, "join_gap");
      } else {
        fabricItems(id, g, IDENTITY_KINDS, new Set(["state", "cbsa"]), "read at the county's Census internal point");
        identityGaps(id, g, cf, at);
      }
    } else if (g) miss(id, "state and metro area (CBSA) from the place fabric", g.reason ?? "failed", codeOf(g));
  }
  if (r.kind === "state") miss(id, "metro area (CBSA)", "a state has no single metro; pass a county FIPS or a point", "not_asked");
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
      if (obj(g.body.data).truncated === true) id.cut.push({ code: "cut_by_route_limit", text: "counties touching the box: the route hit its record limit, so some may be missing" });
      if (!touching.length) miss(id, "counties touching the box", units.length ? "none of the county outlines the route returned touches the box" : "Census TIGERweb returned no county in the box (offshore or outside the US)", "not_in_release");
      for (const u of capList(id, "counties touching the box", touching, max)) {
        push(id, listRow(item(c, "county touching the box", str(u.name), { code: str(u.code) ?? undefined, note: "its Census TIGERweb outline (generalised) touches the box", record: tigerRecord("county", str(u.code)) })));
      }
    } else miss(id, "counties touching the box", g.reason ?? "failed", codeOf(g));
  }
  if (r.stateFips === "09" && (r.kind === "county" || r.kind === "point" || r.kind === "bbox")) {
    miss(id, "Connecticut county id", "Census uses planning regions (09110-09190) as county equivalents; some sources publish only legacy counties (09001-09015), so a county-keyed fact can be absent here for that reason alone", "join_gap");
  }
  if (!cf && r.kind !== "state" && !fabric?.ok) miss(id, "county", r.point ? "the place fabric did not answer, so no county was resolved" : "the place could not be resolved", r.point ? "failed" : "not_in_release");

  // ---- fabric ----
  if (want("fabric")) {
    const s = S.fabric;
    if (r.kind === "state" || r.kind === "county") miss(s, "place fabric", `the fabric is per point; call world_context with lon/lat${r.point ? ` (the ${r.kind}'s point is ${r.point.lon}, ${r.point.lat})` : ""}`, "not_asked");
    else if (fabric?.ok) {
      fabricItems(s, fabric, FABRIC_KINDS, undefined, r.kind === "bbox" ? "at the centre of the box" : undefined);
      const elev = num(obj(obj(fabric.body.data).point).elevationM);
      if (elev != null) {
        const at = fabricPoint(fabric);
        push(s, item(cite(fabric, "usgs-epqs"), "elevation", elev, { unit: "m", note: r.kind === "bbox" ? "at the centre of the box" : undefined, record: at ? pointRecord("usgs-epqs", "elevation", null, at[0], at[1]) : noRecord("the fabric reply does not state the point it was read at") }));
      }
      else miss(s, "elevation", "USGS 3DEP gave no elevation for this point", "not_in_release");
      fabricFailed(fabric, s);
    } else miss(s, "place fabric", fabric?.reason ?? "not asked", fabric ? codeOf(fabric) : "not_asked");
  }

  // ---- hazards ----
  const nri = got.nri;
  const row = nri?.ok ? nriRow(nri) : null;
  if (want("hazards")) {
    const s = S.hazards;
    if (!cf) miss(s, "county hazard baseline (FEMA NRI, declarations, drought)", r.kind === "state" ? "not asked for a state: county-level sources only; pass a county FIPS" : "no county resolved", r.kind === "state" ? "not_asked" : "join_gap");
    if (r.kind === "state") miss(s, "live events (NWS alerts, earthquakes)", "not asked for a state: the live list is matched to a search box; pass a county FIPS, a point or a box", "not_asked");
    if (nri) {
      if (row) {
        const c = cite(nri, "fema-nri");
        const nriRec = arcgisRecord(c, `STCOFIPS='${cf}'`);
        const risk = nriRating(row.RISK_RATNG);
        if (risk.rating) push(s, item(c, "FEMA NRI overall risk rating", risk.rating, { note: num(row.RISK_SCORE) != null ? `score ${round(num(row.RISK_SCORE)!, 1)} (percentile among US counties, not a likelihood)` : undefined, period: str(row.NRI_VER) ?? undefined, record: nriRec }));
        else miss(s, "FEMA NRI overall risk rating", risk.reason!, risk.code!);
        const eal = num(row.EAL_VALT);
        const ealR = nriRating(row.EAL_RATNG);
        if (eal != null) push(s, item(c, "FEMA NRI expected annual loss", Math.round(eal), { unit: "USD a year (modelled)", note: ealR.rating ? `rating ${ealR.rating}` : `rating not given: ${ealR.reason}`, record: nriRec }));
        else miss(s, "FEMA NRI expected annual loss", "FEMA's row has no expected annual loss for this county", "not_in_release");
        const by: Record<string, string[]> = {};
        for (const [code, name] of Object.entries(NRI_HAZARDS)) {
          const rating = str(row[`${code}_RISKR`]);
          if (rating === "Very High" || rating === "Relatively High") (by[rating] ??= []).push(name);
        }
        const top = ["Very High", "Relatively High"].filter((k) => by[k]).map((k) => `${k}: ${by[k].join(", ")}`).join("; ");
        if (top) push(s, item(c, "NRI hazards rated Very High or Relatively High", top, { record: nriRec }));
      } else miss(s, "FEMA National Risk Index", nri.ok ? "FEMA's index has no row for this county" : nri.reason ?? "failed", nri.ok ? "not_in_release" : codeOf(nri));
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
        if (!isCite(fema)) miss(s, "FEMA declarations", fema.reason, fema.code);
        else if (!decls.length) {
          if (gap) miss(s, "FEMA declarations", `the route reports a boundary or join gap for this county (${explainReason(str(gap.reason) ?? "", str(gap.source) ?? "a source", str(gap.detail))}), so an empty FEMA list is not proof that none were declared`, codeForRouteEntry(gap));
          else if (rowsTotal !== 0) miss(s, "FEMA declarations", `the route listed none but did not report reading zero rows (declarationRows ${rowsTotal ?? "absent"}), so no count is given`, "failed");
          else push(s, item(fema, "FEMA declarations listed", 0, { note: "OpenFEMA lists no declaration naming this county, at any date (declarationRows 0)", record: fema.upstreamUrl.includes("fipsCountyCode") ? fema.upstreamUrl : noRecord("the route's OpenFEMA query for this county is not stated") }));
        } else {
          const shown = decls.slice(0, max);
          if (rowsTotal == null || rowsTotal > shown.length) s.cut.push({ code: "cut_by_max_records", text: `FEMA declarations: the latest ${shown.length} distinct shown, any date (FEMA files ${rowsTotal ?? "an unstated number of"} rows for this county; a disaster can have one row per designated area)` });
          for (const x of shown) {
            const filed = str(x.filedUnder);
            push(
              s,
              listRow(
                item(fema, "FEMA declaration", str(x.declarationTitle), {
                  code: x.disasterNumber != null ? `${str(x.declarationType) ?? ""}-${str(x.disasterNumber)}` : undefined,
                  period: str(x.declarationDate) ?? undefined,
                  note: [str(x.incidentType), filed ? `filed by FEMA under the former county code ${filed} (the route's caveats say how that code relates to this county)` : null].filter(Boolean).join("; ") || undefined,
                  record: x.disasterNumber != null ? femaDisasterRecord(str(x.disasterNumber)!) : noRecord("FEMA's row has no disaster number"),
                }),
              ),
            );
          }
        }
        const dn = obj(d.droughtNow);
        if (Object.keys(dn).length) {
          const usdm = cite(h, "usdm", (p) => String(p.upstreamUrl ?? "").includes("Severity"));
          const shares = ["d0", "d1", "d2", "d3", "d4"].map((k) => `${k.toUpperCase()} ${num(dn[k]) ?? "?"}%`).join(", ");
          push(s, item(usdm, "U.S. Drought Monitor this week (share of county area per class)", shares, { period: str(dn.mapDate) ?? undefined, note: `none ${num(dn.none) ?? "?"}%; shares as published`, record: usdmRecord(cf!, str(dn.mapDate)) }));
        } else {
          // The route's own entry for this week's call (it failed, or USDM has no week here), else plain absence.
          const nowGap = arr(d.missing)
            .map(obj)
            .find((m) => str(m.source) === "USDM this week");
          miss(s, "U.S. Drought Monitor this week", nowGap ? explainReason(str(nowGap.reason) ?? "", "USDM", str(nowGap.detail)) : "not in the hazard history reply", nowGap ? codeForRouteEntry(nowGap) : "failed");
        }
        // The route's other gaps (sources this tool does not read), in plain words.
        for (const m of arr(d.missing).map(obj)) {
          const who = str(m.source);
          if (!who || MISSING_NAMES[who] === "fema-openfema" || MISSING_NAMES[who] === "usdm") continue;
          miss(s, who, explainReason(str(m.reason) ?? "", who, str(m.detail)), codeForRouteEntry(m));
        }
      } else miss(s, "hazard history (FEMA, drought)", h.reason ?? "failed", codeOf(h));
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
        const where = r.kind === "county" ? `the box 0.25 degrees around the county's Census internal point (${b.join(",")}), not the whole county` : r.kind === "point" ? `the box 0.1 degrees around the point (${b.join(",")})` : `the box ${b.join(",")}`;
        // One count per source, each cited to its own feed, and only when that feed answered in full.
        const alerts = hits.filter((x) => x.kind !== "quake");
        const quakes = hits.filter((x) => x.kind === "quake");
        const unmapped = num(obj(live.body.data).unmapped) ?? 0;
        const nws = cite(live, "nws-api");
        if (!isCite(nws)) miss(s, "Severe or Extreme NWS alerts touching the box now", nws.reason, nws.code);
        else if (unmapped > 0) miss(s, "count of Severe or Extreme NWS alerts touching the box now", `${unmapped} alert${unmapped === 1 ? "" : "s"} in the national list could not be outlined, so a count for this box could miss them; the alerts that do touch it are listed`, "join_gap");
        else push(s, counted(nws, "Severe or Extreme NWS alerts touching the box now", alerts.length, where, "a count over NWS's national list of active alerts, matched to this box here; NWS has no URL for exactly this box"));
        const usgs = cite(live, "usgs-earthquakes");
        if (!isCite(usgs)) miss(s, "M4.5+ earthquakes in the past day touching the box", usgs.reason, usgs.code);
        else push(s, counted(usgs, "M4.5+ earthquakes in the past day touching the box", quakes.length, where, "a count over USGS's past-day M4.5+ feed, matched to this box here; the feed has no URL for exactly this box"));
        for (const x of capList(s, "live events", hits, max)) {
          const quake = x.kind === "quake";
          const c = quake ? usgs : nws;
          const t = num(x.time);
          const u = num(x.until);
          push(s, listRow(item(c, quake ? "earthquake" : "NWS alert", str(x.title), { note: str(x.subtitle) ?? undefined, period: t != null ? new Date(t).toISOString() + (u != null ? "/" + new Date(u).toISOString() : "") : undefined, record: typeof x.url === "string" && /^https:\/\//.test(x.url) ? x.url : noRecord("the live list gave no URL for this event") })));
        }
      } else miss(s, "live events", live.reason ?? "failed", codeOf(live));
    }
  }

  // ---- economy ----
  if (want("economy")) {
    const s = S.economy;
    if (screen?.ok) {
      const v = obj(obj(arr(obj(screen.body.data).rows)[0]).values);
      if (!Object.keys(v).length) miss(s, "county economy row", "the screener has no row for this county", "not_in_release");
      else {
        const qcew = cite(screen, "bls-qcew");
        const period = str(v["jobs.period"]) ?? undefined;
        const withheld = v["jobs.suppressed"] === true || v["jobs.suppressed"] === "true";
        for (const [k, fact, unit] of [
          ["jobs.emp", "covered employment (BLS QCEW, all industries)", "jobs"],
          ["jobs.avgWeeklyWage", "average weekly wage (BLS QCEW)", "USD"],
        ] as const) {
          const n = num(v[k]);
          const record = qcewRecord(period, r.kind === "state" ? `${r.stateFips}000` : cf);
          if (n != null) push(s, item(qcew, fact, n, { unit, period, record }));
          else if (withheld) push(s, item(qcew, fact, null, { unit, period, note: "withheld by BLS for confidentiality: null, not 0", absence: "withheld", record }));
          else miss(s, fact, "not published for this place", "not_in_release");
        }
        const home = num(v["home.latest"]);
        if (home != null) push(s, item(cite(screen, "zillow-zhvi"), "typical home value (Zillow ZHVI)", Math.round(home), { unit: "USD", period: str(v["home.asOf"]) ?? undefined, note: num(v["home.yoyPct"]) != null ? `${round(num(v["home.yoyPct"])!, 1)}% over the year` : undefined, record: ZILLOW_NO_RECORD }));
        else miss(s, "typical home value (Zillow ZHVI)", "Zillow publishes no value for this place", "not_in_release");
        const rent = num(v["rent.latest"]);
        if (rent != null) push(s, item(cite(screen, "zillow-zori"), "typical asking rent (Zillow ZORI)", Math.round(rent), { unit: "USD a month", record: ZILLOW_NO_RECORD }));
        else miss(s, "typical asking rent (Zillow ZORI)", "Zillow publishes no rent index for this place", "not_in_release");
      }
    } else miss(s, "jobs, wages, home value and rent", screen?.reason ?? "no county resolved", screen ? codeOf(screen) : "join_gap");
    if (row) {
      const pop = num(row.POPULATION);
      if (pop != null) push(s, item(cite(nri!, "fema-nri"), "population (as carried in FEMA's NRI row)", pop, { unit: "people", note: `FEMA NRI ${str(row.NRI_VER) ?? ""}`.trim() + "; NRI's own population input, not a Census table eye reads directly", record: arcgisRecord(cite(nri!, "fema-nri"), `STCOFIPS='${cf}'`) }));
    } else if (cf) miss(s, "population", "eye serves population only through FEMA's NRI row, which did not answer for this county", "failed");
  }

  // ---- vulnerability ----
  if (want("vulnerability")) {
    const s = S.vulnerability;
    if (!cf) miss(s, "social vulnerability", r.kind === "state" ? "county-level indices only; pass a county FIPS" : "no county resolved", r.kind === "state" ? "not_asked" : "join_gap");
    const svi = got.svi;
    if (svi) {
      const rpl = arr(obj(obj(svi.body.data).row).rpl);
      const overall = num(rpl[0]);
      if (svi.ok && overall != null && overall >= 0) push(s, item(cite(svi, "cdc-svi"), "CDC/ATSDR SVI 2022 overall percentile", overall, { unit: "0 least to 1 most vulnerable among US counties", record: arcgisRecord(cite(svi, "cdc-svi"), `FIPS='${cf}'`) }));
      else miss(s, "CDC/ATSDR SVI 2022", svi.ok ? "CDC does not rank this place" : svi.reason ?? "failed", svi.ok ? "not_in_release" : codeOf(svi));
    }
    const sovi = row ? nriRating(row.SOVI_RATNG) : null;
    if (row && sovi && !sovi.rating) miss(s, "FEMA NRI social vulnerability", sovi.reason!, sovi.code!);
    else if (row && sovi?.rating) {
      push(s, item(cite(nri!, "fema-nri"), "FEMA NRI social vulnerability rating (Census Community Resilience Estimate; not CDC SVI)", sovi.rating, { note: num(row.SOVI_SCORE) != null ? `score ${round(num(row.SOVI_SCORE)!, 1)} of 100` : undefined, record: arcgisRecord(cite(nri!, "fema-nri"), `STCOFIPS='${cf}'`) }));
    } else if (cf) miss(s, "FEMA NRI social vulnerability", nri?.reason ?? "FEMA's index has no row for this county", nri && !nri.ok ? codeOf(nri) : "not_in_release");
  }

  // ---- institutions ----
  if (want("institutions")) {
    const s = S.institutions;
    if (!r.box) miss(s, "hospitals and dams", r.kind === "state" ? "a state is too large for the record routes; pass a county FIPS, a point or a box" : "no box to search", r.kind === "state" ? "not_asked" : "not_loaded");
    const b = r.box;
    const boxNote = b ? (r.kind === "county" ? `within 0.25 degrees of the county's Census internal point, not the whole county` : r.kind === "point" ? "within 0.1 degrees of the point" : "inside the box") : undefined;
    const records = (g: Got | null, label: string, sourceId: string, build: (p: JsonObject, pt: [number, number] | null, c: Cite, g: Got) => Built | Built[]) => {
      if (!g || !b) return;
      if (!g.ok) return miss(s, label, g.reason ?? "failed", codeOf(g));
      const feats = arr(obj(g.body.data).features)
        .map(obj)
        .filter((f) => {
          const pt = pointOf(f);
          return pt != null && inBox(b, pt[0], pt[1]);
        });
      const c = cite(g, sourceId);
      if (!isCite(c)) return miss(s, label, c.reason, c.code);
      // The route's own flag: its upstream's record limit was hit, so what came back is not every record in the box.
      const routeCut = g.body.truncated === true;
      if (routeCut) {
        s.cut.push({ code: "cut_by_route_limit", text: `${label}: the route hit its upstream's record limit for this box, so the ${feats.length} it returned inside the box are not all of them` });
        if (!feats.length) miss(s, `${label} found`, "the route hit its record limit and returned none inside the box; a count of 0 would not be true", "cut_by_route_limit");
      } else if (!feats.length) push(s, counted(c, `${label} found`, 0, boxNote, "a count of the route's records inside this box; the publisher has no URL for exactly this box"));
      if (routeCut && feats.length > max) s.cut.push({ code: "cut_by_max_records", text: `${label}: ${max} of at least ${feats.length} shown (max_records)` });
      const shown = routeCut ? feats.slice(0, max) : capList(s, label, feats, max);
      for (const f of shown) for (const one of [build(obj(f.properties), pointOf(f), c, g)].flat()) push(s, listRow(one));
    };
    records(got.hospitals, "hospitals", "hifld-hospitals", (p, pt, c, g) => {
      const x = obj(p.extra);
      const hid = str(p.id);
      const hospital = item(c, "hospital", publicName(p), {
        code: hid ?? undefined,
        point: pt ?? undefined,
        note: [str(obj(p.details).type), str(x.status)?.toLowerCase(), boxNote].filter(Boolean).join("; "),
        record: hid?.startsWith("hifld-hosp:") ? arcgisRecord(c, `ID='${hid.slice("hifld-hosp:".length)}'`) : noRecord("the route gave no HIFLD id"),
      });
      // CMS's rating is CMS's fact: its own item, cited to CMS, with CMS's row for the hospital's CCN.
      const cms = obj(x.cms);
      const ccn = str(cms.ccn);
      if (!ccn) return hospital;
      const rating = num(cms.rating);
      const cc = cite(g, "cms-provider-data");
      return [
        hospital,
        item(cc, "CMS overall hospital star rating", rating, {
          code: ccn,
          note: [`CCN ${ccn}, for hospital ${hid ?? "(no id)"}`, rating == null ? "CMS lists the hospital and publishes no overall rating for it: null, not 0" : "1 to 5 stars"].join("; "),
          record: cmsRecord(cc, ccn),
        }),
      ];
    });
    records(got.dams, "dams", "usace-nid", (p, pt, c) => {
      const d = obj(p.details);
      const name = publicName(p);
      const owner = str(d["owner type"]);
      const unnamed = name ? null : owner && /private/i.test(owner) ? "name withheld (private owner); labelled by NID id" : "name not in the route's record text; labelled by NID id";
      const nid = str(p.id);
      return item(c, "dam", name, {
        code: nid ?? undefined,
        point: pt ?? undefined,
        // A dam labelled by its id gets a record link that leaves NAME out too: the reply withholds it.
        record: nid?.startsWith("nid:") ? arcgisRecord(c, `NIDID='${nid.slice(4)}'`, (name ? ["NIDID", "NAME", ...DAM_RECORD_FIELDS] : ["NIDID", ...DAM_RECORD_FIELDS]).join(",")) : noRecord("the route gave no NID id"),
        note: [unnamed, str(d["hazard potential"]) ? `hazard potential ${str(d["hazard potential"])}` : null, str(d["condition assessment"]) ? `condition ${str(d["condition assessment"])}` : null, str(d["year completed"]) ? `completed ${str(d["year completed"])}` : null, str(d["owner type"]) ? `owner type ${str(d["owner type"])}` : null, boxNote]
          .filter(Boolean)
          .join("; "),
      });
    });
    const co = got.companies;
    const coCite = co?.ok ? cite(co, "sec-edgar") : null;
    if (co && coCite && !isCite(coCite)) miss(s, "public companies", coCite.reason, coCite.code);
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
        if (!pulled) miss(s, `SEC-registered public companies ${where}`, `eye's SEC bundle is a committed fixture (pulled: null), not a full pull of EDGAR registrants, so it cannot say how many are ${where}; any listed are ${universe}`, "not_loaded");
        else if (!feats.length) push(s, counted(c, `public companies in eye's SEC bundle ${where}`, 0, universe, "a count within eye's SEC bundle; SEC has no URL for it"));
        for (const f of capList(s, "public companies", feats, max)) {
          const x = obj(obj(f.properties).extra);
          const ticker = str(x.ticker);
          push(s, listRow(item(c, "public company (by ticker; names are not copied)", ticker, { code: x.cik != null ? `CIK ${str(x.cik)}` : undefined, note: [str(x.exchange), where, universe].filter(Boolean).join("; "), record: x.cik != null && /^\d{1,10}$/.test(String(x.cik)) ? secRecord(String(x.cik)) : noRecord("the bundle gave no CIK") })));
        }
      } else miss(s, "public companies", co.reason ?? "failed", codeOf(co));
    }
  }

  // ---- collections ----
  if (want("collections")) {
    const s = S.collections;
    if (!input.about) miss(s, "collections", "pass `about` (what you are looking for, in words) to rank eye's collections", "not_asked");
    const cat = got.catalog;
    if (cat) {
      if (cat.ok) {
        const hits = arr(obj(cat.body.data).hits).map(obj);
        // The ranking is cited to the catalogue's own provenance on the search route; the card is at ?id=.
        const c = cite(cat, "eye-catalog");
        if (obj(cat.body.data).matched === false) miss(s, "collections", "no word of `about` is in the embedder's vocabulary", "not_in_release");
        if (!isCite(c)) {
          if (hits.length) miss(s, "collections", c.reason, c.code);
        } else
          for (const hit of hits.slice(0, max)) {
            const hid = str(hit.id);
            if (!hid) continue;
            const card = "/api/catalog" + q({ id: hid });
            push(s, listRow(item(c, "collection", str(hit.title), { code: hid, note: [num(hit.score) != null ? `cosine ${round(num(hit.score)!, 3)} between descriptions; not proof the collection answers the question` : null, `card: ${card}`].filter(Boolean).join("; "), kind: "about-eye", record: noRecord("a claim about eye's own catalogue, which has no outside publisher") })));
          }
      } else miss(s, "collections", cat.reason ?? "failed", codeOf(cat));
    }
  }

  // ---- water: the community water system serving the point, and its UCMR 5 rows ----
  if (want("water")) {
    const s = S.water;
    const g = got.water;
    const what = "community water system serving the point";
    if (!g) miss(s, what, r.kind === "state" ? "a state has no single water system; pass a county FIPS, a point or a box" : "no point to look up", r.kind === "state" ? "not_asked" : "not_loaded");
    else if (!g.ok) miss(s, what, g.reason ?? "failed", codeOf(g));
    else {
      const { lon, lat } = r.point!;
      const at = r.kind === "county" ? "the county's Census internal point" : r.kind === "bbox" ? "the centre of the box" : "the point";
      const cws = cite(g, "epa-cws-boundaries");
      const pat = cite(g, "epa-ucmr5-pat");
      // The route spreads its meta at the top level: coverage[] says whether the service-area layer answered in full.
      const areas = arr(g.body.coverage).map(obj).find((c) => c.id === "service-areas");
      const serving = arr(obj(g.body.data).features)
        .map(obj)
        .filter((f) => {
          const geom = obj(f.geometry);
          return obj(obj(f.properties).extra).placement === "service-area" && (geom.type === "Polygon" || geom.type === "MultiPolygon") && ringsContain(arr(geom.coordinates), lon, lat);
        });
      // UCMR 5 rows here belong to "the system serving the point", which only the service-area layer can say.
      const areasOk = isCite(cws) && str(areas?.state) !== "error";
      if (!isCite(cws)) miss(s, what, cws.reason, cws.code);
      else if (!areasOk) miss(s, what, "EPA's service-area layer did not answer this time (the route's coverage says error): unknown, not none", "failed");
      else if (!serving.length) {
        miss(
          s,
          what,
          str(areas?.state) === "partial"
            ? `EPA's service-area layer hit its record limit for this box, so a system serving ${at} may be among those not returned`
            : `no EPA community water system service area contains ${at}: it may be served by a private well or by a system EPA has no boundary for (EPA answered for the box; this is not a 0)`,
          str(areas?.state) === "partial" ? "cut_by_route_limit" : "not_in_release",
        );
      }
      const ucmr = "UCMR 5 (2023-2025)";
      for (const f of areasOk ? serving : []) {
        const props = obj(f.properties);
        const x = obj(props.extra);
        const pwsid = str(x.pwsid);
        if (!pwsid || !/^[A-Z0-9]{2}[0-9]{7}$/.test(pwsid)) continue;
        const pop = num(obj(props.details)["population served"]);
        push(
          s,
          item(cws, "community water system serving the point (EPA service area)", pwsid, {
            code: pwsid,
            note: [pop != null ? `population served ${pop}` : null, x.modelled === true ? "boundary modelled by EPA" : x.modelled === false ? "boundary from the system or state" : "boundary source not said", `EPA's boundary (simplified to about 50 m) contains ${at}; labelled by PWSID, names are not copied`].filter(Boolean).join("; "),
            record: arcgisRecord(cws, `PWSID='${pwsid}'`, CWS_RECORD_FIELDS),
          }),
        );
        const state = str(x.state);
        const label = `UCMR 5 PFAS results for ${pwsid}`;
        if (!state || state === "unknown") miss(s, label, "EPA's UCMR 5 results did not answer for this system this time: unknown, never 'not detected'", "failed");
        else if (!isCite(pat)) miss(s, label, pat.reason, pat.code);
        else {
          const results = arr(x.results).map(obj);
          const det = results.filter((y) => (num(y.detections) ?? 0) > 0);
          const status = state === "detected" ? "detected" : state === "not-detected" ? "not detected" : state === "not-in-ucmr5" ? "not in UCMR 5" : null;
          if (!status) {
            miss(s, label, `the route gave a state this tool does not know (${state})`, "failed");
            continue;
          }
          push(
            s,
            item(pat, "UCMR 5 PFAS status of the system", status, {
              code: pwsid,
              note:
                state === "not-in-ucmr5"
                  ? "EPA's PFAS Analytic Tools hold no UCMR 5 result for this system (of systems serving under 3,300 people, EPA sampled a representative 800)"
                  : `${det.length} of ${results.length} PFAS at or above UCMR 5's minimum reporting level in at least one result; samples where treated water enters the distribution system, 2023-2025; not a tap, not compared with any health limit`,
              record: arcgisRecord(pat, `F_PWS_ID='${pwsid}' AND UCMR_Cycle='${ucmr}'`, UCMR_RECORD_FIELDS),
            }),
          );
          for (const y of capList(s, `UCMR 5 detections for ${pwsid}`, det, max)) {
            const c = str(y.contaminant);
            if (!c) continue;
            const v = num(y.maxNgL);
            push(
              s,
              listRow(
                item(pat, `UCMR 5 highest single result: ${c}`, v, {
                  unit: "ng/L",
                  code: pwsid,
                  note: `${num(y.detections)} of ${num(y.results)} results at or above the minimum reporting level${v == null ? "; EPA gives no value: null, not 0" : ""}`,
                  record: arcgisRecord(pat, `F_PWS_ID='${pwsid}' AND UCMR_Cycle='${ucmr}' AND Contaminant='${c.replace(/'/g, "''")}'`, UCMR_RECORD_FIELDS),
                }),
              ),
            );
          }
        }
      }
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
      if (!rel.length) miss(s, "next releases", `none of the sources cited here has a scheduled release on eye's calendar${span ? ` (${span})` : ""}`, "not_in_release");
      for (const x of capList(s, "next releases", rel, max)) {
        const w = obj(x.window);
        const sid = String(x.sourceId);
        const cadenceOfSource = ctx.releaseCadence?.(sid);
        const it = item({ sourceId: sid, publisher: publishers.get(sid)!, upstreamUrl: str(x.scheduleUrl) ?? cal.url, retrievedAt: typeof cal.body.generatedAt === "string" ? cal.body.generatedAt : new Date().toISOString(), link: cal.url, snap: { at: null, why: "a computed window" }, pub: null, ...(cadenceOfSource ? { cadence: cadenceOfSource } : {}) }, "next scheduled release", str(x.title), {
          period: str(w.nominal) ?? undefined,
          note: [str(x.precision) ? `${str(x.precision)} date` : null, str(w.earliest) && str(w.latest) ? `window ${str(w.earliest)} to ${str(w.latest)}` : null, scheduleBlocked(str(x.scheduleUrl)) ? SCHEDULE_BLOCKED_NOTE : null].filter(Boolean).join("; "),
          record: noRecord("upstreamUrl is the publisher's own schedule for this release"),
        });
        push(s, it);
      }
    } else if (cal) miss(s, "next releases", cal.reason ?? "failed", codeOf(cal));
  }

  // ---- stale: a snapshot older than its publisher's cadence allows is labelled, once per topic and source; the items stay ----
  const now = opts.now ?? Date.now();
  for (const sec of Object.values(S)) {
    const said = new Set<string>();
    for (const it of sec.items) {
      // The publisher's own date where the route states one, else the date eye's copy was fixed; the reason says which.
      const dated = it.publishedAt ?? it.snapshotAt;
      if (said.has(it.sourceId) || !it.cadence || !dated) continue;
      const late = staleBy(dated, it.cadence.kind, now);
      if (!late) continue;
      said.add(it.sourceId);
      const whose = it.publishedAt ? `its own date for this data is ${dated}` : `eye serves a snapshot from ${dated}`;
      miss(sec, `${it.sourceId} freshness`, `${it.publisher} releases ${it.cadence.kind}; ${whose} (${late.ageDays} days old; stale after ${late.limit} days)`, "stale");
    }
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
    point: pointOut(r.point, ctx.releaseCadence),
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
    schemaVersion: WORLD_SCHEMA_VERSION,
    place,
    topics: out,
    limits: { maxBytes: WORLD_MAX_BYTES, maxRecords: max },
    note: WORLD_REPLY_NOTE,
  };

  let dropped = 0;
  const finish = () => {
    const basis: BasisLine[] = [];
    for (const k of order) {
      const sec = S[k];
      // A stale entry's sentence is written once, on the entry; its basis line is the code and the source.
      const lines: BasisLine[] = [...(sec.missing ?? []).map((m) => ({ code: m.code, text: m.code === "stale" ? m.what : `${m.what}: ${m.reason}` })), ...sec.cut];
      if (lines.length) out[k].coverageStatus = { status: "partial", basis: lines };
      else delete out[k].coverageStatus;
      for (const l of lines) basis.push({ code: l.code, text: `${k}: ${l.text}` });
    }
    if (dropped) {
      payload.truncated = { droppedItems: dropped, note: `items cut from the longest topics to stay under ${WORLD_MAX_BYTES} bytes; ask fewer topics or a smaller max_records` };
      basis.push({ code: "cut_by_byte_cap", text: `the reply was cut to ${WORLD_MAX_BYTES} bytes (${dropped} item${dropped === 1 ? "" : "s"} dropped)` });
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
