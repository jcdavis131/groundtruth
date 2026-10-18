"use client";
// Draws the NLDI traces (lib/water/nldiStore.ts) on the globe: the main stem
// downstream as a bright line, the drainage basin as a translucent fill with
// its edge, and the USGS gauges upstream as points. A gauge the Surface water
// layer already draws is left to it, so each gauge is drawn once.

import { useEffect } from "react";
import type * as CesiumNS from "cesium";
import { useNldi, gaugesToDraw } from "@/lib/water/nldiStore";
import { getCesium, getViewer } from "@/lib/globe/cesium";
import { getRenderer } from "@/lib/globe/registry";

const LINE_ALT = 400;

function rings(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][][] {
  return g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
}

export default function NldiOverlay() {
  const down = useNldi((s) => s.down.data);
  const basin = useNldi((s) => s.basin.data);
  const gauges = useNldi((s) => s.gauges.data);

  useEffect(() => {
    const viewer = getViewer();
    if (!viewer || (!down && !basin && !gauges)) return;
    const C = getCesium();
    const lines: CesiumNS.PolylineCollection = viewer.scene.primitives.add(new C.PolylineCollection());
    const points: CesiumNS.PointPrimitiveCollection = viewer.scene.primitives.add(new C.PointPrimitiveCollection());
    const fills: CesiumNS.Entity[] = [];
    if (basin) {
      const edge = C.Color.fromCssColorString("#7DD3FC").withAlpha(0.9);
      for (const ring of rings(basin)) {
        const flat: number[] = [];
        for (const p of ring) flat.push(p[0], p[1], 60);
        lines.add({ positions: C.Cartesian3.fromDegreesArrayHeights(flat), width: 2, material: C.Material.fromType("Color", { color: edge }) });
        fills.push(
          viewer.entities.add({
            polygon: { hierarchy: C.Cartesian3.fromDegreesArray(ring.flatMap((p) => [p[0], p[1]])), material: C.Color.fromCssColorString("#38BDF8").withAlpha(0.14), classificationType: C.ClassificationType.TERRAIN },
          }),
        );
      }
    }
    if (down) {
      for (const l of down.coordinates) {
        if (l.length < 2) continue;
        lines.add({
          positions: C.Cartesian3.fromDegreesArrayHeights(l.flatMap((p) => [p[0], p[1], LINE_ALT])),
          width: 6,
          material: C.Material.fromType("PolylineGlow", { color: C.Color.fromCssColorString("#22D3EE").withAlpha(0.95), glowPower: 0.25 }),
        });
      }
    }
    if (gauges) {
      const drawn = getRenderer("water");
      const ids = drawn ? [...drawn.features()].map((f) => f.properties.id) : [];
      for (const g of gaugesToDraw(gauges, ids)) {
        points.add({
          position: C.Cartesian3.fromDegrees(g.lon, g.lat, 0),
          pixelSize: 8,
          color: C.Color.fromCssColorString("#F0ABFC"),
          outlineColor: C.Color.BLACK.withAlpha(0.85),
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }
    viewer.scene.requestRender();
    return () => {
      if (viewer.isDestroyed()) return;
      viewer.scene.primitives.remove(lines);
      viewer.scene.primitives.remove(points);
      for (const e of fills) viewer.entities.remove(e);
      viewer.scene.requestRender();
    };
  }, [down, basin, gauges]);

  return null;
}
