"use client";
// Controls for the construct field: which point of view tiles the view, which
// physical signals light it, and whether big units are allowed to win by size.
// Shown under the field's row in the Layers panel while it is on.

import { useGlobe } from "@/lib/store/globe";
import { useSettings } from "@/lib/store/settings";
import { LAYERS } from "@/lib/layers";
import { DOMAINS, KINDS } from "@/lib/fabric/catalog";
import { FIELD_POVS, kindForScale, type FieldPov } from "@/lib/fabric/fieldScale";
import type { Measure } from "@/lib/fabric/emergence";
import { FLOW_CLASSES, FLOW_CLASS_ORDER } from "@/lib/fabric/condition";
import { GAUGE_MAX_HEIGHT_M } from "@/lib/layers/water";

// Not measures: layers whose points are not physical (lib/fabric/emergence.ts isPhysical) and area-only layers.
const NOT_MEASURES = new Set(["constructs", "field", "occupations", "weather", "commerce", "realestate", "spending", "traffic", "hazards", "flood", "wetlands", "publiclands", "relief", "slope", "contours", "soils", "firehazard", "landcover", "sealevel", "transmission", "pipelines", "rail", "faults", "geology", "plss", "events", "parcels", "zoning", "permits", "licences", "envpermits", "historic", "crithab", "contaminants", "wayback", "topo", "impaired", "pfas", "ust", "hydro", "riskindex", "naip", "heritage", "health", "vulnerability", "broadband", "wildfirerisk", "tribal", "housing", "landslidesusc"]);

export default function FieldControls() {
  const pov = useSettings((s) => s.prefs.fieldPov) ?? "hydrologic";
  const measure = useSettings((s) => s.prefs.fieldMeasure) ?? "all";
  const normalise = useSettings((s) => s.prefs.fieldNormalise) ?? "density";
  const setPref = useSettings((s) => s.setPref);
  const setLayer = useGlobe((s) => s.setLayer);
  const waterOn = useGlobe((s) => s.layers.water);
  const height = useGlobe((s) => s.view.height);
  const condition = measure === "streamflow";
  const kind = kindForScale(pov, height);
  const measures = LAYERS.filter((l) => !NOT_MEASURES.has(l.id));

  return (
    <div className="mt-2 space-y-1.5 pl-4 text-[10px]">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Point of view">
        {FIELD_POVS.map((p: FieldPov) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={p === pov}
            onClick={() => setPref("fieldPov", p)}
            title={DOMAINS[p].question}
            className="rounded border px-1.5 py-0.5 uppercase tracking-widest"
            style={{
              borderColor: p === pov ? DOMAINS[p].color : "var(--border)",
              color: p === pov ? DOMAINS[p].color : "var(--muted-foreground)",
            }}
          >
            {DOMAINS[p].label}
          </button>
        ))}
      </div>
      <div className="text-muted-foreground">
        Now: <span className="text-foreground">{KINDS[kind].label}</span> · zoom to see the next scale emerge
      </div>
      <label className="flex items-center gap-2">
        <span className="hud-label shrink-0">Heat</span>
        <select
          value={measure}
          onChange={(e) => {
            const m = e.target.value as Measure;
            setPref("fieldMeasure", m);
            // The condition is read from the gauges, so bring them in.
            if (m === "streamflow" && !waterOn) setLayer("water", true);
          }}
          className="min-w-0 flex-1 rounded border border-border bg-background/60 px-1 py-0.5 text-[10px]"
        >
          <optgroup label="Condition">
            <option value="streamflow">streamflow vs normal for today</option>
          </optgroup>
          <optgroup label="Presence">
            <option value="all">every physical signal loaded</option>
            {measures.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label.toLowerCase()}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {condition ? (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-x-2 gap-y-0.5" aria-label="Flow classes">
            {FLOW_CLASS_ORDER.map((c) => (
              <span key={c} className="flex items-center gap-1" title={`${FLOW_CLASSES[c].range} percentile`}>
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: FLOW_CLASSES[c].color }} aria-hidden />
                {FLOW_CLASSES[c].label}
              </span>
            ))}
          </div>
          <div className="leading-snug text-muted-foreground">
            Each unit is its gauges&apos; median percentile against USGS daily statistics for today&apos;s date; the column rises with the distance from normal, either way, and to
            the top when a forecast point inside is in flood.
            {height > GAUGE_MAX_HEIGHT_M && <span className="text-alert"> Gauges load below {(GAUGE_MAX_HEIGHT_M / 1000).toLocaleString("en-US")} km; zoom in.</span>}
          </div>
        </div>
      ) : (
        <div className="flex gap-1" role="radiogroup" aria-label="Normalise">
          {(["density", "count"] as const).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === normalise}
              onClick={() => setPref("fieldNormalise", n)}
              className={`rounded border px-1.5 py-0.5 ${n === normalise ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
            >
              {n === "density" ? "per 1,000 km²" : "count"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
