"use client";
// "What's here": everything this app can say about one point, asked of the
// sources it already uses (lib/whatshere/here.ts). Opened by a right-click on
// the globe, or from ⌘K for the camera target.

import { Crosshair, Droplets, Landmark, MapPin, X } from "lucide-react";
import { useHere, closeHere, hereNearest, type HereState, type SurveyAnswer } from "@/lib/whatshere/here";
import { useGlobe } from "@/lib/store/globe";
import { flyTo, flyToSelection } from "@/lib/globe/camera";
import { formatDistance, formatLatLon } from "@/lib/globe/geo";
import { LAYER_BY_ID } from "@/lib/layers";
import { ageRange, type GeologyAnswer } from "@/lib/infra/geology";
import { useNow } from "@/lib/hooks/useNow";

const ACCENT = "#7DD3FC";

function Part<T>({ title, who, state, children }: { title: string; who: string; state: HereState<T> | undefined; children: (data: T) => React.ReactNode }) {
  if (!state) return null;
  return (
    <section className="border-t border-border/60 px-3 py-1.5">
      <div className="hud-label">{title}</div>
      {state.loading ? (
        <div className="text-[10px] text-muted-foreground">asking {who}…</div>
      ) : state.error ? (
        <div className="text-[10px] text-muted-foreground">{who} did not answer: {state.error.slice(0, 80)}</div>
      ) : (
        children(state.data as T)
      )}
      <div className="text-[8.5px] text-muted-foreground/70">{who}</div>
    </section>
  );
}

export default function WhatsHerePanel() {
  const pick = useHere((s) => s.pick);
  // Re-read the loaded layers every few seconds while the panel is open.
  useNow(4000);
  if (!pick) return null;
  const near = hereNearest(pick);
  const go = (open?: "water" | "market") => {
    flyTo(pick.lon, pick.lat, { height: open ? 120_000 : 20_000 });
    const g = useGlobe.getState();
    if (open === "water") g.setWaterReportOpen(true);
    if (open === "market") g.setMarketReportOpen(true);
  };
  return (
    <div className="hud-panel pointer-events-auto">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="hud-label" style={{ color: ACCENT }}>
            <MapPin className="mr-1 inline size-3" />
            What&apos;s here
          </div>
          <div className="hud-display truncate text-[15px] font-semibold leading-tight text-foreground">{formatLatLon(pick.lat, pick.lon)}</div>
          <div className="text-[9px] text-muted-foreground">Each line is asked of its own source; one that did not answer says so.</div>
        </div>
        <button type="button" onClick={closeHere} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close what's here">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex gap-1 px-3 py-2">
        <button type="button" onClick={() => go()} className="flex flex-1 items-center justify-center gap-1 border border-border px-1.5 py-1 text-[9px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary">
          <Crosshair className="size-3" /> Fly here
        </button>
        <button type="button" onClick={() => go("water")} className="flex flex-1 items-center justify-center gap-1 border border-border px-1.5 py-1 text-[9px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary">
          <Droplets className="size-3" /> Water report
        </button>
        <button type="button" onClick={() => go("market")} className="flex flex-1 items-center justify-center gap-1 border border-border px-1.5 py-1 text-[9px] uppercase tracking-widest text-foreground/80 hover:bg-accent hover:text-primary">
          <Landmark className="size-3" /> Market report
        </button>
      </div>

      <Part title="Place" who="Census TIGERweb, USGS WBD, NWS, Natural Earth (the constructs stack)" state={pick.parts.place as HereState<Array<{ kind: string; name: string; code?: string }>> | undefined}>
        {(lines) =>
          lines?.length ? (
            <ul>
              {lines.map((l) => (
                <li key={`${l.kind}:${l.name}`} className="text-[10px] leading-snug">
                  <span className="text-muted-foreground">{l.kind}</span> <span className="text-foreground/90">{l.name}</span>
                  {l.code && <span className="text-muted-foreground"> · {l.code}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[10px] text-muted-foreground">no construct answered for this point</div>
          )
        }
      </Part>

      <Part title="Ground elevation" who="USGS 3DEP Elevation Point Query Service" state={pick.parts.elevation as HereState<{ metres?: number; resolutionM?: number; note?: string }> | undefined}>
        {(e) =>
          e?.metres != null ? (
            <div className="text-[11px] tabular-nums text-foreground">
              {e.metres.toFixed(1)} m · {(e.metres / 0.3048).toFixed(0)} ft
              {e.resolutionM != null && <span className="text-[9px] text-muted-foreground"> · source DEM {e.resolutionM} m</span>}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">no 3DEP value here (it covers the United States)</div>
          )
        }
      </Part>

      <Part title="Geology" who="Macrostrat (CC BY 4.0) and the map it cites" state={pick.parts.geology as HereState<GeologyAnswer> | undefined}>
        {(g) => {
          const u = g?.units?.[0];
          if (!u) return <div className="text-[10px] text-muted-foreground">no mapped unit in Macrostrat&apos;s compilation</div>;
          return (
            <div className="text-[10px] leading-snug">
              <div className="text-foreground/90">{u.name ?? "not named on this map"}</div>
              {u.age && (
                <div className="text-muted-foreground">
                  {u.age}
                  {ageRange(u) ? ` (${ageRange(u)})` : ""}
                </div>
              )}
              {u.lith && <div className="text-muted-foreground">{u.lith}</div>}
              {u.source && <div className="text-[9px] text-muted-foreground/80">map: {u.source}</div>}
            </div>
          );
        }}
      </Part>

      <Part title="Public Land Survey" who="BLM National PLSS (CadNSDI)" state={pick.parts.survey as HereState<SurveyAnswer | null> | undefined}>
        {(s) =>
          s ? (
            <div className="text-[11px] text-foreground">
              {[s.section ? `S${s.section}` : null, s.township, s.range].filter(Boolean).join(" ")}
              {s.meridian && <span className="text-[9px] text-muted-foreground"> · {s.meridian}{s.state ? ` (${s.state})` : ""}</span>}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">not in a PLSS township (Texas and the original colonies were never surveyed into them)</div>
          )
        }
      </Part>

      <section className="border-t border-border/60 px-3 py-1.5">
        <div className="hud-label">Nearest loaded</div>
        {near.length ? (
          <ul>
            {near.map(({ f, m, layer }) => (
              <li key={`${layer}:${f.properties.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    useGlobe.getState().select({ layer, id: f.properties.id }, f);
                    flyToSelection({ layer, id: f.properties.id });
                  }}
                  className="flex w-full items-baseline gap-1.5 text-left text-[10px] hover:text-primary"
                >
                  <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: LAYER_BY_ID[layer]?.color }} aria-hidden />
                  <span className="truncate text-foreground/85">{f.properties.name}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{formatDistance(m)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[10px] text-muted-foreground">nothing loaded within 50 km; switch layers on to see what is near</div>
        )}
      </section>
    </div>
  );
}
