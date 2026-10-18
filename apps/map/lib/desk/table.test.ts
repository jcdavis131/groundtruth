import { describe, expect, it } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import type { AreaExtra, CrossingExtra, PortExtra } from "@/lib/economy/features";
import { columnsFor, csvCell, featureRow, featureRows, filterRows, fmtCell, nextSort, sortRows, toCsv, toTsv, tsvCell, windowRows, type Column, type Row } from "./table";

const area: AreaExtra = {
  geoid: "48453",
  level: "county",
  name: "Travis County",
  stusab: "TX",
  metro: "Austin-Round Rock",
  home: { id: "48453", name: "Travis", sizeRank: 30, asOf: "2026-07-31", latest: 512_345.6, yoyPct: -1.2, y5Pct: 31.4, monthly: [], yearly: [] },
  rent: { id: "48453", name: "Travis", sizeRank: 30, asOf: "2026-07-31", latest: 1_850.2, yoyPct: 0.4, y5Pct: null, monthly: [], yearly: [] },
  jobs: { area: "48453", period: "2026 Q1", estabs: 45_000, emp: 780_000, wages: null, avgWeeklyWage: 1_600, yoy: { estabs: 1.1, emp: 0.8, wages: null, avgWeeklyWage: 3.2 }, suppressed: false },
};

const areaFeature: LayerFeature = {
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  properties: { id: "48453", layer: "realestate", name: "Travis County", kind: "county", source: "Zillow / BLS", anchor: [-97.7812, 30.3348], extra: area, details: { note: "hello, world", count: "12" } },
};

const port: PortExtra = {
  wpi: { country: "United States", size: "large", locode: "USLAX" } as PortExtra["wpi"],
  stats: { year: 2024, container: { total: 9_600_000, ranking: 1 }, tonnage: { total: null, ranking: null } } as unknown as PortExtra["stats"],
};
const portFeature: LayerFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-118.27, 33.73] },
  properties: { id: "wpi:1", layer: "trade", name: "Los Angeles", kind: "port", source: "WPI / BTS", extra: port },
};

const crossing: CrossingExtra = {
  code: "2304",
  state: "TX",
  border: "US-Mexico",
  asOf: "2026-06",
  measures: { Trucks: { latest: 254_000, latestDate: "2026-06", yoyPct: 2.5, series: [] } },
};
const crossingFeature: LayerFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-99.5, 27.5] },
  properties: { id: "bts:2304", layer: "trade", name: "Laredo", kind: "crossing", source: "BTS", extra: crossing },
};

describe("featureRow", () => {
  it("flattens an area with its joins, rounding money and computing price-to-rent", () => {
    const r = featureRow(areaFeature);
    expect(r.key).toBe("realestate:48453");
    expect(r.cells.geoid).toBe("48453");
    expect(r.cells.zhvi).toBe(512_346);
    expect(r.cells.zori).toBe(1_850);
    expect(r.cells.priceToRent).toBeCloseTo(512_345.6 / (1_850.2 * 12), 2);
    expect(r.cells.jobs).toBe(780_000);
    expect(r.cells.wage1y).toBe(3.2);
    expect(r.cells.suppressed).toBe(false);
    expect(r.cells.lon).toBe(-97.7812);
    // details come after typed cells, numeric strings become numbers
    expect(r.cells.note).toBe("hello, world");
    expect(r.cells.count).toBe(12);
  });
  it("uses the point geometry for coordinates and reads port statistics", () => {
    const r = featureRow(portFeature);
    expect(r.cells.lon).toBe(-118.27);
    expect(r.cells.teu).toBe(9_600_000);
    expect(r.cells.tons).toBeNull();
    expect(r.cells.locode).toBe("USLAX");
  });
  it("reads crossing truck counts", () => {
    const r = featureRow(crossingFeature);
    expect(r.cells.trucks).toBe(254_000);
    expect(r.cells.trucks1y).toBe(2.5);
    expect(r.cells.border).toBe("US-Mexico");
  });
  it("never invents a join: missing home/rent/jobs stay null", () => {
    const r = featureRow({ ...areaFeature, properties: { ...areaFeature.properties, extra: { geoid: "01001", level: "county", name: "x" } as AreaExtra } });
    expect(r.cells.zhvi).toBeNull();
    expect(r.cells.jobs).toBeNull();
    expect(r.cells.priceToRent).toBeNull();
  });
});

describe("columnsFor", () => {
  it("types columns by their values, keeps first-seen order and drops empty ones", () => {
    const rows = featureRows([areaFeature, portFeature, crossingFeature]);
    const cols = columnsFor(rows);
    const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
    expect(cols[0].key).toBe("layer");
    expect(byKey.zhvi.kind).toBe("number");
    expect(byKey.zhvi.unit).toBe("USD");
    expect(byKey.zhvi.label).toBe("Home value");
    expect(byKey.suppressed.kind).toBe("boolean");
    expect(byKey.name.kind).toBe("string");
    expect(byKey.tons).toBeUndefined(); // every row null
    expect(byKey.note.label).toBe("Note");
  });
  it("labels unknown camelCase and snake_case keys", () => {
    const cols = columnsFor([{ key: "a", layer: "trade", id: "1", cells: { avgWeeklyWage: 1, total_tons: 2 } }]);
    expect(cols.map((c) => c.label)).toEqual(["Avg weekly wage", "Total tons"]);
  });
});

const cols: Column[] = [
  { key: "name", label: "Name", kind: "string" },
  { key: "v", label: "Value", unit: "USD", kind: "number" },
  { key: "b", label: "Flag", kind: "boolean" },
];
const rows: Row[] = [
  { key: "1", layer: "trade", id: "1", cells: { name: "b", v: 10, b: true } },
  { key: "2", layer: "trade", id: "2", cells: { name: "a", v: null, b: false } },
  { key: "3", layer: "trade", id: "3", cells: { name: "item 10", v: 2, b: null } },
  { key: "4", layer: "trade", id: "4", cells: { name: "item 9", v: 2, b: true } },
];

describe("sortRows", () => {
  it("sorts numbers with nulls last in both directions and is stable", () => {
    expect(sortRows(rows, { key: "v", dir: "asc" }, cols).map((r) => r.key)).toEqual(["3", "4", "1", "2"]);
    expect(sortRows(rows, { key: "v", dir: "desc" }, cols).map((r) => r.key)).toEqual(["1", "3", "4", "2"]);
  });
  it("sorts strings naturally (item 9 before item 10)", () => {
    expect(sortRows(rows, { key: "name", dir: "asc" }, cols).map((r) => r.cells.name)).toEqual(["a", "b", "item 9", "item 10"]);
  });
  it("sorts booleans and leaves rows alone without a sort or with an unknown key", () => {
    expect(sortRows(rows, { key: "b", dir: "desc" }, cols).map((r) => r.key)).toEqual(["1", "4", "2", "3"]);
    expect(sortRows(rows, null, cols)).toBe(rows);
    expect(sortRows(rows, { key: "zzz", dir: "asc" }, cols)).toBe(rows);
  });
  it("cycles asc → desc → off", () => {
    expect(nextSort(null, "v")).toEqual({ key: "v", dir: "asc" });
    expect(nextSort({ key: "v", dir: "asc" }, "v")).toEqual({ key: "v", dir: "desc" });
    expect(nextSort({ key: "v", dir: "desc" }, "v")).toBeNull();
    expect(nextSort({ key: "v", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });
});

describe("filterRows", () => {
  it("matches any cell, case-insensitively, and returns everything for a blank query", () => {
    expect(filterRows(rows, "ITEM").map((r) => r.key)).toEqual(["3", "4"]);
    expect(filterRows(rows, "10").map((r) => r.key)).toEqual(["1", "3"]);
    expect(filterRows(rows, "  ")).toBe(rows);
  });
});

describe("windowRows", () => {
  it("renders the visible rows plus overscan and pads the rest", () => {
    const w = windowRows(1000, 2000, 20, 400, 5);
    expect(w.start).toBe(95);
    expect(w.end).toBe(126);
    expect(w.padTop).toBe(95 * 20);
    expect(w.padBottom).toBe((1000 - 126) * 20);
  });
  it("clamps at both ends and handles empty lists", () => {
    expect(windowRows(10, -50, 20, 400)).toEqual({ start: 0, end: 10, padTop: 0, padBottom: 0 });
    expect(windowRows(0, 0, 20, 400)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
    expect(windowRows(10, 0, 0, 400).end).toBe(0);
  });
});

describe("CSV / TSV", () => {
  it("quotes commas, quotes and newlines in CSV", () => {
    expect(csvCell('say "hi", now')).toBe('"say ""hi"", now"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(1.5)).toBe("1.5");
    expect(csvCell(true)).toBe("true");
  });
  it("collapses tabs and newlines in TSV", () => {
    expect(tsvCell("a\tb\nc")).toBe("a b c");
    expect(tsvCell(null)).toBe("");
  });
  it("writes a header with units and one line per row", () => {
    const csv = toCsv(cols, rows.slice(0, 2));
    expect(csv.split("\n")).toEqual(["Name,Value (USD),Flag", "b,10,true", "a,,false"]);
    const tsv = toTsv(cols, rows.slice(0, 1));
    expect(tsv).toBe("Name\tValue (USD)\tFlag\nb\t10\ttrue");
  });
});

describe("fmtCell", () => {
  it("formats numbers, booleans and nulls for display", () => {
    expect(fmtCell(1234567, "number")).toBe("1,234,567");
    expect(fmtCell(12.345, "number")).toBe("12.35");
    expect(fmtCell(1234.5, "number")).toBe("1,235");
    expect(fmtCell(null, "number")).toBe("—");
    expect(fmtCell(true, "boolean")).toBe("yes");
    expect(fmtCell("x", "string")).toBe("x");
  });
});

describe("featureRows and map furniture", () => {
  it("leaves out the dashed outline of the box a land layer loaded", () => {
    const box = { type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { id: "flood:loaded-box", layer: "flood" as const, name: "Loaded area", kind: "loaded-box", source: "this app" } };
    expect(featureRows([areaFeature, box]).map((r) => r.key)).toEqual([`${areaFeature.properties.layer}:${areaFeature.properties.id}`]);
  });
});
