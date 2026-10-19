"use client";
// Draws the downstream trace on the globe: a glowing path from the point
// through the centroid of every HUC-12 the water passes, an arrow into the
// terminal, and, once they arrive, the outlines of those subwatersheds on the
// ground. The path joins centroids of generalised outlines; it shows the
// order the water takes through the watersheds, not the river's line.

import { useEffect } from "react";
import { useTrace } from "@/lib/fabric/traceStore";
import { getCesium, getViewer } from "@/lib/globe/cesium";
import type * as CesiumNS from "cesium";

const PATH_ALT = 600;

export default function TraceOverlay() {
  const steps = useTrace((s) => s.steps);
  const centroids = useTrace((s) => s.centroids);
  const point = useTrace((s) => s.point);
  const outlines = useTrace((s) => s.outlines);

  useEffect(() => {
    const viewer = getViewer();
    if (!viewer || !point || !steps.length) return;
    const C = getCesium();
    const lines: CesiumNS.PolylineCollection = viewer.scene.primitives.add(new C.PolylineCollection());
    // The path grows as legs and outline batches arrive; it stops at the first unit without a centroid yet.
    const pts: number[] = [point.lon, point.lat, PATH_ALT];
    for (const s of steps) {
      const c = centroids[s.huc12];
      if (!c) break;
      pts.push(c[0], c[1], PATH_ALT);
    }
    if (pts.length >= 6) {
      lines.add({
        positions: C.Cartesian3.fromDegreesArrayHeights(pts),
        width: 7,
        material: C.Material.fromType("PolylineGlow", { color: C.Color.fromCssColorString("#38BDF8").withAlpha(0.95), glowPower: 0.25 }),
      });
      const n = pts.length;
      if (n >= 6)
        lines.add({
          positions: C.Cartesian3.fromDegreesArrayHeights(pts.slice(n - 6)),
          width: 16,
          material: C.Material.fromType("PolylineArrow", { color: C.Color.fromCssColorString("#E0F2FE") }),
        });
    }
    {
      const edge = C.Color.fromCssColorString("#38BDF8").withAlpha(0.55);
      for (const rings of Object.values(outlines))
        for (const ring of rings) {
          const flat: number[] = [];
          for (const p of ring) flat.push(p[0], p[1], 40);
          lines.add({ positions: C.Cartesian3.fromDegreesArrayHeights(flat), width: 1.4, material: C.Material.fromType("Color", { color: edge }) });
        }
    }
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(lines);
    };
  }, [steps, centroids, point, outlines]);

  return null;
}
