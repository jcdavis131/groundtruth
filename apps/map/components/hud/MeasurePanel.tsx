"use client";
// Measure tools: geodesic distance, area, and the ground elevation under a
// click. The drawn shape travels in share links (&shape=); the formulas are
// printed under the readout.

import { Link2, Mountain, Ruler, ScanSearch, Spline, Square, Undo2, X } from "lucide-react";
import { useGlobe, type MeasureMode } from "@/lib/store/globe";
import { fmtArea, fmtLength, measureOpen, measureShape, setMeasureMode } from "@/lib/globe/measure";
import { copyShareLink } from "@/lib/globe/share";
import { formatLatLon } from "@/lib/globe/geo";
import ElevationProfile from "./ElevationProfile";
import { useArea } from "@/lib/aoi/store";

const MODES: Array<{ mode: Exclude<MeasureMode, "off">; label: string; icon: typeof Ruler; hint: string }> = [
  { mode: "distance", label: "Distance", icon: Spline, hint: "Click the globe to add points along a path; a path has an elevation profile." },
  { mode: "area", label: "Area", icon: Square, hint: "Click the globe to add corners; the shape closes itself." },
  { mode: "elevation", label: "Elevation", icon: Mountain, hint: "Click the ground for its elevation (USGS 3DEP, United States)." },
];

export default function MeasurePanel() {
  const m = useGlobe((s) => s.measure);
  const setMeasure = useGlobe((s) => s.setMeasure);
  if (!measureOpen(m)) return null;

  const shape = m.shape;
  const result = shape && shape.points.length >= 2 ? measureShape(shape) : null;
  const active = MODES.find((x) => x.mode === m.mode);

  const setMode = (mode: Exclude<MeasureMode, "off">) => {
    // Switching between distance and area keeps the points and changes what they measure.
    if (shape && (mode === "distance" || mode === "area")) {
      setMeasureMode(mode, { shape: { kind: mode === "area" ? "area" : "line", points: shape.points } });
    } else setMeasureMode(mode);
  };

  return (
    <div className="hud-panel pointer-events-auto">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: "#FFE45E" }}>
            <Ruler className="mr-1 inline size-3" />
            Measure
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">{active ? active.label : "shape kept"}</div>
          <div className="text-[9px] text-muted-foreground">{active ? active.hint : "Pick a tool to keep drawing; clicks select objects again."}</div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            onClick={() => void copyShareLink()}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Copy a link to this view with the shape"
            title="Copy link (carries the shape)"
          >
            <Link2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMeasure({ mode: "off", shape: null, elevation: null })}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close measure tools"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 px-3 py-2">
        {MODES.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => setMode(mode)}
            aria-pressed={m.mode === mode}
            className={`flex flex-1 items-center justify-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-widest ${
              m.mode === mode ? "border-[#FFE45E]/70 bg-[#FFE45E]/10 text-[#FFE45E]" : "border-border text-foreground/75 hover:bg-accent hover:text-primary"
            }`}
          >
            <Icon className="size-3" />
            {label}
          </button>
        ))}
      </div>

      {shape && (
        <div className="border-t border-border/60 px-3 py-2">
          {result ? (
            <>
              {result.areaM2 != null && <div className="text-[13px] tabular-nums text-foreground">{fmtArea(result.areaM2)}</div>}
              <div className={`tabular-nums ${result.areaM2 != null ? "text-[11px] text-foreground/80" : "text-[13px] text-foreground"}`}>
                {result.areaM2 != null ? "perimeter " : ""}
                {fmtLength(result.lengthM)}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground">one point placed; add another</div>
          )}
          {shape.kind === "area" && shape.points.length === 2 && (
            <div className="text-[9px] text-muted-foreground">add a third corner for an area</div>
          )}
          <div className="mt-1 flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">
              {shape.points.length} point{shape.points.length === 1 ? "" : "s"} · {shape.kind}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setMeasure({ shape: shape.points.length > 1 ? { ...shape, points: shape.points.slice(0, -1) } : null })}
              className="flex items-center gap-1 border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-foreground/75 hover:bg-accent hover:text-primary"
            >
              <Undo2 className="size-3" /> Undo
            </button>
            <button
              type="button"
              onClick={() => setMeasure({ shape: null })}
              className="border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-foreground/75 hover:bg-accent hover:text-primary"
            >
              Clear
            </button>
            {m.mode !== "off" && (
              <button
                type="button"
                onClick={() => setMeasure({ mode: "off" })}
                className="border border-[#FFE45E]/60 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[#FFE45E] hover:bg-[#FFE45E]/10"
                title="Stop drawing; clicks select objects again"
              >
                Done
              </button>
            )}
          </div>
          {shape.kind === "area" && shape.points.length >= 3 && (
            <button
              type="button"
              onClick={() => useArea.getState().setOpen(true)}
              className="mt-1 flex items-center gap-1.5 border border-[#7DD3FC]/60 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[#7DD3FC] hover:bg-[#7DD3FC]/10"
              title="List what the loaded layers hold inside this area, watch it for arrivals and departures, export it, or build its land report"
            >
              <ScanSearch className="size-3" /> What&apos;s inside
            </button>
          )}
          {result && (
            <ul className="mt-1 space-y-0.5 text-[9px] leading-snug text-muted-foreground">
              {result.formula.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {shape && shape.kind === "line" && shape.points.length >= 2 && <ElevationProfile shape={shape} />}

      {m.elevation && (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="hud-label">Ground elevation</span>
            <span className="text-[9px] tabular-nums text-muted-foreground">{formatLatLon(m.elevation.lat, m.elevation.lon)}</span>
          </div>
          {m.elevation.loading ? (
            <div className="text-[11px] text-muted-foreground">asking USGS 3DEP…</div>
          ) : m.elevation.metres != null ? (
            <div className="text-[13px] tabular-nums text-foreground">
              {m.elevation.metres.toFixed(1)} m · {(m.elevation.metres / 0.3048).toFixed(0)} ft
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">
              {m.elevation.error
                ? `elevation service unavailable: ${m.elevation.error.slice(0, 60)}`
                : "no 3DEP elevation here (the service covers the United States)"}
              {m.elevation.note && <div className="text-[9px]">{m.elevation.note}</div>}
            </div>
          )}
          <div className="mt-0.5 text-[9px] leading-snug text-muted-foreground/80">
            USGS 3DEP Elevation Point Query Service, bare-earth DEM
            {m.elevation.resolutionM != null ? `, source resolution ${m.elevation.resolutionM} m` : ""}; metres above the DEM&apos;s vertical datum
            (NAVD88 in the conterminous US).
          </div>
        </div>
      )}
    </div>
  );
}
