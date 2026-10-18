// One place that knows how to open each panel, shared by the phone nav, the
// "Start here" card and the lens store, so a panel id means the same thing
// everywhere.

import { useGlobe } from "@/lib/store/globe";
import { useIndicators } from "@/lib/indicators/store";
import { useReleases } from "@/lib/releases/store";
import { useWatchlists } from "@/lib/watch/store";
import { useScreener } from "@/lib/screener/store";
import { useMobile } from "@/lib/mobile/store";
import { copyShareLink } from "@/lib/globe/share";
import { useTeleport } from "@/lib/live/teleportStore";
import type { PanelId } from "./registry";
import { useStrata } from "@/lib/fabric/strataStore";
import { measureOpen, setMeasureMode } from "@/lib/globe/measure";

export function isPanelOpen(id: PanelId): boolean {
  const g = useGlobe.getState();
  switch (id) {
    case "layers":
      return useMobile.getState().layersOpen;
    case "strata":
      return g.layers.constructs && useStrata.getState().railOpen;
    case "water":
      return g.waterReportOpen;
    case "market":
      return g.marketReportOpen;
    case "space":
      return g.spaceWeatherOpen;
    case "measure":
      return measureOpen(g.measure);
    case "signals":
      return useIndicators.getState().open;
    case "screen":
      return useScreener.getState().open;
    case "releases":
      return useReleases.getState().releasesOpen;
    case "watch":
      return useWatchlists.getState().open;
    case "teleport":
      return useTeleport.getState().active;
    default:
      return false;
  }
}

/** Open (or toggle) a panel. The water and market reports also switch on the layers they read. */
export function setPanel(id: PanelId, on: boolean): void {
  const g = useGlobe.getState();
  switch (id) {
    case "layers":
      useMobile.getState().setLayersOpen(on);
      return;
    case "strata":
      // The rail lists the constructs stack, so opening it switches the layer on.
      if (on) g.setLayer("constructs", true);
      useStrata.getState().setRailOpen(on);
      return;
    case "water":
      if (on) {
        g.setLayer("water", true);
        g.setLayer("groundwater", true);
      }
      g.setWaterReportOpen(on);
      return;
    case "market":
      if (on) {
        g.setLayer("realestate", true);
        g.setLayer("commerce", true);
        g.setLayer("trade", true);
      }
      g.setMarketReportOpen(on);
      return;
    case "space":
      g.setSpaceWeatherOpen(on);
      return;
    case "measure":
      // On: the distance tool (clicks place points). Off: the tool, the shape and the reading all close.
      if (on) setMeasureMode("distance");
      else g.setMeasure({ mode: "off", shape: null, elevation: null });
      return;
    case "signals":
      useIndicators.getState().setOpen(on);
      return;
    case "screen":
      useScreener.getState().setOpen(on);
      return;
    case "releases":
      useReleases.getState().setReleasesOpen(on);
      return;
    case "watch":
      useWatchlists.getState().setOpen(on);
      return;
    case "explore":
      g.setExploreOpen(on);
      return;
    case "teleport":
      if (on) void useTeleport.getState().start();
      else useTeleport.getState().stop();
      return;
    case "share":
      if (on) void copyShareLink();
      return;
  }
}

export function togglePanel(id: PanelId): void {
  setPanel(id, !isPanelOpen(id));
}
