import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory localStorage so zustand/persist has somewhere to write.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
  // zustand/persist reads window.localStorage; no location or history here, so the URL sync is a no-op.
  vi.stubGlobal("window", { localStorage: storage, innerWidth: 1600 });
  vi.resetModules();
});

async function load() {
  const desk = await import("./store");
  const chart = await import("./chart");
  const settings = await import("@/lib/store/settings");
  return { ...desk, SERIES_COLORS: chart.SERIES_COLORS, useSettings: settings.useSettings };
}

describe("parseDeskMode / withDeskParam", () => {
  it("reads ?mode=desk and ?mode=hud, ignores others", async () => {
    const { parseDeskMode } = await load();
    expect(parseDeskMode("?mode=desk")).toBe("desk");
    expect(parseDeskMode("mode=hud&lat=1")).toBe("hud");
    expect(parseDeskMode("?mode=other")).toBeNull();
    expect(parseDeskMode("")).toBeNull();
  });
  it("adds and removes mode=desk without disturbing other params or the hash", async () => {
    const { withDeskParam } = await load();
    expect(withDeskParam("/", "desk")).toBe("/?mode=desk");
    expect(withDeskParam("/?lat=1&lon=2#x", "desk")).toBe("/?lat=1&lon=2&mode=desk#x");
    expect(withDeskParam("/?lat=1&mode=desk&lon=2", "hud")).toBe("/?lat=1&lon=2");
    expect(withDeskParam("/?mode=desk", "hud")).toBe("/");
    expect(withDeskParam("/?mode=desk", "desk")).toBe("/?mode=desk");
  });
});

describe("clampPane", () => {
  it("keeps the pane between 360 px and 60 % of the window", async () => {
    const { clampPane } = await load();
    expect(clampPane(100, 1600)).toBe(360);
    expect(clampPane(5000, 1600)).toBe(960);
    expect(clampPane(500.4, 1600)).toBe(500);
    expect(clampPane(NaN, 1600)).toBe(560);
  });
  it("never lets the max fall under the min on a narrow window", async () => {
    const { clampPane } = await load();
    expect(clampPane(9999, 400)).toBe(360);
  });
});

describe("mode and drift", () => {
  it("turns cinematic drift off on entering desk and restores it on exit", async () => {
    const { useDesk, useSettings } = await load();
    useSettings.getState().setPref("cinematic", true);
    useDesk.getState().setMode("desk");
    expect(useDesk.getState().mode).toBe("desk");
    expect(useSettings.getState().prefs.cinematic).toBe(false);
    expect(useDesk.getState().savedCinematic).toBe(true);
    useDesk.getState().setMode("hud");
    expect(useSettings.getState().prefs.cinematic).toBe(true);
    expect(useDesk.getState().savedCinematic).toBeNull();
  });
  it("does not re-enable drift the operator had already turned off", async () => {
    const { useDesk, useSettings } = await load();
    useSettings.getState().setPref("cinematic", false);
    useDesk.getState().toggleMode();
    expect(useDesk.getState().mode).toBe("desk");
    useDesk.getState().toggleMode();
    expect(useDesk.getState().mode).toBe("hud");
    expect(useSettings.getState().prefs.cinematic).toBe(false);
  });
  it("setting the same mode twice is a no-op", async () => {
    const { useDesk, useSettings } = await load();
    useSettings.getState().setPref("cinematic", true);
    useDesk.getState().setMode("desk");
    useDesk.getState().setMode("desk");
    expect(useDesk.getState().savedCinematic).toBe(true);
    expect(useSettings.getState().prefs.cinematic).toBe(false);
  });
});

describe("persistence", () => {
  it("persists mode, theme, tab, pane width, series and notes under gev:desk and reads them back", async () => {
    const first = await load();
    first.useDesk.getState().setMode("desk");
    first.useDesk.getState().setTheme("dark");
    first.useDesk.getState().setTab("notes");
    first.useDesk.getState().setPaneWidth(700);
    first.useDesk.getState().addSeries({ id: "fred:MORTGAGE30US", label: "30-yr mortgage", source: "series" });
    first.useDesk.getState().setNotes("hello");
    const raw = storage.getItem("gev:desk");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state.mode).toBe("desk");
    expect(parsed.state.notes).toBe("hello");

    vi.resetModules();
    const second = await load();
    const s = second.useDesk.getState();
    expect(s.mode).toBe("desk");
    expect(s.theme).toBe("dark");
    expect(s.tab).toBe("notes");
    expect(s.paneWidth).toBe(700);
    expect(s.series).toHaveLength(1);
    expect(s.series[0].color).toBe(second.SERIES_COLORS[0]);
    expect(s.notes).toBe("hello");
  });
  it("sanitises junk in storage", async () => {
    storage.setItem("gev:desk", JSON.stringify({ state: { mode: "weird", theme: 3, tab: "nope", series: [{ nope: 1 }, { id: "a", label: "A", color: "#000", source: "series" }], notes: 12 }, version: 1 }));
    const { useDesk } = await load();
    const s = useDesk.getState();
    expect(s.mode).toBe("hud");
    expect(s.theme).toBe("light");
    expect(s.tab).toBe("table");
    expect(s.series).toEqual([{ id: "a", label: "A", color: "#000", source: "series" }]);
    expect(s.notes).toBe("");
  });
});

describe("series list", () => {
  it("dedupes by id, caps the count and hands out unused colours", async () => {
    const { useDesk, SERIES_MAX, SERIES_COLORS } = await load();
    const st = useDesk.getState();
    st.addSeries({ id: "a", label: "A", source: "series" });
    st.addSeries({ id: "a", label: "A again", source: "series" });
    st.addSeries({ id: "b", label: "B", source: "indicator", color: SERIES_COLORS[0] });
    st.addSeries({ id: "c", label: "C", source: "history" });
    const list = useDesk.getState().series;
    expect(list.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(list[2].color).toBe(SERIES_COLORS[1]);
    for (let i = 0; i < SERIES_MAX + 3; i++) useDesk.getState().addSeries({ id: `x${i}`, label: "x", source: "series" });
    expect(useDesk.getState().series.length).toBe(SERIES_MAX);
    useDesk.getState().removeSeries("a");
    expect(useDesk.getState().series.some((x) => x.id === "a")).toBe(false);
    useDesk.getState().setSeriesColor("b", "#123456");
    expect(useDesk.getState().series.find((x) => x.id === "b")?.color).toBe("#123456");
    useDesk.getState().clearSeries();
    expect(useDesk.getState().series).toEqual([]);
  });
  it("caps notes length", async () => {
    const { useDesk, NOTES_MAX_CHARS } = await load();
    useDesk.getState().setNotes("x".repeat(NOTES_MAX_CHARS + 10));
    expect(useDesk.getState().notes.length).toBe(NOTES_MAX_CHARS);
  });
});

describe("initDeskFromUrl", () => {
  it("URL wins over the persisted mode", async () => {
    const { useDesk, initDeskFromUrl } = await load();
    expect(initDeskFromUrl("?mode=desk")).toBe("desk");
    expect(useDesk.getState().mode).toBe("desk");
    expect(initDeskFromUrl("?mode=hud")).toBe("hud");
    expect(initDeskFromUrl("?lat=1")).toBe("hud");
  });
});
