"use client";
// "River path (NHDPlus)": the three NLDI traces from the NHDPlus V2 reach a
// point drains to, offered in the hydro ground dossier (the reach is already
// in the pick) and on every USGS gauge of the Surface water layer (the reach
// at the gauge's own coordinates is asked here). Drawn by NldiOverlay.
//
// Labelled apart from "Watersheds downstream (HUC-12)" (fabric's WBD chain in
// ConstructAside): that walks basins, this walks flowlines.

import { useEffect, useState } from "react";
import { useNldi, type TracePart } from "@/lib/water/nldiStore";
import type { Reach, TraceMode } from "@/lib/water/nldi";

interface ReachAnswer {
  comid: number | null;
  reach: Reach | null;
}

const LABEL: Record<TraceMode, string> = { down: "Trace downstream", basin: "Show basin", gauges: "Gauges upstream" };

function partText(mode: TraceMode, p: TracePart<unknown>): string | null {
  if (p.status === "loading") return "asking USGS NLDI…";
  if (p.status === "error") return `NLDI did not answer: ${(p.error ?? "").slice(0, 80)}`;
  if (p.status !== "ready") return null;
  if (mode === "down") {
    const g = p.data as GeoJSON.MultiLineString | null;
    return g ? `main stem drawn for ${p.distanceKm} km (${g.coordinates.length} NHDPlus flowlines)` : "no flowlines downstream";
  }
  if (mode === "basin") return p.data ? "drainage basin drawn (NLDI, simplified)" : "NLDI has no basin for this reach";
  const n = (p.data as unknown[] | null)?.length ?? 0;
  return `${n} USGS gauge${n === 1 ? "" : "s"} upstream within ${p.distanceKm} km of channel (a gauge already on the map is drawn once)`;
}

/** The trace buttons for a known reach, or for a point whose reach is asked first. */
export default function NldiAside({ reach, lon, lat }: { reach?: ReachAnswer | null; lon?: number; lat?: number }) {
  const [asked, setAsked] = useState<ReachAnswer | null | undefined>(reach);
  const [error, setError] = useState<string | null>(null);
  const t = useNldi();

  useEffect(() => {
    if (reach !== undefined || lon == null || lat == null) return;
    let live = true;
    fetch(`/api/water?op=reach&lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}`)
      .then((r) => r.json().then((j: { data?: ReachAnswer; error?: string }) => (r.ok && j.data ? j.data : Promise.reject(new Error(j.error ?? `HTTP ${r.status}`)))))
      .then((d) => live && setAsked(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [reach, lon, lat]);

  const a = reach !== undefined ? reach : asked;
  const comid = a?.comid ?? null;
  const label = a?.reach?.name ?? (comid != null ? "an unnamed reach" : "");
  const mine = comid != null && t.origin?.comid === comid;

  return (
    <div className="border-t border-border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="hud-label">River path (NHDPlus)</span>
        {mine && (
          <button type="button" className="text-[9px] text-muted-foreground hover:text-foreground" onClick={() => t.clear()}>
            clear
          </button>
        )}
      </div>
      {a === undefined && !error && <div className="mt-1 text-[10px] text-muted-foreground">asking USGS NLDI which reach this drains to…</div>}
      {error && <div className="mt-1 text-[10px] text-alert">NLDI did not answer: {error.slice(0, 80)}</div>}
      {a !== undefined && comid == null && !error && <div className="mt-1 text-[10px] text-muted-foreground">no NHDPlus V2 reach here (outside the network)</div>}
      {comid != null && (
        <>
          <div className="mt-1 text-[10px] text-muted-foreground">drains to {label} (NHDPlus V2 reach {comid})</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(["down", "basin", "gauges"] as TraceMode[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={mine && t[m].status === "loading"}
                onClick={() => t.run(comid, label, m)}
                className="border border-border px-2 py-1 text-[10px] text-foreground/80 hover:bg-accent hover:text-primary disabled:opacity-50"
              >
                {LABEL[m]}
              </button>
            ))}
          </div>
          {mine &&
            (["down", "basin", "gauges"] as TraceMode[]).map((m) => {
              const line = partText(m, t[m]);
              return line ? (
                <div key={m} className="mt-1 text-[10px] text-muted-foreground">
                  {LABEL[m].toLowerCase()}: {line}
                </div>
              ) : null;
            })}
          <div className="mt-1 text-[9px] leading-snug text-muted-foreground">
            On the medium-resolution NHDPlus V2 network through USGS NLDI: a river path by flowline, not the HUC-12 watersheds (those are &quot;Watersheds downstream&quot;).
          </div>
        </>
      )}
    </div>
  );
}
