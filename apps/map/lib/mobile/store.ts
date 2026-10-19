// Mobile-only HUD state. On a phone the layer list is a sheet you open rather
// than a panel that is always on screen, and every open panel shares one
// bottom sheet, so this store knows which panels are open across the other
// stores and can close them all at once.

import { create } from "zustand";
import { useGlobe } from "@/lib/store/globe";
import { useIndicators } from "@/lib/indicators/store";
import { useReleases } from "@/lib/releases/store";
import { useWatchlists } from "@/lib/watch/store";
import { useScreener } from "@/lib/screener/store";
import { useStrata } from "@/lib/fabric/strataStore";
import { measureOpen } from "@/lib/globe/measure";
import { areaRing, useArea } from "@/lib/aoi/store";
import { useHere } from "@/lib/whatshere/here";

/** Peek shows the sheet's header row (the strata rail's focused construct); half and tall show the panels. */
export type SheetHeight = "peek" | "half" | "tall";

/** Pixel heights of the three stops for a viewport height (the CSS classes use the same numbers). */
export function sheetStops(vh: number): Record<SheetHeight, number> {
  return { peek: 124, half: Math.min(vh * 0.48, 480), tall: Math.max(200, vh - 190) };
}

/** Where a drag that ended at `h` pixels settles: the nearest stop, or null (close) when dragged far below peek. */
export function snapSheet(h: number, vh: number): SheetHeight | null {
  const stops = sheetStops(vh);
  if (h < stops.peek - 56) return null;
  let best: SheetHeight = "peek";
  for (const k of ["peek", "half", "tall"] as SheetHeight[]) if (Math.abs(stops[k] - h) < Math.abs(stops[best] - h)) best = k;
  return best;
}

interface MobileState {
  /** The signal-layers list is open in the sheet. */
  layersOpen: boolean;
  setLayersOpen: (open: boolean) => void;
  toggleLayers: () => void;
  /** Sheet height; the handle toggles it and dragging it snaps between the three. */
  sheet: SheetHeight;
  setSheet: (h: SheetHeight) => void;
  toggleSheet: () => void;
}

export const useMobile = create<MobileState>()((set) => ({
  layersOpen: false,
  setLayersOpen: (layersOpen) => set({ layersOpen }),
  toggleLayers: () => set((s) => ({ layersOpen: !s.layersOpen })),
  sheet: "half",
  setSheet: (sheet) => set({ sheet }),
  toggleSheet: () => set((s) => ({ sheet: s.sheet === "tall" ? "half" : "tall" })),
}));

/** Which panels are open right now, read from every store that owns one. */
export function openPanels(): string[] {
  const g = useGlobe.getState();
  const out: string[] = [];
  if (useMobile.getState().layersOpen) out.push("layers");
  if (g.layers.constructs && useStrata.getState().railOpen) out.push("strata");
  if (g.waterReportOpen) out.push("water");
  if (g.marketReportOpen) out.push("market");
  if (g.spaceWeatherOpen) out.push("space");
  if (measureOpen(g.measure)) out.push("measure");
  if (useArea.getState().open && areaRing(g.measure.shape)) out.push("area");
  if (useHere.getState().pick) out.push("here");
  if (useIndicators.getState().open) out.push("indicators");
  if (useReleases.getState().releasesOpen) out.push("releases");
  if (useWatchlists.getState().open) out.push("watch");
  if (useScreener.getState().open) out.push("screener");
  if (g.selected) out.push("info");
  return out;
}

/** Close every panel and drop the selection; the sheet disappears. */
export function closeAllPanels(): void {
  useMobile.getState().setLayersOpen(false);
  useStrata.getState().setRailOpen(false);
  const g = useGlobe.getState();
  g.setWaterReportOpen(false);
  g.setMarketReportOpen(false);
  g.setSpaceWeatherOpen(false);
  g.setMeasure({ mode: "off", shape: null, elevation: null });
  useArea.getState().setOpen(false);
  useHere.getState().set(null);
  g.select(null);
  useIndicators.getState().setOpen(false);
  useReleases.getState().setReleasesOpen(false);
  useWatchlists.getState().setOpen(false);
  useScreener.getState().setOpen(false);
}

/**
 * Subscribe to the open state of every panel. Returns the list of open panel
 * ids; the sheet renders when it is non-empty.
 */
export function useOpenPanels(): string[] {
  const layers = useMobile((s) => s.layersOpen);
  const constructsOn = useGlobe((s) => s.layers.constructs);
  const railOpen = useStrata((s) => s.railOpen);
  const strata = constructsOn && railOpen;
  const water = useGlobe((s) => s.waterReportOpen);
  const market = useGlobe((s) => s.marketReportOpen);
  const space = useGlobe((s) => s.spaceWeatherOpen);
  const measure = useGlobe((s) => measureOpen(s.measure));
  const areaShape = useGlobe((s) => !!areaRing(s.measure.shape));
  const areaOpen = useArea((s) => s.open);
  const area = areaOpen && areaShape;
  const here = useHere((s) => !!s.pick);
  const selected = useGlobe((s) => s.selected);
  const ind = useIndicators((s) => s.open);
  const rel = useReleases((s) => s.releasesOpen);
  const watch = useWatchlists((s) => s.open);
  const screen = useScreener((s) => s.open);
  const out: string[] = [];
  if (layers) out.push("layers");
  if (strata) out.push("strata");
  if (water) out.push("water");
  if (market) out.push("market");
  if (space) out.push("space");
  if (measure) out.push("measure");
  if (area) out.push("area");
  if (here) out.push("here");
  if (ind) out.push("indicators");
  if (rel) out.push("releases");
  if (watch) out.push("watch");
  if (screen) out.push("screener");
  if (selected) out.push("info");
  return out;
}
