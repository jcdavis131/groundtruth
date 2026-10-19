"use client";
// Controls under a picture layer's row in the layer panel: its opacity, the
// sea level rise scenario, and the class legend the publisher's own service
// lists (WHP, NLCD, NOAA's sea level rise, NWI's wetlands raster), so a colour
// on the globe can be read without leaving the panel.

import { useEffect, useState } from "react";
import { useSettings } from "@/lib/store/settings";
import type { LayerId } from "@/lib/layers/types";
import { NLCD_CLASSES, NWI_RASTER_CLASSES, SLR_LEGEND, WHP_CLASSES } from "@/lib/terrain/classes";
import { LANDSLIDE_SUSC_LEGEND, SLR_DEFAULT_FT, SLR_FEET, isSlrFeet } from "@/lib/terrain/products";
import { releasesByYear, resolveRelease, type WaybackRelease } from "@/lib/terrain/wayback";
import { resolveTopoYear, yearLabel } from "@/lib/terrain/topo";
import { useTopoHere } from "@/lib/layers/topo";
import { useNaipHere } from "@/lib/layers/naip";
import { resolveNaipYear } from "@/lib/terrain/naip";

/** Layers that draw a tiled picture (their own, or the FEMA map under flood zones). */
export const PICTURE_LAYERS = new Set<LayerId>(["relief", "slope", "contours", "soils", "firehazard", "landslidesusc", "landcover", "sealevel", "flood", "wetlands", "geology", "crithab", "wayback", "topo", "hydro", "naip"]);

const DEFAULT_ALPHA: Partial<Record<LayerId, number>> = {
  naip: 1,
  hydro: 0.9,
  relief: 0.55,
  slope: 0.6,
  contours: 0.9,
  soils: 0.9,
  firehazard: 0.65,
  landslidesusc: 0.65,
  landcover: 0.7,
  sealevel: 0.75,
  flood: 0.8,
  wetlands: 0.7,
  geology: 0.55,
  crithab: 0.75,
  wayback: 1,
  topo: 1,
};

function Swatches({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
      {items.map((c) => (
        <li key={c.label} className="flex items-center gap-1 text-[9px] text-muted-foreground" title={c.label}>
          <span className="inline-block size-2 shrink-0 border border-black/40" style={{ background: c.color }} aria-hidden />
          {c.label}
        </li>
      ))}
    </ul>
  );
}

/** Esri's Wayback release index, read once a page from /api/terrain?op=wayback (edge-cached). */
let releasesOnce: Promise<WaybackRelease[]> | null = null;
function loadReleases(): Promise<WaybackRelease[]> {
  if (!releasesOnce) {
    releasesOnce = fetch("/api/terrain?op=wayback")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { data?: { releases?: WaybackRelease[] } }) => j.data?.releases ?? [])
      .catch((err) => {
        releasesOnce = null;
        throw err;
      });
  }
  return releasesOnce;
}

/** The release picker under Historic imagery: releases grouped by year, newest first. */
function WaybackPicker() {
  const wanted = useSettings((s) => s.prefs.waybackRelease);
  const setPref = useSettings((s) => s.setPref);
  const [list, setList] = useState<WaybackRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadReleases().then(
      (l) => live && setList(l),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  if (error) return <div>Esri&apos;s release index did not load ({error}).</div>;
  if (!list) return <div>Loading Esri&apos;s release index…</div>;
  const { release, fallback } = resolveRelease(list, wanted);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Release</span>
        <select
          value={release?.release ?? ""}
          onChange={(e) => setPref("waybackRelease", e.target.value ? Number(e.target.value) : null)}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="World Imagery Wayback release (publication date, not capture date)"
        >
          {releasesByYear(list).map((g) => (
            <optgroup key={g.year} label={g.year} className="bg-background">
              {g.releases.map((r) => (
                <option key={r.release} value={r.release} className="bg-background">
                  Release {r.date}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {fallback && <div>The release in the link is not in Esri&apos;s index; showing the newest.</div>}
      <div>A release date is when Esri published the basemap, not when the pixels were captured; 2014 onward only. Click the ground for the capture date Esri lists there.</div>
    </>
  );
}

/** The edition picker under Historic topo maps: only the years with a sheet at the view centre. */
function TopoPicker() {
  const wanted = useSettings((s) => s.prefs.topoYear);
  const setPref = useSettings((s) => s.setPref);
  const here = useTopoHere((s) => s.here);
  if (!here) return <div>Descend below 150 km for the editions at the view centre; the maps draw from about 10 km.</div>;
  if (!here.years.length) return <div>No USGS topographic sheet at the view centre.</div>;
  const { year, present, nearest } = resolveTopoYear(here.years, wanted);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Edition</span>
        <select
          value={wanted != null && present ? String(wanted) : ""}
          onChange={(e) => setPref("topoYear", e.target.value ? Number(e.target.value) : null)}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="USGS topographic map edition year (only years with a sheet at the view centre)"
        >
          <option value="" className="bg-background">
            Newest here ({here.years[here.years.length - 1].year})
          </option>
          {[...here.years].reverse().map((y) => (
            <option key={y.year} value={y.year} className="bg-background">
              {yearLabel(y)}
            </option>
          ))}
        </select>
      </label>
      {!present && year != null && (
        <div>
          No {year} sheet at the view centre{nearest.length ? `; nearest editions here: ${nearest.join(", ")}` : ""}. The {year} edition draws only where a {year} sheet exists.
        </div>
      )}
      <div>The edition year is when USGS revised the map, not a survey date; parts of a sheet can be older. Click the ground for the sheets.</div>
    </>
  );
}

/** The year picker under Aerial photos by year: only the years NAIP flew at the view centre. */
function NaipPicker() {
  const wanted = useSettings((s) => s.prefs.naipYear);
  const setPref = useSettings((s) => s.setPref);
  const here = useNaipHere((s) => s.here);
  if (!here) return <div>Descend below 150 km for the NAIP years at the view centre; the photographs draw from about 20 km.</div>;
  if (!here.years.length) return <div>No NAIP photograph at the view centre (NAIP covers the conterminous United States).</div>;
  const { year, present } = resolveNaipYear(here.years, wanted);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">Year</span>
        <select
          value={wanted != null && present ? String(wanted) : ""}
          onChange={(e) => setPref("naipYear", e.target.value ? Number(e.target.value) : null)}
          className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
          aria-label="NAIP year (only years flown at the view centre)"
        >
          <option value="" className="bg-background">
            Newest here ({here.years[here.years.length - 1].year})
          </option>
          {[...here.years].reverse().map((y) => (
            <option key={y.year} value={y.year} className="bg-background">
              {y.year} (flown {y.items.map((i) => i.date).join(", ")})
            </option>
          ))}
        </select>
      </label>
      {!present && year != null && <div>No {year} NAIP photograph at the view centre; the {year} mosaic draws only where {year} was flown.</div>}
      <div>Flown state by state in the growing season, so the years differ by place. Tiles take 1 to 3 s. Click the ground for the flight date.</div>
    </>
  );
}

export default function TileControls({ id }: { id: LayerId }) {
  const alpha = useSettings((s) => s.prefs.tileAlpha?.[id]);
  const ft = useSettings((s) => s.prefs.seaLevelFt);
  const setPref = useSettings((s) => s.setPref);
  if (!PICTURE_LAYERS.has(id)) return null;
  const value = alpha ?? DEFAULT_ALPHA[id] ?? 0.8;
  const setAlpha = (v: number) => {
    const cur = useSettings.getState().prefs.tileAlpha ?? {};
    setPref("tileAlpha", { ...cur, [id]: v });
  };
  return (
    <div className="mt-1.5 space-y-1 pl-4 text-[10px] text-muted-foreground md:text-[9px]">
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 uppercase tracking-widest">{id === "flood" ? "FEMA map" : id === "wetlands" ? "Raster" : "Opacity"}</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => setAlpha(Number(e.target.value))}
          className="h-3 min-w-0 flex-1 accent-[var(--primary)]"
          aria-label={`${id} picture opacity`}
        />
        <span className="w-8 shrink-0 text-right tabular-nums text-foreground/80">{Math.round(value * 100)}%</span>
      </label>
      {id === "sealevel" && (
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0 uppercase tracking-widest">Scenario</span>
          <select
            value={isSlrFeet(ft) ? ft : SLR_DEFAULT_FT}
            onChange={(e) => setPref("seaLevelFt", Number(e.target.value))}
            className="min-w-0 flex-1 border border-border bg-transparent px-1 py-0.5 text-foreground"
            aria-label="Sea level rise scenario, feet above MHHW"
          >
            {SLR_FEET.map((f) => (
              <option key={f} value={f} className="bg-background">
                {f} ft above MHHW
              </option>
            ))}
          </select>
        </label>
      )}
      {id === "firehazard" && <Swatches items={WHP_CLASSES} />}
      {id === "landslidesusc" && <div>{LANDSLIDE_SUSC_LEGEND} Click the ground for the county&apos;s share of susceptible terrain.</div>}
      {id === "sealevel" && <Swatches items={SLR_LEGEND} />}
      {id === "landcover" && <Swatches items={NLCD_CLASSES.filter((c) => !/AK only/.test(c.label))} />}
      {id === "slope" && <div>USGS&apos;s colours: yellow to red is steeper; click the ground for the slope in degrees.</div>}
      {id === "soils" && <div>Map units outlined with their symbols; click the ground for the soil.</div>}
      {id === "wayback" && <WaybackPicker />}
      {id === "topo" && <TopoPicker />}
      {id === "naip" && <NaipPicker />}
      {id === "hydro" && <div>USGS NHD streams and water bodies; click the ground for the reach it drains to and trace it downstream, its basin or the gauges upstream.</div>}
      {id === "crithab" && <div>FWS&apos;s map of final and proposed designations, with NOAA Fisheries&apos; marine and anadromous species; click the ground for the species and whether it is proposed. Not where a species lives.</div>}
      {id === "wetlands" && (
        <>
          <div>Above 10 km: NWI&apos;s national raster, about 100 m, so small wetlands can be missing. Below 10 km: the polygons, to click.</div>
          <Swatches items={NWI_RASTER_CLASSES} />
        </>
      )}
    </div>
  );
}
