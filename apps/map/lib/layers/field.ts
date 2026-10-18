// Layer: construct field. One kind of construct tiled across the view, from
// one point of view, floating as a plate above the physical globe.
//
// Which kind emerges depends on the zoom: the hydrologic view is water regions
// from orbit and subwatersheds over a county; the civic view goes state,
// county, city (lib/fabric/fieldScale.ts). Each unit's heat then emerges from
// the physical layers underneath it, recomputed in the browser every few
// seconds (lib/fabric/emergence.ts, components/globe/EmergenceBridge.tsx), so
// the constructs world lights up where the physical twin is busy: aircraft
// over a district, gauges in a watershed, companies in a county.
//
// Source: /api/fabric?op=field (Census TIGERweb, USGS WBD, EPA ecoregions).

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { useSettings } from "@/lib/store/settings";
import { KINDS } from "@/lib/fabric/catalog";
import { clampFieldBbox, kindForScale, type BBox, type FieldPov } from "@/lib/fabric/fieldScale";
import type { ConstructExtra, ConstructNode } from "@/lib/fabric/types";

export interface FieldExtra extends ConstructExtra {
  /** Height of the plate the outlines float on, metres. */
  plate: number;
  /** Tallest skyline column, metres. */
  column: number;
  pov: FieldPov;
}

/** The view's bbox, or one estimated from the camera height when the horizon is in view. */
export function viewBbox(view: ViewState): BBox {
  if (view.bbox) return view.bbox;
  const span = Math.min(120, Math.max(0.5, (view.height / 111_320) * 1.6));
  return [view.lon - span / 2, Math.max(-85, view.lat - span / 3), view.lon + span / 2, Math.min(85, view.lat + span / 3)];
}

export function fieldKey(view: ViewState, pov: FieldPov): { kind: ReturnType<typeof kindForScale>; bbox: BBox } {
  const kind = kindForScale(pov, view.height);
  return { kind, bbox: clampFieldBbox(kind, viewBbox(view)) };
}

export function fieldFeatures(units: ConstructNode[], height: number, pov: FieldPov): LayerFeature<Point>[] {
  const plate = Math.min(80_000, Math.max(300, height * 0.03));
  const column = Math.min(400_000, Math.max(800, height * 0.12));
  return units
    .filter((u) => u.anchor)
    .map((u, i) => {
      const extra: FieldExtra = { node: u, alt: plate, tier: i, ground: u.anchor!, plate, column, pov };
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [u.anchor![0], u.anchor![1], plate] },
        properties: {
          id: u.id,
          layer: "field",
          name: u.name,
          kind: u.kind,
          source: u.source,
          details: {
            "point of view": u.domain,
            construct: KINDS[u.kind].label,
            code: u.code ?? null,
            [u.facts["area basis"] ? "area (computed)" : u.areaBasis === "total" ? "area (total)" : "area (land)"]: u.areaKm2 != null ? `${u.areaKm2.toLocaleString("en-US")} km²` : null,
          },
          extra,
        },
      };
    });
}

async function fetchField(ctx: FetchContext): Promise<FetchResult> {
  const pov = ((ctx.options.fieldPov as FieldPov | undefined) ?? "hydrologic") as FieldPov;
  const { kind, bbox } = fieldKey(ctx.view, pov);
  const env = await proxy<{ units: ConstructNode[]; truncated: boolean; kind: string }>(`/api/fabric?op=field&kind=${kind}&bbox=${bbox.join(",")}`, ctx);
  const features = fieldFeatures(env.data.units, ctx.view.height, pov);
  return {
    collection: { type: "FeatureCollection", features },
    source: env.data.units[0]?.source ?? "fabric",
    fetchedAt: Date.now(),
    note: `${KINDS[kind].label} · ${pov} view${env.data.truncated ? " · edge units may be missing" : ""}. Heat = physical signals loaded inside each.`,
    meta: { kind },
  };
}

export const fieldLayer: LayerDefinition = {
  id: "field",
  label: "Construct field",
  description:
    "One point of view's constructs tiled across the view and floated above the globe; the kind emerges from the zoom (water regions to subwatersheds, states to cities). Each one glows and rises with the physical signals loaded inside it.",
  color: "#22D3EE",
  updateIntervalMs: 24 * 3600_000,
  defaultEnabled: false,
  viewDependent: true,
  // The fetch key is the kind and the snapped bbox, so panning inside one grid cell costs nothing.
  viewKey: (view) => {
    const k = fieldKey(view, useSettings.getState().prefs.fieldPov ?? "hydrologic");
    const bucket = Math.round(Math.log2(Math.max(view.height, 1000) / 1000));
    return `${k.bbox.join(",")}:${bucket}`;
  },
  estimate: "Heat counts what is loaded on the globe now inside each outline; not a census of the ground.",
  attribution: "Census TIGERweb, USGS WBD, EPA ecoregions (public domain)",
  fetch: fetchField,
};
