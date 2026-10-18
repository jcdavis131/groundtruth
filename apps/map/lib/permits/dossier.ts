// Permit, licence and environmental-permit records as globe features, for the
// three layers and their dossiers. Pure, so what is shown and what the
// palette may search are tested without a globe.
//
// Searchable (lib/search/allowlist.ts): a feature's name (a permit number and
// its type; a trade name; a permit or action number), "permit number",
// "licence number", "licence type" and "permit id". Never searchable: the
// address, the contractor company, a facility or project name, a licensee.

import type { LayerFeature } from "@/lib/layers/types";
import type { PermitCityId, PermitRecord } from "./features";
import { PERMIT_CITIES } from "./features";
import type { LicenceRecord } from "./licences";
import { LICENCE_SOURCES } from "./licences";
import type { EnvRecord } from "./environmental";
import { ENV_LABEL } from "./environmental";
import type { RecordFeature } from "./geojson";

type Details = NonNullable<LayerFeature["properties"]["details"]>;

const usd = (n: number | undefined) => (n == null ? undefined : `$${Math.round(n).toLocaleString("en-US")}`);

function dateMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(`${iso}T12:00:00Z`);
  return Number.isFinite(t) ? t : undefined;
}

/** A colour family from the city's own permit words; the words themselves are in the dossier. */
export type PermitFamily = "new" | "demolition" | "alteration" | "trades" | "other";

export function permitFamily(kind: string | undefined, work: string | undefined): PermitFamily {
  const w = `${kind ?? ""} ${work ?? ""}`.toLowerCase();
  if (/demoli|wreck/.test(w)) return "demolition";
  if (/\bnew\b|new construction|erect/.test(w)) return "new";
  if (/electr|plumb|mechan|hvac|sprinkl|boiler|elevator|fire|solar|sign\b|low voltage/.test(w)) return "trades";
  if (/alter|remodel|repair|renovat|addition|tenant|interior|roof|express|otc|easy|scaffold|fence|shed/.test(w)) return "alteration";
  return "other";
}

export function permitFeature(f: RecordFeature<PermitRecord>): LayerFeature {
  const r = f.properties;
  const city = PERMIT_CITIES[r.city as PermitCityId];
  const d: Details = {
    "permit number": r.number,
    type: r.kind,
    work: r.work,
    description: r.description,
    status: r.status,
    issued: r.issued,
    applied: r.applied,
    finaled: r.finaled,
    expires: r.expires,
  };
  if (r.valuation != null) d[r.valuationLabel ?? "valuation"] = usd(r.valuation);
  d.fee = usd(r.fee);
  d.address = r.address;
  d[r.parcel ? `parcel (${r.parcel.scheme === "blocklot" ? "block/lot" : r.parcel.scheme.toUpperCase()})` : "parcel"] = r.parcel?.id;
  d["zoning printed on the permit"] = r.zoning;
  d["contractor (as published)"] = r.contractorCompany;
  for (const [k, v] of Object.entries(r.published)) d[k] = v;
  d["city record"] = r.url;
  d.city = city?.name;
  d.publisher = city?.publisher;
  const family = permitFamily(r.kind, r.work);
  return {
    type: "Feature",
    geometry: f.geometry,
    properties: {
      id: r.id,
      layer: "permits",
      name: `${r.number} · ${r.work ?? r.kind ?? "permit"}`,
      kind: family,
      source: `${city?.publisher ?? r.city} building permits`,
      observedAt: dateMs(r.issued),
      details: d,
      extra: { city: r.city, family, valuation: r.valuation },
    },
  };
}

export function licenceFeature(f: RecordFeature<LicenceRecord>): LayerFeature {
  const r = f.properties;
  const src = LICENCE_SOURCES[r.source];
  const d: Details = {
    "licence number": r.number,
    "licence type": r.category,
    activity: r.activity,
    name: r.name ? undefined : r.nameNote,
    status: r.status,
    issued: r.issued,
    "at this location since": r.started,
    expires: r.expires,
    address: r.address,
  };
  for (const [k, v] of Object.entries(r.published)) d[k] = v;
  d.registry = src?.name;
  d.publisher = src?.publisher;
  return {
    type: "Feature",
    geometry: f.geometry,
    properties: {
      id: r.id,
      layer: "licences",
      name: r.name ?? `${r.category ?? "Licensed premises"} (name not shown)`,
      kind: r.source,
      source: src?.publisher ?? r.source,
      observedAt: dateMs(r.issued ?? r.started),
      details: d,
      extra: { source: r.source },
    },
  };
}

export function envFeature(f: RecordFeature<EnvRecord>): LayerFeature {
  const r = f.properties;
  const d: Details = {
    "permit id": r.number,
    type: r.type,
    [r.program === "usace" ? "project (as the Corps publishes it)" : "facility (as EPA publishes it)"]: r.facility ?? r.facilityNote,
    status: r.status,
    compliance: r.compliance,
  };
  if (r.date) d[r.dateLabel ?? "date"] = r.date;
  d.address = r.address;
  for (const [k, v] of Object.entries(r.published)) d[k] = v;
  d.record = r.url;
  d.program = r.program === "npdes" ? "Clean Water Act (NPDES), EPA ECHO" : r.program === "air" ? "Clean Air Act, EPA ECHO" : "U.S. Army Corps of Engineers regulatory program (ORM)";
  return {
    type: "Feature",
    geometry: f.geometry,
    properties: {
      id: r.id,
      layer: "envpermits",
      name: r.program === "usace" ? `${r.number} · ${r.type ?? "Corps action"}` : `${ENV_LABEL[r.program]} ${r.number}`,
      kind: r.program,
      source: r.program === "usace" ? "USACE ORM" : "EPA ECHO",
      observedAt: dateMs(r.date),
      details: d,
      extra: { program: r.program, compliance: r.compliance },
    },
  };
}
