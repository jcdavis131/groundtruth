// Parcel records -> globe features. Plain functions shared by /api/parcels
// (outlines) and the browser (the identified parcel's dossier).
//
// An outline carries its parcel id and use class only: no owner, no address,
// no value. Owners appear only in the dossier of one parcel someone clicked,
// so panning across a town cannot collect names. A feature's `name` is never
// an owner's name: it is the site address the source publishes, or the
// parcel id.

import type { MultiPolygon, Point, Polygon } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import type { ParcelAdapter } from "./adapters";
import { text } from "./normalize";
import type { IdentifiedParcel, ParcelIdentify, ParcelRecord, PlssDescription } from "./types";

type Poly = Polygon | MultiPolygon;

function isPoly(g: unknown): g is Poly {
  const t = (g as { type?: string } | null)?.type;
  return t === "Polygon" || t === "MultiPolygon";
}

/** What an outline carries, besides its geometry. */
export interface ParcelOutlineExtra {
  adapter: string;
  parcelId: string;
  use?: string;
}

/** Outline rows (geometry + id + use field) -> LayerFeatures for the parcels layer. */
export function buildOutlines(
  rows: Array<{ geometry: unknown; properties: Record<string, unknown> | null }>,
  adapter: Pick<ParcelAdapter, "id" | "name" | "idField" | "useField">,
): LayerFeature[] {
  const out: LayerFeature[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!isPoly(r.geometry)) continue;
    const p = r.properties ?? {};
    const parcelId = text(p[adapter.idField]);
    if (!parcelId) continue;
    const id = `parcel:${adapter.id}:${parcelId}`;
    // Stacked records (condominium units) share one outline: draw it once.
    if (seen.has(id)) continue;
    seen.add(id);
    const use = adapter.useField ? text(p[adapter.useField]) : undefined;
    const extra: ParcelOutlineExtra = { adapter: adapter.id, parcelId, ...(use ? { use } : {}) };
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id,
        layer: "parcels",
        name: `Parcel ${parcelId}`,
        kind: "outline",
        source: adapter.name,
        details: {
          "parcel id": parcelId,
          use,
          "what this is": "a parcel outline; click inside it for the record its source publishes",
        },
        extra,
      },
    });
  }
  return out;
}

/** "$19,625,000". */
export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function areaText(a: NonNullable<ParcelRecord["area"]>): string {
  const v = a.unit === "acres" ? a.value.toLocaleString("en-US", { maximumFractionDigits: a.value < 10 ? 3 : 2 }) : Math.round(a.value).toLocaleString("en-US");
  return `${v} ${a.unit}, ${a.basis}`;
}

/** The owner line as the dossier shows it. */
export function ownerText(r: ParcelRecord): string {
  const o = r.owner;
  if (o.status === "published") {
    const who = o.names.join("; ");
    return `${who}${o.dba ? ` (doing business as ${o.dba})` : ""}${o.careOf ? `, care of ${o.careOf}` : ""}`;
  }
  if (o.status === "withheld") return /^withheld\b/.test(o.reason) ? o.reason : `withheld: ${o.reason}`;
  return `not published: ${o.reason}`;
}

/** The dossier's key/value lines for one record, in reading order. */
export function recordDetails(r: ParcelRecord, adapterName: string): Record<string, string | undefined> {
  const d: Record<string, string | undefined> = {};
  d["parcel id"] = r.parcelId;
  for (const [k, v] of Object.entries(r.otherIds ?? {})) d[k] = v;
  d["site address"] = r.situs;
  d["property name"] = r.propertyName;
  d.municipality = r.municipality;
  d.county = r.county;
  d[r.owner.status === "published" && r.owner.role === "taxpayer" ? "taxpayer" : "owner"] = ownerText(r);
  d["owner since"] = r.ownedSince;
  d.mailing = r.mailing ?? r.mailingNote;
  d["owner address"] = r.ownerAddress;
  d["taxpayer (separate)"] = r.taxpayer ? [r.taxpayer.name, r.taxpayer.address].filter(Boolean).join(", ") : undefined;
  if (r.values) {
    for (const v of r.values.items) d[`${v.label}${r.values.year ? ` · ${r.values.year}` : ""}`] = money(v.amount) + (v.amount === 0 ? " (as published)" : "");
    if (r.values.note) d["values note"] = r.values.note;
  }
  d.exemption = r.exempt;
  d.use = r.use;
  d.zoning = r.zoning;
  d["year built"] = r.yearBuilt;
  d.area = r.area ? areaText(r.area) : undefined;
  if (r.lastSale) {
    const s = r.lastSale;
    d["last sale"] = [s.date, s.price != null ? money(s.price) : undefined, s.reference].filter(Boolean).join(" · ") || undefined;
  }
  d.subdivision = r.subdivision;
  d.legal = r.legal;
  d["survey (as published)"] = r.plssText;
  d["data as of"] = r.asOf;
  d.source = adapterName;
  if (r.notes?.length) d.notes = r.notes.join("; ");
  d["authoritative record"] = r.link?.url;
  return d;
}

/** "T10N R3W, section 32 (Montana Meridian)". */
export function plssText(p: PlssDescription): string | undefined {
  const bits: string[] = [];
  // BLM labels a township "10N 3W": township 10 north, range 3 west.
  if (p.township) bits.push(`T${p.township.trim().replace(/\s+/, " R")}`);
  if (p.section) bits.push(`${(p.sectionType ?? "section").toLowerCase()} ${p.section}`);
  if (!bits.length) return undefined;
  return `${bits.join(", ")}${p.meridian ? ` (${p.meridian})` : ""}`;
}

/** The label a parcel feature carries: site address, else the parcel id. Never the owner. */
export function parcelName(r: ParcelRecord): string {
  return r.situs ?? r.propertyName ?? `Parcel ${r.parcelId}`;
}

export interface ParcelFeatureExtra {
  identify: ParcelIdentify;
  /** Which of identify.parcels this feature is. */
  index: number;
}

/** The selected parcel as a feature for the dossier: the parcel's outline (or the clicked point) and its record lines. */
export function parcelFeature(identify: ParcelIdentify, index = 0, adapterName = identify.adapter?.name ?? "parcel source"): LayerFeature {
  const hit: IdentifiedParcel | undefined = identify.parcels[index];
  const point: Point = { type: "Point", coordinates: [identify.point.lon, identify.point.lat] };
  // Stacked records can share a parcel id (three grand-list records on one Vermont SPAN): the index keeps them apart.
  const id = hit
    ? `parcel:${hit.record.adapter}:${hit.record.parcelId}${index > 0 ? `#${index + 1}` : ""}`
    : `parcel-at:${identify.point.lon.toFixed(5)},${identify.point.lat.toFixed(5)}`;
  const details: Record<string, string | undefined> = hit ? recordDetails(hit.record, adapterName) : {};
  if (!hit) {
    details["what is here"] = identify.notes.join(" ") || "no parcel record at this point";
    if (identify.adapter) details.source = identify.adapter.name;
  }
  if (identify.parcels.length > 1) details["records here"] = `${identify.parcels.length} (stacked or overlapping; this is ${index + 1} of ${identify.parcels.length})`;
  // NAD address points are listed by the dossier's parcel section (components/hud/ParcelAside.tsx).
  if (identify.plss) details["PLSS (BLM)"] = plssText(identify.plss);
  const extra: ParcelFeatureExtra = { identify, index };
  return {
    type: "Feature",
    geometry: hit?.geometry ?? point,
    properties: {
      id,
      layer: "parcels",
      name: hit ? parcelName(hit.record) : "No parcel record here",
      kind: hit ? "parcel" : "no-record",
      source: hit ? adapterName : identify.adapter?.name ?? "no keyless parcel source here",
      details,
      extra,
      anchor: [identify.point.lon, identify.point.lat],
    },
  };
}
