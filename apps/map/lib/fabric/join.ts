// The location join: which features fall inside a construct's outline.
// Pure, so the HUD and the tests share it.

import type { LayerFeature, LayerId } from "@/lib/layers/types";
import { bboxContains, ringsBbox, ringsContain } from "./geo";

/** A feature's point: its Point geometry, else its published anchor. */
export function pointOf(f: LayerFeature): [number, number] | null {
  if (f.geometry.type === "Point") return [f.geometry.coordinates[0], f.geometry.coordinates[1]];
  return f.properties.anchor ?? null;
}

/**
 * How many observations a feature stands for. A zoomed-out view of the
 * fires layer is binned (more than 5,000 hotspots in view): each point is
 * one cell carrying the detections it stands for in `extra.count`, and a
 * count must add those, not the cells. Every other feature is one.
 */
export function standsFor(f: LayerFeature): number {
  if (f.properties.layer !== "fires") return 1;
  const n = (f.properties.extra as { count?: unknown } | undefined)?.count;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? n : 1;
}

/** The observations a list of features stands for (see standsFor). */
export function countOf(list: readonly LayerFeature[]): number {
  let n = 0;
  for (const f of list) n += standsFor(f);
  return n;
}

const CONSTRUCT_LAYERS = new Set<LayerId>(["constructs", "field", "alerts"]);

/** Features inside `rings`, grouped by layer; constructs (the stack, the field, live warnings) and simulated features are skipped. */
export function joinInside(rings: number[][][], features: Iterable<LayerFeature>): Map<LayerId, LayerFeature[]> {
  const out = new Map<LayerId, LayerFeature[]>();
  const box = ringsBbox(rings);
  if (!box) return out;
  for (const f of features) {
    if (CONSTRUCT_LAYERS.has(f.properties.layer) || f.properties.simulated) continue;
    const p = pointOf(f);
    if (!p || !bboxContains(box, p[0], p[1]) || !ringsContain(rings, p[0], p[1])) continue;
    const list = out.get(f.properties.layer) ?? [];
    list.push(f);
    out.set(f.properties.layer, list);
  }
  return out;
}
