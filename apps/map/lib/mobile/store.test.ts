import { beforeEach, describe, expect, it } from "vitest";
import { closeAllPanels, openPanels, sheetStops, snapSheet, useMobile } from "./store";
import { useStrata } from "@/lib/fabric/strataStore";
import { useGlobe } from "@/lib/store/globe";
import { useIndicators } from "@/lib/indicators/store";
import { useReleases } from "@/lib/releases/store";
import { useWatchlists } from "@/lib/watch/store";
import { useScreener } from "@/lib/screener/store";

describe("mobile panel bookkeeping", () => {
  beforeEach(() => closeAllPanels());

  it("starts with nothing open", () => {
    expect(openPanels()).toEqual([]);
  });

  it("lists every open panel across the stores", () => {
    useMobile.getState().setLayersOpen(true);
    useGlobe.getState().setMarketReportOpen(true);
    useGlobe.getState().setSpaceWeatherOpen(true);
    useGlobe.getState().setMeasure({ mode: "distance" });
    useIndicators.getState().setOpen(true);
    useReleases.getState().setReleasesOpen(true);
    useWatchlists.getState().setOpen(true);
    useScreener.getState().setOpen(true);
    useGlobe.getState().select({ layer: "water", id: "x" });
    expect(openPanels()).toEqual(["layers", "market", "space", "measure", "indicators", "releases", "watch", "screener", "info"]);
  });

  it("closeAllPanels clears all of them and the selection", () => {
    useMobile.getState().setLayersOpen(true);
    useGlobe.getState().setWaterReportOpen(true);
    // A kept shape holds the measure panel open even with no tool on.
    useGlobe.getState().setMeasure({ mode: "off", shape: { kind: "line", points: [[0, 0], [1, 1]] } });
    useGlobe.getState().select({ layer: "water", id: "x" });
    closeAllPanels();
    expect(openPanels()).toEqual([]);
    expect(useGlobe.getState().selected).toBeNull();
    expect(useGlobe.getState().measure).toEqual({ mode: "off", shape: null, elevation: null });
  });

  it("toggles the sheet height", () => {
    expect(useMobile.getState().sheet).toBe("half");
    useMobile.getState().toggleSheet();
    expect(useMobile.getState().sheet).toBe("tall");
    useMobile.getState().toggleSheet();
    expect(useMobile.getState().sheet).toBe("half");
  });
});

describe("sheet stops", () => {
  it("snaps a drag to the nearest of peek, half and tall, or closes it", () => {
    const vh = 844;
    const stops = sheetStops(vh);
    expect(stops.peek).toBeLessThan(stops.half);
    expect(stops.half).toBeLessThan(stops.tall);
    expect(snapSheet(130, vh)).toBe("peek");
    expect(snapSheet(stops.half + 20, vh)).toBe("half");
    expect(snapSheet(vh, vh)).toBe("tall");
    expect(snapSheet(20, vh)).toBeNull();
  });
  it("lists the strata rail while the constructs layer is on", () => {
    closeAllPanels();
    useGlobe.getState().setLayer("constructs", true);
    useStrata.getState().setRailOpen(true);
    expect(openPanels()).toEqual(["strata"]);
    closeAllPanels();
    expect(openPanels()).toEqual([]);
    useGlobe.getState().setLayer("constructs", false);
  });
});
