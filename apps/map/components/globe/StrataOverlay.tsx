"use client";
// The constructs HUD's hands on the globe:
//
//  - Auto-tilt: when the stack opens under a top-down camera, tilt to an
//    oblique pitch so the strata read as layers, not a rosette of dots.
//  - Compare: pins A and B, the line between them, the smallest construct
//    both are inside (ghosted), and, when the focused construct differs at B,
//    B's counterpart outline in the signal colour, so "same county, different
//    congressional district" is visible on the ground.

import { useEffect, useRef } from "react";
import type * as CesiumNS from "cesium";
import { getCesium, getViewer } from "@/lib/globe/cesium";
import { getRenderer } from "@/lib/globe/registry";
import { tiltToOblique } from "@/lib/globe/strataCamera";
import { ICE, SIGNAL, groundRings } from "@/lib/globe/constructStyles";
import { compareFabrics } from "@/lib/fabric/compare";
import { densifyRing } from "@/lib/fabric/strata";
import { useStrata } from "@/lib/fabric/strataStore";
import { currentFabric, useAscend } from "@/lib/fabric/strataClient";
import { useGlobe } from "@/lib/store/globe";
import type { StyledLine } from "@/lib/globe/renderer";

export default function StrataOverlay() {
  useAutoTilt();
  return <CompareOverlay />;
}

/** Tilt once per opening of the stack, when it first lands under a camera looking straight down. */
function useAutoTilt() {
  const on = useGlobe((s) => s.layers.constructs);
  const fetchedAt = useGlobe((s) => s.status.constructs?.fetchedAt ?? 0);
  const done = useRef(false);
  useEffect(() => {
    if (!on) done.current = false;
  }, [on]);
  useEffect(() => {
    if (!on || !fetchedAt || done.current) return;
    // Decide only once the camera has come to rest (a link's opening flight
    // may still be descending); a stack that lands mid-flight is looked at
    // again on its next fetch.
    let before = useGlobe.getState().view;
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const check = () => {
      const { view, following } = useGlobe.getState();
      const still = Math.abs(view.height - before.height) < before.height * 0.01 && Math.abs(view.pitch - before.pitch) < 0.5;
      before = view;
      if (done.current) return;
      if (!still) {
        if (++tries < 15) t = setTimeout(check, 900);
        return;
      }
      if (view.height >= 2_500_000) return;
      done.current = true;
      if (following || useAscend.getState().active) return;
      if (view.pitch < -72) tiltToOblique(-52);
    };
    t = setTimeout(check, 900);
    return () => clearTimeout(t);
  }, [on, fetchedAt]);
}

function CompareOverlay() {
  const cmp = useStrata((s) => s.compare);
  const cmpFabric = useStrata((s) => s.compareFabric);
  const pin = useStrata((s) => s.pin);
  const selected = useGlobe((s) => s.selected);
  const fetchedAt = useGlobe((s) => s.status.constructs?.fetchedAt ?? 0);
  const on = useGlobe((s) => s.layers.constructs);

  useEffect(() => {
    const viewer = getViewer();
    if (!viewer || !on || !cmp) return;
    const C = getCesium();
    const scene = viewer.scene;
    const lines: CesiumNS.PolylineCollection = scene.primitives.add(new C.PolylineCollection());
    const points: CesiumNS.PointPrimitiveCollection = scene.primitives.add(new C.PointPrimitiveCollection());
    const labels: CesiumNS.LabelCollection = scene.primitives.add(new C.LabelCollection({ scene }));
    const fabric = currentFabric();
    const a = pin ?? (fabric ? { lon: fabric.point.lon, lat: fabric.point.lat } : null);
    const signal = C.Color.fromCssColorString(SIGNAL);
    const addLine = (l: StyledLine) => {
      const flat: number[] = [];
      for (const p of l.positions) flat.push(p[0], p[1], p[2]);
      const color = C.Color.fromCssColorString(l.color ?? SIGNAL).withAlpha(l.alpha ?? 0.8);
      lines.add({
        positions: C.Cartesian3.fromDegreesArrayHeights(flat),
        width: l.width ?? 1.5,
        material: l.dashed ? C.Material.fromType("PolylineDash", { color, dashLength: 14 }) : C.Material.fromType("Color", { color }),
      });
    };
    const font = `500 12px ${getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim() || "monospace"}, monospace`;
    // Each pin is named by the smallest place-like construct it sits in.
    const placeName = (f: typeof fabric) => f?.nodes.find((n) => n.kind === "place" || n.kind === "cdp")?.name ?? f?.nodes.find((n) => n.kind === "county")?.name ?? null;
    const aName = placeName(fabric);
    const bName = placeName(cmpFabric);
    const pinAt = (p: { lon: number; lat: number }, text: string) => {
      const pos = C.Cartesian3.fromDegrees(p.lon, p.lat, 0);
      points.add({ position: pos, pixelSize: 9, color: signal, outlineColor: C.Color.fromCssColorString("#020305"), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      labels.add({
        position: pos,
        text,
        font,
        fillColor: signal,
        outlineColor: C.Color.fromCssColorString("#020305").withAlpha(0.92),
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new C.Cartesian2(-12, 0),
        horizontalOrigin: C.HorizontalOrigin.RIGHT,
        verticalOrigin: C.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    };
    if (a) {
      pinAt(a, aName ? `A · ${aName}` : "A");
      // The span between the two places, on the ground.
      addLine({ positions: densifyRing([[a.lon, a.lat], [cmp.lon, cmp.lat]], 0.05).map((p) => [p[0], p[1], 80]), color: SIGNAL, alpha: 0.7, width: 1.4, dashed: true });
    }
    pinAt(cmp, bName ? `B · ${bName}` : "B");
    if (fabric && cmpFabric) {
      const c = compareFabrics(fabric, cmpFabric);
      if (c.meet?.rings) for (const l of groundRings(c.meet.rings, ICE, 0.5, 1.2, true)) addLine(l);
      const focusId = selected?.layer === "constructs" ? selected.id : null;
      const row = focusId ? c.rows.find((r) => r.a?.id === focusId) : null;
      if (row?.status === "differs" && row.b?.rings) for (const l of groundRings(row.b.rings, SIGNAL, 0.8, 1.8, true)) addLine(l);
    }
    // Pin A stands where "Here" is; the stack's own label steps aside.
    getRenderer("constructs")?.restyle(["here"]);
    scene.requestRender();
    return () => {
      if (viewer.isDestroyed()) return;
      for (const p of [lines, points, labels]) scene.primitives.remove(p);
      getRenderer("constructs")?.restyle(["here"]);
    };
  }, [cmp, cmpFabric, pin, selected, fetchedAt, on]);

  return null;
}
