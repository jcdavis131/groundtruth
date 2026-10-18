// Watchlists: a plain JSON document a person keeps in their browser, and a
// compact token that carries the same document inside a feed URL so the
// server never has to remember anything.
//
//   Watchlist  { id, title, items: WatchItem[], rules: Rule[], createdAt, version }
//   WatchItem  { kind, id, name?, geo? }        what to look at
//   Rule       { itemRef?, metric, op, value, window? }   when to speak up
//
// Token = base64url( deflate-raw( JSON of the compact form ) ). The compact
// form swaps object keys for short arrays so a 20-item list fits in a few
// hundred bytes. Both code paths (Node zlib, browser CompressionStream)
// produce the same bytes; either side decodes the other's tokens.
//
// No zod in this project: validation is hand written and every failure is a
// plain sentence pointing at the field, so a script author can fix the input.

export const WATCH_KINDS = ["county", "state", "port", "crossing", "gauge", "series", "indicator", "company"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

export const RULE_OPS = ["<", ">", "<=", ">=", "crosses_above", "crosses_below", "changes_by_pct"] as const;
export type RuleOp = (typeof RULE_OPS)[number];

export const RULE_WINDOWS = ["1d", "7d", "30d"] as const;
export type RuleWindow = (typeof RULE_WINDOWS)[number];

export interface WatchItem {
  kind: WatchKind;
  /** County GEOID (5 digits), state FIPS (2 digits), WPI port id, BTS port code, USGS site id, series id, indicator id, company id. */
  id: string;
  name?: string;
  /** [lon, lat] when the item is a place; lets the feed link to the globe without a lookup. */
  geo?: [number, number];
}

export interface Rule {
  /** Index into `items`, or "*" for every item that publishes the metric. Omitted = "*". */
  itemRef?: number | "*";
  /** Metric id the resolver publishes for the item's kind, e.g. "home.yoyPct", "jobs.yoy.emp", "stage", "value". */
  metric: string;
  op: RuleOp;
  value: number;
  /** Lookback for crosses_* and changes_by_pct when the resolver can look back; else the last evaluation is the reference. */
  window?: RuleWindow;
}

export interface Watchlist {
  id: string;
  title: string;
  items: WatchItem[];
  rules: Rule[];
  /** ISO 8601. */
  createdAt: string;
  /** Bumped by the browser on every edit; lets a feed reader notice a changed list. */
  version: number;
}

/** Bounds a hostile or clumsy document cannot exceed. */
export const LIMITS = {
  items: 50,
  rules: 100,
  titleChars: 120,
  nameChars: 120,
  idChars: 64,
  metricChars: 64,
  /** Encoded token length in characters (the URL budget). */
  tokenChars: 8 * 1024,
  /** Inflated JSON size we are willing to parse; protects against a zip bomb. */
  inflatedBytes: 64 * 1024,
} as const;

export const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ITEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:_.\-]{0,63}$/;
const METRIC_RE = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

/** Metric ids each resolver publishes, for pickers and docs. Resolvers may publish more (e.g. one per crossing measure). */
export const METRICS_BY_KIND: Record<WatchKind, Array<{ id: string; label: string; unit: string }>> = {
  county: [
    { id: "home.latest", label: "Typical home value", unit: "USD" },
    { id: "home.yoyPct", label: "Home value, 1-yr change", unit: "%" },
    { id: "home.y5Pct", label: "Home value, 5-yr change", unit: "%" },
    { id: "rent.latest", label: "Typical rent", unit: "USD/mo" },
    { id: "rent.yoyPct", label: "Rent, 1-yr change", unit: "%" },
    { id: "priceToRent", label: "Price to annual rent (estimate)", unit: "x" },
    { id: "jobs.emp", label: "Jobs (QCEW month-3 employment)", unit: "count" },
    { id: "jobs.estabs", label: "Employers", unit: "count" },
    { id: "jobs.avgWeeklyWage", label: "Average weekly wage", unit: "USD" },
    { id: "jobs.yoy.emp", label: "Jobs, 1-yr change", unit: "%" },
    { id: "jobs.yoy.avgWeeklyWage", label: "Wage, 1-yr change", unit: "%" },
    { id: "jobs.yoy.estabs", label: "Employers, 1-yr change", unit: "%" },
  ],
  state: [
    { id: "home.latest", label: "Typical home value", unit: "USD" },
    { id: "home.yoyPct", label: "Home value, 1-yr change", unit: "%" },
    { id: "home.y5Pct", label: "Home value, 5-yr change", unit: "%" },
    { id: "jobs.emp", label: "Jobs (QCEW month-3 employment)", unit: "count" },
    { id: "jobs.estabs", label: "Employers", unit: "count" },
    { id: "jobs.avgWeeklyWage", label: "Average weekly wage", unit: "USD" },
    { id: "jobs.yoy.emp", label: "Jobs, 1-yr change", unit: "%" },
    { id: "jobs.yoy.avgWeeklyWage", label: "Wage, 1-yr change", unit: "%" },
  ],
  port: [
    { id: "container.total", label: "Containers (TEU, latest year)", unit: "TEU" },
    { id: "container.pctChange", label: "Containers, 1-yr change", unit: "%" },
    { id: "container.ranking", label: "Container rank (US)", unit: "rank" },
    { id: "tonnage.total", label: "Tonnage (latest year)", unit: "short tons" },
    { id: "tonnage.pctChange", label: "Tonnage, 1-yr change", unit: "%" },
    { id: "tonnage.ranking", label: "Tonnage rank (US)", unit: "rank" },
    { id: "dryBulk.total", label: "Dry bulk (latest year)", unit: "short tons" },
    { id: "dryBulk.pctChange", label: "Dry bulk, 1-yr change", unit: "%" },
  ],
  crossing: [
    { id: "trucks.latest", label: "Trucks / month", unit: "count" },
    { id: "trucks.yoyPct", label: "Trucks, 1-yr change", unit: "%" },
    { id: "personalVehicles.latest", label: "Personal vehicles / month", unit: "count" },
    { id: "personalVehicles.yoyPct", label: "Personal vehicles, 1-yr change", unit: "%" },
    { id: "pedestrians.latest", label: "Pedestrians / month", unit: "count" },
    { id: "pedestrians.yoyPct", label: "Pedestrians, 1-yr change", unit: "%" },
    { id: "trains.latest", label: "Trains / month", unit: "count" },
    { id: "buses.latest", label: "Buses / month", unit: "count" },
  ],
  gauge: [
    { id: "stage", label: "Gage height (00065)", unit: "ft" },
    { id: "flow", label: "Discharge (00060)", unit: "ft³/s" },
    { id: "temp", label: "Water temperature (00010)", unit: "°C" },
    { id: "do", label: "Dissolved oxygen (00300)", unit: "mg/L" },
    { id: "conductance", label: "Specific conductance (00095)", unit: "µS/cm" },
    { id: "ph", label: "pH (00400)", unit: "pH" },
    { id: "turbidity", label: "Turbidity (63680)", unit: "FNU" },
  ],
  series: [
    { id: "value", label: "Latest value", unit: "series unit" },
    { id: "previous", label: "Value one window ago", unit: "series unit" },
    { id: "change", label: "Change over the window", unit: "series unit" },
    { id: "changePct", label: "Change over the window", unit: "%" },
  ],
  indicator: [
    { id: "value", label: "Latest value", unit: "indicator unit" },
    { id: "previous", label: "Value one window ago", unit: "indicator unit" },
    { id: "change", label: "Change over the window", unit: "indicator unit" },
    { id: "changePct", label: "Change over the window", unit: "%" },
  ],
  company: [],
};

// ---------------------------------------------------------------- validation

export type Validation<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateItem(raw: unknown, at: string, errors: string[]): WatchItem | null {
  if (!isObj(raw)) {
    errors.push(`${at}: must be an object { kind, id, name?, geo? }`);
    return null;
  }
  const kind = raw.kind;
  if (typeof kind !== "string" || !(WATCH_KINDS as readonly string[]).includes(kind)) {
    errors.push(`${at}.kind: must be one of ${WATCH_KINDS.join(", ")}`);
    return null;
  }
  const id = raw.id;
  if (typeof id !== "string" || !ITEM_ID_RE.test(id)) {
    errors.push(`${at}.id: 1-${LIMITS.idChars} characters, letters, digits, ':' '_' '.' '-'`);
    return null;
  }
  const out: WatchItem = { kind: kind as WatchKind, id };
  if (raw.name != null) {
    if (typeof raw.name !== "string" || raw.name.length > LIMITS.nameChars) {
      errors.push(`${at}.name: a string of at most ${LIMITS.nameChars} characters`);
      return null;
    }
    if (raw.name.trim()) out.name = raw.name.trim();
  }
  if (raw.geo != null) {
    const g = raw.geo;
    if (!Array.isArray(g) || g.length !== 2 || !g.every((n) => typeof n === "number" && Number.isFinite(n)) || Math.abs(g[0]) > 180 || Math.abs(g[1]) > 90) {
      errors.push(`${at}.geo: [lon, lat] with lon in -180..180 and lat in -90..90`);
      return null;
    }
    out.geo = [Math.round(g[0] * 1e5) / 1e5, Math.round(g[1] * 1e5) / 1e5];
  }
  return out;
}

function validateRule(raw: unknown, at: string, itemCount: number, errors: string[]): Rule | null {
  if (!isObj(raw)) {
    errors.push(`${at}: must be an object { itemRef?, metric, op, value, window? }`);
    return null;
  }
  const out: Partial<Rule> = {};
  if (raw.itemRef != null && raw.itemRef !== "*") {
    const ref = raw.itemRef;
    if (typeof ref !== "number" || !Number.isInteger(ref) || ref < 0 || ref >= itemCount) {
      errors.push(`${at}.itemRef: "*" or an integer index into items (0..${Math.max(0, itemCount - 1)})`);
      return null;
    }
    out.itemRef = ref;
  } else if (raw.itemRef === "*") out.itemRef = "*";
  if (typeof raw.metric !== "string" || !METRIC_RE.test(raw.metric)) {
    errors.push(`${at}.metric: a metric id such as "home.yoyPct" (letters, digits, '.', '_')`);
    return null;
  }
  out.metric = raw.metric;
  if (typeof raw.op !== "string" || !(RULE_OPS as readonly string[]).includes(raw.op)) {
    errors.push(`${at}.op: one of ${RULE_OPS.join(", ")}`);
    return null;
  }
  out.op = raw.op as RuleOp;
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) {
    errors.push(`${at}.value: a finite number`);
    return null;
  }
  if (out.op === "changes_by_pct" && raw.value === 0) {
    errors.push(`${at}.value: changes_by_pct needs a non-zero percent (positive = rises by, negative = falls by)`);
    return null;
  }
  out.value = raw.value;
  if (raw.window != null) {
    if (typeof raw.window !== "string" || !(RULE_WINDOWS as readonly string[]).includes(raw.window)) {
      errors.push(`${at}.window: one of ${RULE_WINDOWS.join(", ")}`);
      return null;
    }
    out.window = raw.window as RuleWindow;
  }
  return out as Rule;
}

/**
 * Check an untrusted document and return a normalised copy. Unknown fields are
 * dropped, strings trimmed, coordinates rounded. Every error names the field.
 */
export function validateWatchlist(input: unknown): Validation<Watchlist> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["watchlist: must be an object { id, title, items, rules, createdAt, version }"] };
  const id = typeof input.id === "string" ? input.id.trim().toLowerCase() : "";
  if (!ID_RE.test(id)) errors.push("id: 3-64 characters, lower-case letters, digits and '-', starting with a letter or digit");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > LIMITS.titleChars) errors.push(`title: 1-${LIMITS.titleChars} characters`);
  const items: WatchItem[] = [];
  if (!Array.isArray(input.items)) errors.push("items: must be an array");
  else if (input.items.length > LIMITS.items) errors.push(`items: at most ${LIMITS.items} (got ${input.items.length})`);
  else {
    input.items.forEach((raw, i) => {
      const it = validateItem(raw, `items[${i}]`, errors);
      if (it) items.push(it);
    });
  }
  const rules: Rule[] = [];
  if (input.rules == null) warnings.push("rules: none; the feed will carry only the digest entry");
  else if (!Array.isArray(input.rules)) errors.push("rules: must be an array");
  else if (input.rules.length > LIMITS.rules) errors.push(`rules: at most ${LIMITS.rules} (got ${input.rules.length})`);
  else {
    input.rules.forEach((raw, i) => {
      const r = validateRule(raw, `rules[${i}]`, Array.isArray(input.items) ? input.items.length : 0, errors);
      if (r) rules.push(r);
    });
  }
  let createdAt = typeof input.createdAt === "string" ? input.createdAt : "";
  if (!createdAt) createdAt = new Date().toISOString();
  else if (!Number.isFinite(Date.parse(createdAt))) errors.push("createdAt: ISO 8601 date-time");
  const version = input.version == null ? 1 : input.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0 || version > 1e9) errors.push("version: a non-negative integer");
  if (errors.length) return { ok: false, errors };
  const seen = new Set<string>();
  for (const it of items) {
    const k = `${it.kind}:${it.id}`;
    if (seen.has(k)) warnings.push(`items: ${k} appears more than once`);
    seen.add(k);
  }
  return { ok: true, value: { id, title, items, rules, createdAt, version: version as number }, warnings };
}

/** Random, URL-safe id: 12 base32 characters. Uses the platform CSPRNG when there is one. */
export function newId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = new Uint8Array(12);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}

/** A fresh, empty watchlist. */
export function newWatchlist(title = "My watchlist"): Watchlist {
  return { id: newId(), title, items: [], rules: [], createdAt: new Date().toISOString(), version: 1 };
}

// ---------------------------------------------------------------- compact form

type CompactItem = [WatchKind, string, string?, [number, number]?];
type CompactRule = [number | "*", string, RuleOp, number, RuleWindow?];
interface Compact {
  v: 1;
  id: string;
  t: string;
  i: CompactItem[];
  r: CompactRule[];
  c: string;
  n: number;
}

export function toCompact(w: Watchlist): Compact {
  return {
    v: 1,
    id: w.id,
    t: w.title,
    i: w.items.map((it) => {
      const row: CompactItem = [it.kind, it.id];
      if (it.name) row[2] = it.name;
      if (it.geo) {
        if (!it.name) row[2] = "";
        row[3] = it.geo;
      }
      return row;
    }),
    r: w.rules.map((r) => {
      const row: CompactRule = [r.itemRef ?? "*", r.metric, r.op, r.value];
      if (r.window) row[4] = r.window;
      return row;
    }),
    c: w.createdAt,
    n: w.version,
  };
}

/** Expand a compact form back to a document, then validate it like any other input. */
export function fromCompact(raw: unknown): Validation<Watchlist> {
  if (!isObj(raw) || raw.v !== 1) return { ok: false, errors: ["token: unknown format version"] };
  const items = Array.isArray(raw.i)
    ? raw.i.map((row) => (Array.isArray(row) ? { kind: row[0], id: row[1], name: row[2] || undefined, geo: row[3] } : row))
    : raw.i;
  const rules = Array.isArray(raw.r)
    ? raw.r.map((row) => (Array.isArray(row) ? { itemRef: row[0], metric: row[1], op: row[2], value: row[3], window: row[4] } : row))
    : raw.r;
  return validateWatchlist({ id: raw.id, title: raw.t, items, rules, createdAt: raw.c, version: raw.n });
}

// ---------------------------------------------------------------- bytes and base64url

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function utf8Decode(b: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(b);
}

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("token: not base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- token codec

/** The compression primitive a token needs. `inflate` must throw when output would exceed `maxBytes`. */
export interface TokenCodec {
  deflate(bytes: Uint8Array): Promise<Uint8Array>;
  inflate(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array>;
}

/** Web Streams codec: browsers and Node >= 20.12 (which has CompressionStream with "deflate-raw"). */
export const streamCodec: TokenCodec = {
  async deflate(bytes) {
    const cs = new CompressionStream("deflate-raw");
    return collect(cs.readable, feed(cs.writable, bytes), Infinity);
  },
  async inflate(bytes, maxBytes) {
    const ds = new DecompressionStream("deflate-raw");
    return collect(ds.readable, feed(ds.writable, bytes), maxBytes);
  },
};

/** Write the whole input and close. Errors surface on the readable side, so the writer's own rejections are swallowed here. */
function feed(writable: WritableStream<BufferSource>, bytes: Uint8Array): Promise<void> {
  const w = writable.getWriter();
  const done = w
    .write(bytes as BufferSource)
    .then(() => w.close())
    .catch(() => {});
  w.closed.catch(() => {});
  return done;
}

async function collect(readable: ReadableStream<Uint8Array>, writer: Promise<void>, maxBytes: number): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new Error(`token: inflates past ${maxBytes} bytes`);
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    await writer;
    throw err;
  }
  await writer;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

let codec: TokenCodec = streamCodec;

/** Swap the compression primitive (the server registers Node zlib; tests inject fakes). */
export function setTokenCodec(c: TokenCodec | null) {
  codec = c ?? streamCodec;
}

/** Encode a validated watchlist as a URL token. Throws when the result would exceed LIMITS.tokenChars. */
export async function encodeToken(w: Watchlist, c: TokenCodec = codec): Promise<string> {
  const json = JSON.stringify(toCompact(w));
  const token = base64urlEncode(await c.deflate(utf8Encode(json)));
  if (token.length > LIMITS.tokenChars) throw new Error(`token: ${token.length} characters exceeds the ${LIMITS.tokenChars} limit; shorten names or split the list`);
  return token;
}

/** Decode and validate a token. Every failure is an Error whose message starts with "token:" or names a field. */
export async function decodeToken(token: string, c: TokenCodec = codec): Promise<Watchlist> {
  const t = token.trim();
  if (!t) throw new Error("token: empty");
  if (t.length > LIMITS.tokenChars) throw new Error(`token: longer than ${LIMITS.tokenChars} characters`);
  let json: string;
  try {
    json = utf8Decode(await c.inflate(base64urlDecode(t), LIMITS.inflatedBytes));
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    throw new Error(m.startsWith("token:") ? m : "token: not a deflated watchlist (" + m + ")");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("token: inflated bytes are not JSON");
  }
  const v = fromCompact(parsed);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return v.value;
}

/** Look-back in milliseconds for a rule window. */
export function windowMs(w: RuleWindow | undefined): number {
  switch (w) {
    case "1d":
      return 86_400_000;
    case "30d":
      return 30 * 86_400_000;
    case "7d":
    default:
      return 7 * 86_400_000;
  }
}

/** Human label for an item: its name, else "kind id". */
export function itemLabel(it: WatchItem): string {
  return it.name || `${it.kind} ${it.id}`;
}
