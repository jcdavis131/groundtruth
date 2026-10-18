// Keeps the feature objects of static, view-dependent layers stable across
// fetches. A new view key is a new query, so every feature arrives as a new
// object, and LayerRenderer.update rebuilds any feature whose object changed:
// its GroundPrimitive is destroyed and rebuilt asynchronously, so zones that
// never left the view blink. Handing back the object already drawn for an id
// lets the renderer skip it (renderer.ts, "Layers that memoise static
// features"), so only features new to the view are built.
//
// A held object is reused only while the new one has the same geometry
// signature (type, part count, vertices in the first ring): a unit whose far
// parts were trimmed to another box comes back different and is redrawn.
// Only for datasets whose attributes do not change between fetches of the
// same id: the land layers (maps that change over months, cached a day on
// the server).

import type { Geometry } from "geojson";
import type { LayerFeature } from "./types";

/** Cheap fingerprint of a geometry's shape; equal for the same polygon at the same generalisation. */
export function geometrySignature(g: Geometry): string {
  switch (g.type) {
    case "Polygon":
      return `P${g.coordinates.length}:${g.coordinates[0]?.length ?? 0}`;
    case "MultiPolygon":
      return `M${g.coordinates.length}:${g.coordinates[0]?.[0]?.length ?? 0}:${g.coordinates[g.coordinates.length - 1]?.[0]?.length ?? 0}`;
    case "LineString":
      return `L${g.coordinates.length}`;
    case "MultiLineString":
      return `ML${g.coordinates.length}:${g.coordinates[0]?.length ?? 0}`;
    default:
      return g.type;
  }
}

export class FeatureMemo {
  private readonly held = new Map<string, { f: LayerFeature; sig: string }>();
  private readonly max: number;

  /** `max`: ids held at most; the least recently seen go first. */
  constructor(max = 5000) {
    this.max = max;
  }

  /** The held object for each id where it has the same geometry, otherwise the new feature (held from now on). */
  stable(features: LayerFeature[]): LayerFeature[] {
    const out = features.map((f) => {
      const id = f.properties.id;
      const sig = geometrySignature(f.geometry);
      const cur = this.held.get(id);
      const keep = cur && cur.sig === sig ? cur : { f, sig };
      // Re-insert so the map runs from least to most recently seen.
      this.held.delete(id);
      this.held.set(id, keep);
      return keep.f;
    });
    for (const id of this.held.keys()) {
      if (this.held.size <= this.max) break;
      this.held.delete(id);
    }
    return out;
  }

  get size(): number {
    return this.held.size;
  }
}
