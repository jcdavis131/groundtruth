// Small helpers the matchers share. Pure; no I/O.

import type { Reading, Scalar } from "../types";

export type Row = Record<string, unknown>;

export function parseJson(body: string): unknown | null {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** The attribute rows of an ArcGIS query reply, or null when the reply is not one (an error object, HTML, a renamed shape). */
export function arcgisRows(body: string): Row[] | null {
  const j = parseJson(body);
  if (!isObj(j) || !Array.isArray(j.features)) return null;
  const out: Row[] = [];
  for (const f of j.features) {
    if (!isObj(f) || !isObj(f.attributes)) return null;
    out.push(f.attributes);
  }
  return out;
}

export function toNum(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Collapse runs of whitespace and trim, as world.ts does to every string it copies. */
export function norm(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s || null;
}

export const unreadable = (reason: string): Reading => ({ kind: "unreadable", reason });
export const absent = (reason: string): Reading => ({ kind: "absent", reason });

/** One compared field with the item's value in the publisher's form. */
export const also = (field: string, item: Scalar, publisher: Scalar) => ({ field, item, publisher });

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "December 2025" -> 2025*12+11, or null. Orders NRI release names. */
export function monthYearIndex(s: string | null | undefined): number | null {
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec((s ?? "").trim());
  const mi = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return m && mi >= 0 ? Number(m[2]) * 12 + mi : null;
}

/** A "ST, ..." trailing state suffix, as world.ts adds to county names ("Travis County, TX"). */
export const stripState = (s: string): string => s.replace(/, [A-Z]{2}$/, "");

/** Value of "label X; ..." style note segments: the text after a prefix, up to the next semicolon. */
export function noteField(note: string | undefined, prefix: string): string | null {
  for (const seg of (note ?? "").split(";")) {
    const t = seg.trim();
    if (t.toLowerCase().startsWith(prefix.toLowerCase())) return t.slice(prefix.length).trim();
  }
  return null;
}
