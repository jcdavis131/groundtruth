// Pure helpers behind /api/indicators: parameter validation and CSV
// rendering. Kept out of the route file so they run in vitest without
// next/server.

import type { Enveloped, Provenance } from "@/lib/provenance/types";
import { INDICATORS } from "./registry";
import { INDICATOR_CATEGORIES, type Indicator, type IndicatorCategory } from "./types";

export { csvCell, historyCsv, latestCsv } from "./csv";

export const MAX_IDS = 100;
export const MAX_HISTORY_POINTS = 5000;
export const DEFAULT_HISTORY_POINTS = 2000;

export type ParamResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** `ids=a,b,c` → unique ids in the order given; every id must exist in the registry. */
export function parseIds(raw: string | null, registry: readonly Indicator[] = INDICATORS): ParamResult<string[] | undefined> {
  if (raw == null || raw.trim() === "") return { ok: true, value: undefined };
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) return { ok: false, error: "ids must be a comma-separated list of indicator ids" };
  if (ids.length > MAX_IDS) return { ok: false, error: `at most ${MAX_IDS} ids per request` };
  const known = new Set(registry.map((i) => i.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) return { ok: false, error: `unknown indicator id(s): ${unknown.join(", ")}; see ?op=list` };
  return { ok: true, value: ids };
}

/** `category=freight` → a known category, or undefined when absent. */
export function parseCategory(raw: string | null): ParamResult<IndicatorCategory | undefined> {
  if (raw == null || raw.trim() === "") return { ok: true, value: undefined };
  const c = raw.trim().toLowerCase();
  if ((INDICATOR_CATEGORIES as string[]).includes(c)) return { ok: true, value: c as IndicatorCategory };
  return { ok: false, error: `unknown category ${raw}; one of ${INDICATOR_CATEGORIES.join(", ")}` };
}

/** Accept an ISO date/time or epoch milliseconds; undefined when absent. */
export function parseTime(raw: string | null): ParamResult<number | undefined> {
  if (raw == null || raw.trim() === "") return { ok: true, value: undefined };
  const s = raw.trim();
  if (/^\d{10,14}$/.test(s)) return { ok: true, value: Number(s) };
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00Z" : s);
  if (!Number.isFinite(t)) return { ok: false, error: `bad time ${raw}; use YYYY-MM-DD, ISO 8601 or epoch ms` };
  return { ok: true, value: t };
}

export interface HistoryParams {
  id: string;
  from?: number;
  to?: number;
  limit: number;
  format: "json" | "csv";
}

/** Validate every `?op=history` parameter at once; the first problem wins. */
export function parseHistoryParams(q: { id: string | null; from: string | null; to: string | null; limit: string | null; format: string | null }, registry: readonly Indicator[] = INDICATORS): ParamResult<HistoryParams> {
  const id = (q.id ?? "").trim();
  if (!id) return { ok: false, error: "id required; see ?op=list" };
  if (!registry.some((i) => i.id === id)) return { ok: false, error: `unknown indicator id ${id}; see ?op=list` };
  const from = parseTime(q.from);
  if (!from.ok) return from;
  const to = parseTime(q.to);
  if (!to.ok) return to;
  if (from.value != null && to.value != null && from.value > to.value) return { ok: false, error: "from must not be after to" };
  const n = q.limit == null || q.limit === "" ? DEFAULT_HISTORY_POINTS : Number(q.limit);
  if (!Number.isFinite(n)) return { ok: false, error: "limit must be a number" };
  const limit = Math.min(MAX_HISTORY_POINTS, Math.max(1, Math.floor(n)));
  const f = (q.format ?? "json").toLowerCase();
  if (f !== "json" && f !== "csv") return { ok: false, error: "format must be json or csv" };
  return { ok: true, value: { id, from: from.value, to: to.value, limit, format: f } };
}

/** Wrap a payload in the shared envelope with the provenance list deduplicated by source + series. */
export function envelope<T>(data: T, provenance: Provenance[], caveats?: string[], generatedAt = new Date().toISOString()): Enveloped<T> {
  const seen = new Set<string>();
  const out: Provenance[] = [];
  for (const p of provenance) {
    const k = `${p.source.id}|${p.seriesId ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return { data, provenance: out, generatedAt, ...(caveats?.length ? { caveats } : {}) };
}
