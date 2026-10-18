"use client";
// Draws the upstream catchment on the globe: the outline of every whole WBD
// unit in its cover, heavier for bigger units, and the gauges read inside it
// as dots in their flow-class colours (a ring for one in flood). Together
// with the downstream trace it shows both halves of the water through a
// point: what drains to it, and where it goes.

import { useEffect } from "react";
import { useUpstream } from "@/lib/fabric/upstreamStore";
import { FLOW_CLASSES } from "@/lib/fabric/condition";
import { getCesium, getViewer } from "@/lib/globe/cesium";
import type * as CesiumNS from "cesium";

const EDGE = "#A78BFA";
const WIDTH: Record<number, number> = { 2: 3, 4: 2.4, 6: 2, 8: 1.6, 10: 1.3, 12: 1.1 };

export default function UpstreamOverlay() {
  const outlines = useUpstream((s) => s.outlines);
  const cover = useUpstream((s) => s.cover);
  const gauges = useUpstream((s) => s.gauges);
  const point = useUpstream((s) => s.point);

  useEffect(() => {
    const viewer = getViewer();
    if (!viewer || !point || !cover.length) return;
    const C = getCesium();
    const lines: CesiumNS.PolylineCollection = viewer.scene.primitives.add(new C.PolylineCollection());
    const dots: CesiumNS.PointPrimitiveCollection = viewer.scene.primitives.add(new C.PointPrimitiveCollection());
    const level = new Map(cover.map((u) => [u.code, u.level]));
    for (const [code, rings] of Object.entries(outlines)) {
      const l = level.get(code) ?? 12;
      const color = C.Color.fromCssColorString(EDGE).withAlpha(l <= 6 ? 0.8 : 0.55);
      for (const ring of rings) {
        const flat: number[] = [];
        for (const p of ring) flat.push(p[0], p[1], 60);
        lines.add({ positions: C.Cartesian3.fromDegreesArrayHeights(flat), width: WIDTH[l] ?? 1.2, material: C.Material.fromType("Color", { color }) });
      }
    }
    for (const g of gauges) {
      const color = C.Color.fromCssColorString(g.cls ? FLOW_CLASSES[g.cls].color : "#94A3B8");
      dots.add({
        position: C.Cartesian3.fromDegrees(g.lon, g.lat, 80),
        pixelSize: g.flood ? 11 : 7,
        color,
        outlineColor: g.flood ? C.Color.fromCssColorString("#F43F5E") : C.Color.BLACK.withAlpha(0.6),
        outlineWidth: g.flood ? 3 : 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    viewer.scene.requestRender();
    return () => {
      if (viewer.isDestroyed()) return;
      viewer.scene.primitives.remove(lines);
      viewer.scene.primitives.remove(dots);
    };
  }, [outlines, cover, gauges, point]);

  return null;
}
