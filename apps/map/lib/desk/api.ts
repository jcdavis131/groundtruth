// Client side of the "Add series" picker: what the series, indicator and
// county-history routes return, parsed defensively. Those routes are built by
// other workstreams; this file codes against the shared contracts in
// lib/series/types.ts and lib/provenance/types.ts (Enveloped<T>) and treats a
// 404 as "not available yet" rather than an error. The parsers are pure so
// they are tested without a network.

import type { Point, Series, SeriesMeta } from "@/lib/series/types";

export type PickerSource = "series" | "indicator" | "history";

/** A series the operator picked, as persisted by the desk store (no points). */
export interface SeriesRef {
  id: string;
  label: string;
  color: string;
  source: PickerSource;
}

/** One line in the picker list. */
export interface PickerItem {
  id: string;
  label: string;
  unit: string;
  source: PickerSource;
  /** Extra text for search: tags, geography, category. */
  hint?: string;
}

/** Outcome of a fetch: data, "not available" (404 / route missing), or an error message. */
export type Fetched<T> = { ok: true; data: T } | { ok: false; missing: true; message: string } | { ok: false; missing: false; message: string };

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function str(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

/** Points with a numeric `t` and a numeric-or-null `v`, sorted ascending. Malformed entries are dropped. */
export function parsePoints(raw: unknown): Point[] {
  if (!Array.isArray(raw)) return [];
  const out: Point[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && p.length >= 2) {
      // [t, v] tuples are accepted as well as {t, v}
      const t = typeof p[0] === "string" ? Date.parse(p[0]) : Number(p[0]);
      const v = p[1] == null ? null : Number(p[1]);
      if (Number.isFinite(t)) out.push({ t, v: v == null || !Number.isFinite(v) ? null : v });
      continue;
    }
    if (!isRecord(p)) continue;
    const t = typeof p.t === "string" ? Date.parse(p.t) : Number(p.t);
    if (!Number.isFinite(t)) continue;
    const v = p.v == null ? null : Number(p.v);
    out.push({ t, v: v == null || !Number.isFinite(v) ? null : v });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** A SeriesMeta from loose JSON; null when the id or title is missing. */
export function parseSeriesMeta(raw: unknown): SeriesMeta | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  // Provenance is relayed as-is; the route owns its shape and the chart only reads source.name.
  const prov = isRecord(raw.provenance) && isRecord(raw.provenance.source) && typeof raw.provenance.source.name === "string" ? (raw.provenance as unknown as SeriesMeta["provenance"]) : undefined;
  return {
    id,
    title: str(raw.title, id),
    unit: str(raw.unit),
    frequency: (str(raw.frequency, "irregular") as SeriesMeta["frequency"]),
    geo: isRecord(raw.geo) ? (raw.geo as SeriesMeta["geo"]) : undefined,
    // The picker only needs a source name; a missing provenance is filled with a placeholder the chart labels honestly.
    provenance: prov ?? { source: { id: "unknown", name: "unknown", publisher: "unknown", url: "", license: "" }, retrievedAt: "", kind: "published" },
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : undefined,
  };
}

/** A Series from loose JSON: meta plus points. */
export function parseSeries(raw: unknown): Series | null {
  const meta = parseSeriesMeta(raw);
  if (!meta || !isRecord(raw)) return null;
  return { ...meta, points: parsePoints(raw.points) };
}

/** `data` of an Enveloped<T> (lib/provenance/types.ts), or the raw value when the route did not envelope. */
export function unwrap(json: unknown): unknown {
  if (isRecord(json) && "data" in json) return json.data;
  return json;
}

/** Series list response → picker items. Accepts `{ data: SeriesMeta[] }` or a bare array. */
export function parseSeriesList(json: unknown, source: PickerSource = "series"): PickerItem[] {
  const data = unwrap(json);
  if (!Array.isArray(data)) return [];
  const out: PickerItem[] = [];
  for (const raw of data) {
    const m = parseSeriesMeta(raw);
    if (!m) continue;
    out.push({ id: m.id, label: m.title, unit: m.unit, source, hint: [m.geo?.name, ...(m.tags ?? [])].filter(Boolean).join(" ") });
  }
  return out;
}

/**
 * Indicator list response → picker items. Indicators carry `title`, `unit`
 * and `category`; the series behind one is `indicator:<id>` (see
 * lib/indicators/types.ts indicatorSeriesId).
 */
export function parseIndicatorList(json: unknown): PickerItem[] {
  const data = unwrap(json);
  if (!Array.isArray(data)) return [];
  const out: PickerItem[] = [];
  for (const raw of data) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    if (!id) continue;
    out.push({ id, label: str(raw.title, id), unit: str(raw.unit), source: "indicator", hint: [str(raw.category), str(raw.seriesId)].filter(Boolean).join(" ") });
  }
  return out;
}

/**
 * County history response → series. Accepts `{ data: Series[] }`,
 * `{ data: { series: Series[] } }` or `{ data: Series }` so the picker works
 * whichever the history workstream settles on.
 */
export function parseHistory(json: unknown): Series[] {
  const data = unwrap(json);
  const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.series) ? data.series : data != null ? [data] : [];
  return list.map(parseSeries).filter((s): s is Series => !!s);
}

/** Five-digit county FIPS; state FIPS 01–56 plus 72 (PR). */
export function isCountyFips(s: string): boolean {
  if (!/^\d{5}$/.test(s)) return false;
  const st = Number(s.slice(0, 2));
  return (st >= 1 && st <= 56) || st === 72;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** GET JSON with the 404 / network cases folded into a Fetched. */
export async function fetchJson(url: string, fetchImpl: FetchLike = fetch, signal?: AbortSignal): Promise<Fetched<unknown>> {
  try {
    const res = await fetchImpl(url, { signal, headers: { accept: "application/json" } });
    if (res.status === 404) return { ok: false, missing: true, message: "This route is not available on this deployment yet." };
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* non-JSON error body */
      }
      return { ok: false, missing: false, message };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return { ok: false, missing: false, message: "cancelled" };
    return { ok: false, missing: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export const ROUTES = {
  seriesList: "/api/series?op=list",
  seriesGet: (id: string) => `/api/series?op=get&id=${encodeURIComponent(id)}`,
  indicatorList: "/api/indicators?op=list",
  indicatorGet: (id: string) => `/api/indicators?op=get&id=${encodeURIComponent(id)}`,
  countyHistory: (fips: string) => `/api/economy/history?op=county&fips=${encodeURIComponent(fips)}`,
} as const;

/** Picker items for a source. County history needs a FIPS and yields one item per series the route returns. */
export async function listPicker(source: PickerSource, opts: { fips?: string; fetchImpl?: FetchLike; signal?: AbortSignal } = {}): Promise<Fetched<PickerItem[]>> {
  if (source === "series") {
    const r = await fetchJson(ROUTES.seriesList, opts.fetchImpl, opts.signal);
    return r.ok ? { ok: true, data: parseSeriesList(r.data, "series") } : r;
  }
  if (source === "indicator") {
    const r = await fetchJson(ROUTES.indicatorList, opts.fetchImpl, opts.signal);
    return r.ok ? { ok: true, data: parseIndicatorList(r.data) } : r;
  }
  const fips = opts.fips ?? "";
  if (!isCountyFips(fips)) return { ok: false, missing: false, message: "Enter a five-digit county FIPS (e.g. 48453 for Travis County, TX)." };
  const r = await fetchJson(ROUTES.countyHistory(fips), opts.fetchImpl, opts.signal);
  if (!r.ok) return r;
  return { ok: true, data: parseHistory(r.data).map((s) => ({ id: s.id, label: s.title, unit: s.unit, source: "history" as const, hint: fips })) };
}

/**
 * The points behind a picked series. Indicators resolve through the
 * indicators route; county history re-reads the county payload and picks the
 * matching series (the route has no per-series op, and the payload is cached).
 */
export async function fetchSeries(ref: SeriesRef, opts: { fips?: string; fetchImpl?: FetchLike; signal?: AbortSignal } = {}): Promise<Fetched<Series>> {
  if (ref.source === "history") {
    const fips = opts.fips ?? fipsFromHistoryId(ref.id) ?? "";
    if (!isCountyFips(fips)) return { ok: false, missing: false, message: "County history needs a FIPS." };
    const r = await fetchJson(ROUTES.countyHistory(fips), opts.fetchImpl, opts.signal);
    if (!r.ok) return r;
    const s = parseHistory(r.data).find((x) => x.id === ref.id);
    return s ? { ok: true, data: s } : { ok: false, missing: false, message: `Series ${ref.id} is not in the county payload.` };
  }
  const url = ref.source === "indicator" ? ROUTES.indicatorGet(ref.id) : ROUTES.seriesGet(ref.id);
  const r = await fetchJson(url, opts.fetchImpl, opts.signal);
  if (!r.ok) return r;
  const data = unwrap(r.data);
  // Indicator "get" may answer { indicator, series, status }; plain series routes answer the Series.
  const s = parseSeries(isRecord(data) && "series" in data ? data.series : data);
  return s ? { ok: true, data: s } : { ok: false, missing: false, message: "The response did not contain a series." };
}

/** County FIPS embedded in a history series id such as "zhvi:county:48453" or "qcew:48453:10". */
export function fipsFromHistoryId(id: string): string | null {
  const m = id.match(/(?:^|:)(\d{5})(?::|$)/);
  return m && isCountyFips(m[1]) ? m[1] : null;
}
