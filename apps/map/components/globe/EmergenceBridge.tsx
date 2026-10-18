"use client";
// Keeps the construct field's vitals in step with the physical layers.
//
// Every few seconds (and at once when the field reloads or the measure
// changes) it joins every loaded physical feature into the field's units
// (lib/fabric/emergence.ts), publishes the vitals, and restyles only the
// units whose vitals changed, so a plane crossing into a district or a new
// batch of gauges lights the construct above it without redrawing the rest.
// With the streamflow measure it also fetches the day's flow percentiles for
// gauges it has not seen, and recomputes when they land.

import { useEffect } from "react";
import { useGlobe } from "@/lib/store/globe";
import { useSettings } from "@/lib/store/settings";
import { allRenderers, getRenderer } from "@/lib/globe/registry";
import { computeVitals, vitalsKey, type Vitals } from "@/lib/fabric/emergence";
import { setVitals, vitalsFor } from "@/lib/fabric/emergenceState";
import { conditionOf, ensureNormals } from "@/lib/fabric/normalsClient";
import type { LayerFeature } from "@/lib/layers/types";
import type { ConstructExtra, ConstructNode } from "@/lib/fabric/types";

const EVERY_MS = 4000;

function recompute() {
  const r = getRenderer("field");
  if (!r || !r.show || r.size === 0) return;
  const nodes: ConstructNode[] = [];
  for (const f of r.features()) {
    const n = (f.properties.extra as ConstructExtra | undefined)?.node;
    if (n) nodes.push(n);
  }
  const physical: LayerFeature[] = [];
  for (const other of allRenderers()) {
    if (!other.show || other.layer === "field" || other.layer === "constructs") continue;
    for (const f of other.features()) physical.push(f);
  }
  const { fieldMeasure, fieldNormalise } = useSettings.getState().prefs;
  const measure = fieldMeasure ?? "all";
  if (measure === "streamflow")
    void ensureNormals(physical).then((got) => {
      if (got) recompute();
    });
  const next = computeVitals(nodes, physical, measure, fieldNormalise ?? "density", conditionOf);
  const changed: string[] = [];
  const differs = (a: Vitals | undefined, b: Vitals | undefined) =>
    !a || !b || a.value !== b.value || a.display !== b.display || a.color !== b.color || Math.abs(a.heat - b.heat) > 0.02 || (a.rank < 6) !== (b.rank < 6);
  for (const [id, v] of next) if (differs(vitalsFor(id), v)) changed.push(id);
  if (setVitals(next, vitalsKey(next), Date.now()) || changed.length) r.restyle(changed);
}

export default function EmergenceBridge() {
  const on = useGlobe((s) => s.layers.field);
  const fetchedAt = useGlobe((s) => s.status.field?.fetchedAt);
  const measure = useSettings((s) => s.prefs.fieldMeasure);
  const normalise = useSettings((s) => s.prefs.fieldNormalise);

  useEffect(() => {
    if (!on) return;
    // A tick after the renderer has taken the new collection.
    const first = setTimeout(recompute, 300);
    const id = setInterval(recompute, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [on, fetchedAt, measure, normalise]);

  return null;
}
