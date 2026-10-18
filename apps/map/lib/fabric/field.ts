// The construct field: one kind of construct tiled across the view.
//
// The stack (graph.ts) answers "what is this point inside?". The field
// answers "how is this whole view divided, from one point of view?". The
// kind emerges from the zoom: from orbit the hydrologic view is water regions
// (HUC-2), at a county it is subwatersheds (HUC-12); the civic view goes state,
// county, city. Each unit's state then emerges from the physical layers below
// it (lib/fabric/emergence.ts).
//
// This file is the parser; the scale ladder and bbox rules are in
// fieldScale.ts (re-exported here) and the fetch is in fetch.ts.

import { stateByFips } from "@/lib/places/registry";
import { KINDS } from "./catalog";
import { ringsArea, ringCentroid, roundRings } from "./geo";
import type { ConstructKind, ConstructNode } from "./types";
import type { IdentifyResponse } from "./parse";
import { FIELD_SPECS } from "./fieldScale";

export * from "./fieldScale";

export interface ArcQueryResponse {
  features?: Array<{ attributes?: Record<string, string | number | null>; geometry?: { rings?: number[][][] } | null }>;
  exceededTransferLimit?: boolean;
  error?: { message?: string };
}

function lower(a: Record<string, string | number | null> | undefined): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(a ?? {})) out[k.toLowerCase()] = v;
  return out;
}

const s = (v: unknown): string | undefined => (v == null || String(v).trim() === "" ? undefined : String(v).trim());
const n = (v: unknown): number | undefined => {
  if (v == null || v === "") return undefined;
  const x = typeof v === "number" ? v : Number(String(v).replace(/^\+/, ""));
  return Number.isFinite(x) ? x : undefined;
};

/** One field unit per upstream feature; a unit the upstream sent without a code or name is dropped. */
export function parseField(kind: ConstructKind, res: ArcQueryResponse | IdentifyResponse): ConstructNode[] {
  const spec = FIELD_SPECS[kind];
  if (!spec) return [];
  const rows = "features" in res ? (res.features ?? []) : ((res as IdentifyResponse).results ?? []);
  const out: ConstructNode[] = [];
  const seen = new Set<string>();
  for (const f of rows) {
    const a = lower(f.attributes ?? undefined);
    let code: string | undefined;
    let name: string | undefined;
    let areaKm2: number | undefined;
    let areaBasis: ConstructNode["areaBasis"];
    let anchor: [number, number] | undefined;
    if (spec.service === "tiger") {
      code = s(a.geoid);
      name = s(a.name) ?? s(a.basename);
      const land = n(a.arealand);
      if (land != null) {
        areaKm2 = Math.round((land / 1e6) * 100) / 100;
        areaBasis = "land";
      }
      const lat = n(a.intptlat);
      const lon = n(a.intptlon);
      if (lat != null && lon != null) anchor = [lon, lat];
      const st = code ? stateByFips(code.slice(0, 2)) : null;
      if (kind === "cd" && st) name = `${st.usps}-${(s(a.basename) ?? "").padStart(2, "0")}`;
      else if (kind === "county" && st && name) name = `${name}, ${st.usps}`;
      else if (kind === "zcta") name = s(a.basename) ?? code;
    } else if (spec.service === "wbd") {
      code = s(a[kind]);
      name = s(a.name);
      areaKm2 = n(a.areasqkm);
      if (areaKm2 != null) areaBasis = "total";
    } else {
      code = kind === "eco4" ? s(a.us_l4code) : s(a.us_l3code);
      name = kind === "eco4" ? s(a.us_l4name) : s(a.us_l3name);
    }
    if (!code || !name) continue;
    const id = `${kind}:${code}`;
    const rings = f.geometry?.rings?.length ? roundRings(f.geometry.rings) : undefined;
    // Ecoregions answer one row per polygon part; keep the first part's attributes and merge the rings.
    if (seen.has(id)) {
      const prev = out.find((x) => x.id === id);
      if (prev && rings) prev.rings = [...(prev.rings ?? []), ...rings];
      continue;
    }
    seen.add(id);
    out.push({
      id,
      kind,
      domain: KINDS[kind].domain,
      name,
      code,
      areaKm2,
      areaBasis,
      anchor: anchor ?? (rings ? (ringCentroid(rings) ?? undefined) : undefined),
      rings: rings?.length ? rings : undefined,
      facts: {},
      links: [],
      source: spec.service === "tiger" ? "census-tigerweb" : spec.service === "wbd" ? "usgs-wbd" : "epa-ecoregions",
    });
  }
  // Area the upstream did not publish is computed from the outline and says so.
  for (const u of out)
    if (u.areaKm2 == null && u.rings) {
      u.areaKm2 = Math.round(ringsArea(u.rings) * 10) / 10;
      u.facts["area basis"] = "computed from the generalised outline";
    }
  return out;
}
