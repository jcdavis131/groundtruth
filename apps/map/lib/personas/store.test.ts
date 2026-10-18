import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/globe/camera", () => ({ flyTo: vi.fn() }));

import { applyPersona, layersFor, useLens } from "./store";
import { PERSONA_BY_ID } from "./registry";
import { useGlobe } from "@/lib/store/globe";
import { useIndicators } from "@/lib/indicators/store";
import { useScreener } from "@/lib/screener/store";
import { openPanels } from "@/lib/mobile/store";
import { flyTo } from "@/lib/globe/camera";

describe("lens store", () => {
  beforeEach(() => {
    useLens.setState({ personaId: null, pickerOpen: true, dismissedSteps: [] });
    vi.mocked(flyTo).mockClear();
  });

  it("drops heavy layers on phones only", () => {
    const p = PERSONA_BY_ID.explorer;
    expect(layersFor(p, false)).toContain("satellites");
    expect(layersFor(p, true)).not.toContain("satellites");
    expect(layersFor(PERSONA_BY_ID.water, true)).toEqual(PERSONA_BY_ID.water.layers);
  });

  it("applies a lens: layers, panel, defaults, camera, picker closed", () => {
    applyPersona("realestate", { mobile: false });
    const g = useGlobe.getState();
    expect(g.layers.realestate).toBe(true);
    expect(g.layers.commerce).toBe(true);
    expect(g.layers.aircraft).toBe(false);
    expect(openPanels()).toEqual(["market"]);
    expect(useIndicators.getState().category).toBe("housing");
    expect(useScreener.getState().kind).toBe("county");
    expect(useScreener.getState().queryText).toContain("momentum");
    expect(useLens.getState().personaId).toBe("realestate");
    expect(useLens.getState().pickerOpen).toBe(false);
    expect(flyTo).toHaveBeenCalledWith(-97.75, 30.3, expect.objectContaining({ height: 160_000 }));
  });

  it("switching lenses closes the previous panels and can skip the flight", () => {
    applyPersona("realestate", { mobile: false });
    applyPersona("water", { mobile: true, fly: false });
    expect(openPanels()).toEqual(["water"]);
    expect(useGlobe.getState().layers.realestate).toBe(false);
    expect(useGlobe.getState().layers.turbidity).toBe(true);
    expect(flyTo).toHaveBeenCalledTimes(1);
  });

  it("configure:false only records the choice", () => {
    applyPersona("realestate", { mobile: false });
    applyPersona("trader", { configure: false });
    expect(useLens.getState().personaId).toBe("trader");
    expect(useGlobe.getState().layers.realestate).toBe(true);
  });

  it("dismissing steps is idempotent", () => {
    useLens.getState().dismissSteps("water");
    useLens.getState().dismissSteps("water");
    expect(useLens.getState().dismissedSteps).toEqual(["water"]);
  });
});
