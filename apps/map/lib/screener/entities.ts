// Pure builders for the entity sets the screener ranks: the same feature
// shapes the globe layers use (lib/economy/features.ts), minus polygons for
// counties and states so a nationwide set is a few hundred kilobytes.
// The route hands these the upstream tables; nothing here fetches.

import type { Point } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import type { AreaExtra, AreaJoins, AreaLevel } from "@/lib/economy/features";
import type { Provenance } from "@/lib/provenance/types";
import { provenance } from "@/lib/provenance/types";
import { source, type SourceId } from "@/lib/provenance/sources";
import { fieldsFor, type EntityKind } from "./fields";

export interface AreaPointIn {
  geoid: string;
  name: string;
  stusab?: string;
  lon: number;
  lat: number;
}

/**
 * Counties or states as point features carrying the QCEW / Zillow joins,
 * same ids and `extra` as buildAreas() so a row can select the polygon on
 * the globe when that layer is loaded. Areas with neither jobs nor a home
 * value are left out, as on the globe.
 */
export function buildAreaPoints(points: AreaPointIn[], level: AreaLevel, joins: AreaJoins): LayerFeature<Point>[] {
  const out: LayerFeature<Point>[] = [];
  for (const p of points) {
    const jobs = joins.jobs.get(p.geoid);
    const home = joins.home.get(p.geoid);
    const rent = joins.rent.get(p.geoid);
    if (!jobs && !home) continue;
    // stateNames is keyed by the two-digit state FIPS; a county's prefix is its state.
    const stateName = joins.stateNames?.get(level === "county" ? p.geoid.slice(0, 2) : p.geoid) ?? (level === "state" ? p.name : undefined);
    const extra: AreaExtra = { geoid: p.geoid, level, name: p.name, stusab: p.stusab, stateName, metro: home?.metro, jobs, home, rent };
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat, 0] },
      properties: {
        id: `${level}:${p.geoid}`,
        layer: "realestate",
        name: level === "state" || !p.stusab ? p.name : `${p.name}, ${p.stusab}`,
        kind: level,
        source: "Census TIGERweb",
        anchor: [p.lon, p.lat],
        extra,
      },
    });
  }
  return out;
}

export interface ProvenanceInputs {
  retrievedAt: string;
  /** Period or as-of per source id, e.g. { "bls-qcew": "2026 Q1", "zillow-zhvi": "2026-07-31" }. */
  periods?: Partial<Record<SourceId, string>>;
  /** Source ids that did not answer; they are listed with a caveat, not dropped silently. */
  failed?: SourceId[];
}

/**
 * One provenance record per distinct source the registry for `kind` reads,
 * plus an "estimate" record per derived field naming its method, so a CSV
 * footer or an API consumer can cite every column.
 */
export function screenProvenance(kind: EntityKind, inputs: ProvenanceInputs): Provenance[] {
  const out: Provenance[] = [];
  const seen = new Set<SourceId>();
  for (const f of fieldsFor(kind)) {
    if (f.kind === "estimate") {
      out.push(provenance(source(f.source), { kind: "estimate", method: `${f.key}: ${f.method ?? "computed from published values"}`, retrievedAt: inputs.retrievedAt }));
      continue;
    }
    if (seen.has(f.source)) continue;
    seen.add(f.source);
    const failed = inputs.failed?.includes(f.source);
    out.push(
      provenance(source(f.source), {
        kind: "published",
        period: inputs.periods?.[f.source],
        retrievedAt: inputs.retrievedAt,
        notes: failed ? ["did not answer; its fields are empty in this response"] : undefined,
      }),
    );
  }
  return out;
}
