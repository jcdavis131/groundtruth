"use client";
// The field's legend wired to the live vitals: FieldControls shows it in the
// Layers panel, FieldLegendHud on the desktop globe while the field is on.

import { useMemo, useSyncExternalStore } from "react";
import { useGlobe } from "@/lib/store/globe";
import { useSettings } from "@/lib/store/settings";
import { legendFor } from "@/lib/fabric/legend";
import { getVitals, subscribeVitals, unitName } from "@/lib/fabric/emergenceState";
import FieldLegend from "./FieldLegend";

export default function FieldLegendLive() {
  const vitals = useSyncExternalStore(subscribeVitals, getVitals, getVitals);
  const measure = useSettings((s) => s.prefs.fieldMeasure) ?? "all";
  const normalise = useSettings((s) => s.prefs.fieldNormalise) ?? "density";
  // Vitals are recomputed by the bridge on its own clock; the legend follows the map it is given.
  const legend = useMemo(() => legendFor(vitals, measure, normalise, unitName), [vitals, measure, normalise]);
  return <FieldLegend legend={legend} />;
}

/** The legend on the desktop globe, shown while the field is on. */
export function FieldLegendHud() {
  const on = useGlobe((s) => s.layers.field);
  if (!on) return null;
  return (
    <div data-hud-occluder className="hud-panel pointer-events-none absolute bottom-16 left-3 z-30 w-[240px] max-w-[calc(100vw-24px)] p-2">
      <FieldLegendLive />
    </div>
  );
}
