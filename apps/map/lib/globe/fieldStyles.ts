"use client";
// How the construct field is drawn. Every unit floats as an outline on a
// plate above the globe; a column of light rises from its internal point, as
// tall as the physical signals inside it are dense; a faint wash on the ground
// carries the same heat. All three read the live vitals (emergenceState), and
// the emergence bridge restyles only the units whose vitals changed.

import type { LayerFeature } from "@/lib/layers/types";
import type { LayerStyle, LonLatAlt, StyledLine, StyledPolygon } from "./renderer";
import { heatColor } from "@/lib/fabric/emergence";
import { vitalsFor } from "@/lib/fabric/emergenceState";
import type { FieldExtra } from "@/lib/layers/field";
import { SIGNAL } from "./constructStyles";

function extraOf(f: LayerFeature): FieldExtra | undefined {
  return f.properties.extra as FieldExtra | undefined;
}

function heatOf(f: LayerFeature): number {
  return vitalsFor(f.properties.id)?.heat ?? 0;
}

/** The flow class colour under the streamflow measure, else the heat ramp. */
function colorOf(f: LayerFeature): string {
  const v = vitalsFor(f.properties.id);
  return v?.color ?? heatColor(v?.heat ?? 0);
}

export const fieldStyle: LayerStyle = {
  color: "#22D3EE",
  pointSize: (f) => 4 + heatOf(f) * 7,
  colorFor: colorOf,
  label: (f) => {
    const v = vitalsFor(f.properties.id);
    return v?.display ? `${f.properties.name} · ${v.display}` : f.properties.name;
  },
  labelMax: 0,
  labelAlways: (f) => {
    const v = vitalsFor(f.properties.id);
    return !!v && !!v.display && v.value > 0 && v.rank < 6;
  },
  // The node sits on top of its column.
  position: (f) => {
    const x = extraOf(f);
    if (!x) return null;
    return [x.ground[0], x.ground[1], x.plate + x.column * heatOf(f)];
  },
  tickMs: 1000,
  lines: (f) => {
    const x = extraOf(f);
    if (!x?.node?.rings) return null;
    const h = heatOf(f);
    const color = colorOf(f);
    // A rated unit sitting at normal still shows its class colour, faintly.
    const floor = vitalsFor(f.properties.id)?.condition?.rated ? 0.35 : 0.18;
    const out: StyledLine[] = x.node.rings.map((ring) => ({
      positions: ring.map((p) => [p[0], p[1], x.plate] as LonLatAlt),
      color,
      alpha: floor + 0.6 * h,
      width: 1 + 1.5 * h,
    }));
    if (h > 0) out.push({ positions: [[x.ground[0], x.ground[1], x.plate], [x.ground[0], x.ground[1], x.plate + x.column * h]], color, alpha: 0.85, width: 3 + 5 * h, glow: true });
    return out;
  },
  polygons: (f) => {
    const x = extraOf(f);
    const h = heatOf(f);
    const rated = !!vitalsFor(f.properties.id)?.condition?.rated;
    if (!x?.node?.rings || (h <= 0 && !rated)) return null;
    return [{ rings: x.node.rings, color: colorOf(f), alpha: (rated ? 0.08 : 0.05) + 0.25 * h } satisfies StyledPolygon];
  },
  selectedLines: (f) => {
    const x = extraOf(f);
    if (!x?.node?.rings) return null;
    const out: StyledLine[] = [];
    for (const ring of x.node.rings) {
      out.push({ positions: ring.map((p) => [p[0], p[1], x.plate] as LonLatAlt), color: "#FFFFFF", alpha: 0.95, width: 2.6 });
      out.push({ positions: ring.map((p) => [p[0], p[1], 30] as LonLatAlt), color: SIGNAL, alpha: 0.8, width: 1.4, dashed: true });
    }
    return out;
  },
  scaleByDistance: [2e4, 1.0, 2e7, 0.45],
};
