import { describe, expect, it } from "vitest";
import { clampLimit, isSeriesMeta, listSeries, readSeries, seriesToCsv } from "./read";
import { memoryStore } from "./store";
import type { SeriesMeta, SeriesStore } from "./types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";

const meta = (id: string): SeriesMeta => ({ id, title: id, unit: "count", frequency: "irregular", provenance: provenance(source("gev-snapshot"), { kind: "snapshot", retrievedAt: "2026-09-11T00:00:00.000Z" }) });
const day = (d: number, h: number) => Date.UTC(2026, 8, d, h);

async function seeded() {
  const store = memoryStore();
  await store.append(meta("snapshot:a"), [
    { t: day(1, 3), v: 1 },
    { t: day(1, 15), v: 3 },
    { t: day(2, 3), v: 5 },
    { t: day(3, 3), v: null },
  ]);
  await store.append(meta("snapshot:b"), [{ t: day(1, 0), v: 9 }]);
  await store.append(meta("other:c"), [{ t: day(1, 0), v: 9 }]);
  return store;
}

describe("readSeries", () => {
  it("returns sample cadence by default and null for unknown ids", async () => {
    const store = await seeded();
    const s = await readSeries(store, "snapshot:a");
    expect(s?.points).toHaveLength(4);
    expect(s?.available).toBe(4);
    expect(s?.rollup).toBeUndefined();
    expect(await readSeries(store, "snapshot:zzz")).toBeNull();
  });
  it("applies the window before the roll-up and the limit after", async () => {
    const store = await seeded();
    const s = await readSeries(store, "snapshot:a", { from: day(1, 10), rollup: "daily-mean" });
    expect(s?.points).toEqual([
      { t: day(1, 0), v: 3 },
      { t: day(2, 0), v: 5 },
      { t: day(3, 0), v: null },
    ]);
    const capped = await readSeries(store, "snapshot:a", { rollup: "daily-max", limit: 2 });
    expect(capped?.points.map((p) => p.t)).toEqual([day(2, 0), day(3, 0)]);
    expect(capped?.available).toBe(3);
    const last = await readSeries(store, "snapshot:a", { rollup: "daily-last", to: day(1, 12) });
    expect(last?.points).toEqual([{ t: day(1, 0), v: 1 }]);
  });
  it("clamps limits", () => {
    expect(clampLimit(undefined)).toBe(5000);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(1e9)).toBe(50_000);
    expect(clampLimit(2.9)).toBe(2);
    expect(clampLimit(NaN)).toBe(5000);
  });
});

describe("listSeries", () => {
  it("filters by prefix, sorts, and drops non-series entries such as index.json", async () => {
    const store = await seeded();
    expect((await listSeries(store, "snapshot:")).map((m) => m.id)).toEqual(["snapshot:a", "snapshot:b"]);
    expect((await listSeries(store)).map((m) => m.id)).toEqual(["other:c", "snapshot:a", "snapshot:b"]);
    const messy: SeriesStore = {
      ...store,
      list: async () => [meta("snapshot:z"), [] as unknown as SeriesMeta, { id: 3 } as unknown as SeriesMeta, meta("snapshot:y")],
    };
    expect((await listSeries(messy)).map((m) => m.id)).toEqual(["snapshot:y", "snapshot:z"]);
  });
  it("isSeriesMeta", () => {
    expect(isSeriesMeta(meta("x:y"))).toBe(true);
    expect(isSeriesMeta(null)).toBe(false);
    expect(isSeriesMeta([meta("x:y")])).toBe(false);
    expect(isSeriesMeta({ id: "x" })).toBe(false);
  });
});

describe("seriesToCsv", () => {
  it("writes one long row per point with ISO times and empty cells for null", () => {
    const csv = seriesToCsv([
      { ...meta("snapshot:a"), points: [{ t: day(1, 3), v: 1.5 }, { t: day(2, 0), v: null }] },
      { ...meta('weird,"id"'), points: [{ t: day(1, 0), v: 2 }] },
    ]);
    expect(csv.split("\n")).toEqual(["series_id,t_iso,value", "snapshot:a,2026-09-01T03:00:00.000Z,1.5", "snapshot:a,2026-09-02T00:00:00.000Z,", '"weird,""id""",2026-09-01T00:00:00.000Z,2', ""]);
  });
  it("is header-only for no series", () => {
    expect(seriesToCsv([])).toBe("series_id,t_iso,value\n");
  });
});
