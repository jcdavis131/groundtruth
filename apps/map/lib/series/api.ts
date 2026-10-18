// Pure parameter parsing and response shaping for /api/series, kept out of
// the route file so it can be unit-tested without Next.js and reused by the
// MCP server or a CLI.

import { timingSafeEqual } from "node:crypto";
import type { Enveloped, Provenance } from "@/lib/provenance/types";
import { SERIES_ID_RE } from "./collect";
import { clampLimit, ROLLUPS, type ReadRollup } from "./read";

export const OPS = ["list", "get", "collectors", "collect"] as const;
export type Op = (typeof OPS)[number];

export const PREFIX_RE = /^[a-zA-Z0-9:_.\-]{0,120}$/;
export const COLLECTOR_ID_RE = /^[a-z0-9][a-z0-9\-]{0,39}$/;
export const MAX_IDS = 20;
export const MAX_ONLY = 20;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function bad<T>(error: string): Parsed<T> {
  return { ok: false, error };
}

/** Accept an ISO 8601 string or epoch milliseconds; undefined when absent. */
export function parseTime(raw: string | null | undefined): Parsed<number | undefined> {
  if (raw == null || raw === "") return { ok: true, value: undefined };
  const s = raw.trim();
  const n = /^-?\d{1,15}$/.test(s) ? Number(s) : Date.parse(s);
  if (!Number.isFinite(n)) return bad(`bad time ${JSON.stringify(raw)}: use ISO 8601 or epoch ms`);
  // Anything before 1970 or after year 3000 is a typo, not a query.
  if (n < 0 || n > 32_503_680_000_000) return bad(`time out of range: ${raw}`);
  return { ok: true, value: n };
}

export function parseOp(raw: string | null): Parsed<Op> {
  const op = (raw ?? "list").trim() as Op;
  return (OPS as readonly string[]).includes(op) ? { ok: true, value: op } : bad(`unknown op ${JSON.stringify(raw)}; one of ${OPS.join(", ")}`);
}

export function parsePrefix(raw: string | null): Parsed<string | undefined> {
  if (raw == null || raw === "") return { ok: true, value: undefined };
  return PREFIX_RE.test(raw) ? { ok: true, value: raw } : bad("bad prefix: letters, digits, ':', '_', '.', '-' only, at most 120 chars");
}

export function parseSeriesId(raw: string | null): Parsed<string> {
  if (!raw) return bad("id is required");
  return SERIES_ID_RE.test(raw) ? { ok: true, value: raw } : bad(`bad id ${JSON.stringify(raw)}`);
}

/** `ids=a,b,c` — deduped, each validated, at most MAX_IDS. */
export function parseSeriesIds(raw: string | null): Parsed<string[]> {
  if (!raw) return bad("ids is required");
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return bad("ids is empty");
  if (ids.length > MAX_IDS) return bad(`at most ${MAX_IDS} ids per request`);
  for (const id of ids) if (!SERIES_ID_RE.test(id)) return bad(`bad id ${JSON.stringify(id)}`);
  return { ok: true, value: ids };
}

export function parseRollup(raw: string | null): Parsed<ReadRollup | undefined> {
  if (raw == null || raw === "") return { ok: true, value: undefined };
  return (ROLLUPS as readonly string[]).includes(raw) ? { ok: true, value: raw as ReadRollup } : bad(`bad rollup ${JSON.stringify(raw)}; one of ${ROLLUPS.join(", ")}`);
}

export type Format = "json" | "csv";

export function parseFormat(raw: string | null): Parsed<Format> {
  if (raw == null || raw === "" || raw === "json") return { ok: true, value: "json" };
  if (raw === "csv") return { ok: true, value: "csv" };
  return bad(`bad format ${JSON.stringify(raw)}; json or csv`);
}

export interface GetParams {
  ids: string[];
  /** True when the caller used `id=` (single), so the JSON payload is one object rather than a list. */
  single: boolean;
  from?: number;
  to?: number;
  limit: number;
  rollup?: ReadRollup;
  format: Format;
}

/** Parse and validate every `op=get` parameter; the first problem wins. */
export function parseGetParams(q: URLSearchParams): Parsed<GetParams> {
  const idRaw = q.get("id");
  const idsRaw = q.get("ids");
  let ids: string[];
  let single: boolean;
  if (idRaw && idsRaw) return bad("use id or ids, not both");
  if (idRaw) {
    const r = parseSeriesId(idRaw);
    if (!r.ok) return r;
    ids = [r.value];
    single = true;
  } else {
    const r = parseSeriesIds(idsRaw);
    if (!r.ok) return bad(idsRaw ? r.error : "id (or ids) is required");
    ids = r.value;
    single = false;
  }
  const from = parseTime(q.get("from"));
  if (!from.ok) return from;
  const to = parseTime(q.get("to"));
  if (!to.ok) return to;
  if (from.value != null && to.value != null && from.value > to.value) return bad("from is after to");
  const limitRaw = q.get("limit");
  if (limitRaw != null && limitRaw !== "" && !/^\d{1,7}$/.test(limitRaw)) return bad("bad limit");
  const limit = clampLimit(limitRaw ? Number(limitRaw) : undefined);
  const rollup = parseRollup(q.get("rollup"));
  if (!rollup.ok) return rollup;
  const format = parseFormat(q.get("format"));
  if (!format.ok) return format;
  return { ok: true, value: { ids, single, from: from.value, to: to.value, limit, rollup: rollup.value, format: format.value } };
}

/** `only=a,b` collector ids for op=collect; empty means all. */
export function parseOnly(raw: string | null): Parsed<string[] | undefined> {
  if (raw == null || raw.trim() === "") return { ok: true, value: undefined };
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length > MAX_ONLY) return bad(`at most ${MAX_ONLY} collectors per request`);
  for (const id of ids) if (!COLLECTOR_ID_RE.test(id)) return bad(`bad collector id ${JSON.stringify(id)}`);
  return { ok: true, value: ids };
}

/**
 * Constant-time check of the cron header against the configured secret.
 * "unset" when no secret is configured (the op should then 404).
 */
export function cronAuth(header: string | null | undefined, secret: string | undefined): "unset" | "ok" | "denied" {
  const s = (secret ?? "").trim();
  if (!s) return "unset";
  const h = (header ?? "").trim();
  if (!h) return "denied";
  const a = Buffer.from(h, "utf8");
  const b = Buffer.from(s, "utf8");
  if (a.length !== b.length) return "denied";
  return timingSafeEqual(a, b) ? "ok" : "denied";
}

/** Wrap a payload in the shared envelope, deduping provenance by source + series. */
export function envelope<T>(data: T, provenance: Provenance[], caveats?: string[], generatedAt = new Date().toISOString()): Enveloped<T> {
  const seen = new Set<string>();
  const uniq: Provenance[] = [];
  for (const p of provenance) {
    const k = `${p.source.id}|${p.seriesId ?? ""}|${p.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  const out: Enveloped<T> = { data, provenance: uniq, generatedAt };
  if (caveats && caveats.length) out.caveats = caveats;
  return out;
}

/** File name for a CSV download of these ids. */
export function csvFileName(ids: string[]): string {
  const stem = ids.length === 1 ? ids[0] : `${ids.length}-series`;
  return stem.replace(/[^a-zA-Z0-9_.\-]+/g, "_").slice(0, 80) + ".csv";
}
