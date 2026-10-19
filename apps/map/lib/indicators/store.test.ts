import { afterEach, describe, expect, it, vi } from "vitest";
import { LATEST_URL, useIndicators, visibleItems } from "./store";
import type { IndicatorResult } from "./service";
import { evaluate } from "./evaluate";
import { indicatorMeta } from "./types";
import { indicatorById } from "./registry";

function item(id: string): IndicatorResult {
  const ind = indicatorById(id)!;
  return { meta: indicatorMeta(ind), evaluation: evaluate(ind, { points: [{ t: 1, v: 1 }] }) };
}

const water = item("mississippi-memphis-stage");
const macro = item("retail-sales");

afterEach(() => {
  vi.unstubAllGlobals();
  useIndicators.setState({ open: false, category: "all", data: null, generatedAt: null, caveats: [], loading: false, error: null });
});

describe("indicators store", () => {
  it("toggles and filters", () => {
    useIndicators.getState().toggle();
    expect(useIndicators.getState().open).toBe(true);
    useIndicators.getState().setOpen(false);
    expect(useIndicators.getState().open).toBe(false);
    useIndicators.getState().setCategory("water");
    expect(useIndicators.getState().category).toBe("water");
    expect(visibleItems([water, macro], "water")).toEqual([water]);
    expect(visibleItems([water, macro], "all")).toHaveLength(2);
    expect(visibleItems(null, "all")).toEqual([]);
  });
  it("refresh stores items, time and caveats", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { items: [water, macro] }, provenance: [], generatedAt: "2026-09-11T10:00:00.000Z", caveats: ["c"] }) }));
    vi.stubGlobal("fetch", fetchMock);
    await useIndicators.getState().refresh();
    const s = useIndicators.getState();
    expect(fetchMock).toHaveBeenCalledWith(LATEST_URL);
    expect(s.data?.map((i) => i.meta.id)).toEqual(["mississippi-memphis-stage", "retail-sales"]);
    expect(s.generatedAt).toBe("2026-09-11T10:00:00.000Z");
    expect(s.caveats).toEqual(["c"]);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });
  it("refresh keeps old data and records the error on failure", async () => {
    useIndicators.setState({ data: [water] });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: "fred 503" }) })));
    await useIndicators.getState().refresh();
    expect(useIndicators.getState().error).toBe("fred 503");
    expect(useIndicators.getState().data).toEqual([water]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await useIndicators.getState().refresh();
    expect(useIndicators.getState().error).toBe("network down");
    expect(useIndicators.getState().loading).toBe(false);
  });
});
