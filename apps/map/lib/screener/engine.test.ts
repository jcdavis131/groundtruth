import { describe, expect, it } from "vitest";
import { compareValues, matches, percentileRanks, rank, readValues, screen, sortRows, summarize, test as testCondition, toRows } from "./engine";
import { fieldsFor } from "./fields";
import { parseQuery, type Query } from "./query";
import { countryFeatures, countyFeatures, crossingFeatures, portFeatures } from "./fixtures";

const q = (text: string): Query => {
  const r = parseQuery(text);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.query;
};
const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

describe("test (one condition)", () => {
  it("compares numbers and never matches a missing value except with !=", () => {
    expect(testCondition(5, { field: "x", op: ">", value: 4 })).toBe(true);
    expect(testCondition(5, { field: "x", op: ">=", value: 5 })).toBe(true);
    expect(testCondition(5, { field: "x", op: "<", value: 5 })).toBe(false);
    expect(testCondition(5, { field: "x", op: "<=", value: 5 })).toBe(true);
    expect(testCondition(null, { field: "x", op: ">", value: -1e9 })).toBe(false);
    expect(testCondition(null, { field: "x", op: "<", value: 1e9 })).toBe(false);
    expect(testCondition(null, { field: "x", op: "==", value: 0 })).toBe(false);
    expect(testCondition(null, { field: "x", op: "!=", value: 0 })).toBe(false);
    expect(testCondition(null, { field: "x", op: "between", value: [-1, 1] })).toBe(false);
    expect(testCondition(null, { field: "x", op: "in", value: [1, 2] })).toBe(false);
    expect(testCondition(null, { field: "x", op: "contains", value: "" })).toBe(false);
  });
  it("compares strings case-insensitively; contains is a substring test", () => {
    expect(testCondition("TX", { field: "x", op: "==", value: "tx" })).toBe(true);
    expect(testCondition("TX", { field: "x", op: "!=", value: "tx" })).toBe(false);
    expect(testCondition("TX", { field: "x", op: "in", value: ["ca", "tx"] })).toBe(true);
    expect(testCondition("New York County", { field: "x", op: "contains", value: "york" })).toBe(true);
    expect(testCondition(12, { field: "x", op: "contains", value: "1" })).toBe(false);
  });
  it("between is inclusive and tolerant of reversed bounds; numeric ops need a numeric value", () => {
    expect(testCondition(5, { field: "x", op: "between", value: [5, 10] })).toBe(true);
    expect(testCondition(5, { field: "x", op: "between", value: [10, 5] })).toBe(true);
    expect(testCondition(11, { field: "x", op: "between", value: [5, 10] })).toBe(false);
    expect(testCondition(5, { field: "x", op: ">", value: "abc" })).toBe(false);
    expect(testCondition("5", { field: "x", op: ">", value: 4 })).toBe(false);
  });
});

describe("matches (clauses)", () => {
  const v = { a: 1, b: "x", c: null };
  it("ANDs the top level, evaluates or / and groups, and treats empty groups as true", () => {
    expect(matches(undefined, v)).toBe(true);
    expect(matches([], v)).toBe(true);
    expect(matches([{ field: "a", op: "==", value: 1 }, { field: "b", op: "==", value: "x" }], v)).toBe(true);
    expect(matches([{ field: "a", op: "==", value: 1 }, { field: "b", op: "==", value: "y" }], v)).toBe(false);
    expect(matches([{ or: [{ field: "a", op: "==", value: 2 }, { field: "b", op: "==", value: "x" }] }], v)).toBe(true);
    expect(matches([{ and: [{ field: "a", op: "==", value: 2 }, { field: "b", op: "==", value: "x" }] }], v)).toBe(false);
    expect(matches([{ or: [] }], v)).toBe(true);
    expect(matches([{ field: "missing", op: "==", value: 1 }], v)).toBe(false);
  });
});

describe("sorting", () => {
  it("puts nulls last in both directions and compares strings naturally", () => {
    expect(compareValues(null, 1, "asc")).toBe(1);
    expect(compareValues(null, 1, "desc")).toBe(1);
    expect(compareValues(1, null, "desc")).toBe(-1);
    expect(compareValues(null, null, "asc")).toBe(0);
    expect(compareValues(2, 10, "asc")).toBeLessThan(0);
    expect(compareValues(2, 10, "desc")).toBeGreaterThan(0);
    expect(compareValues("b", "A", "asc")).toBeGreaterThan(0);
    expect(compareValues("item 2", "item 10", "asc")).toBeLessThan(0);
  });
  it("sorts by several keys and ties break on id for determinism", () => {
    const rows = [
      { id: "c", values: { a: 1, b: 2 } },
      { id: "a", values: { a: 1, b: 3 } },
      { id: "b", values: { a: null, b: 1 } },
      { id: "d", values: { a: 1, b: 3 } },
    ];
    expect(sortRows(rows, [{ field: "a", dir: "desc" }, { field: "b", dir: "desc" }]).map((r) => r.id)).toEqual(["a", "d", "c", "b"]);
    expect(sortRows(rows, undefined)).toBe(rows);
  });
});

describe("summarize / percentileRanks", () => {
  it("computes n, min, quartiles, median, max over the numbers present", () => {
    expect(summarize([1, null, 3, "x", 2, 4])).toEqual({ n: 4, min: 1, p25: 1.75, median: 2.5, p75: 3.25, max: 4 });
    expect(summarize([7])).toEqual({ n: 1, min: 7, p25: 7, median: 7, p75: 7, max: 7 });
    expect(summarize([null, "a"])).toBeNull();
  });
  it("ranks with ties at the average rank and leaves nulls null", () => {
    expect(percentileRanks([1, 2, 2, 3])).toEqual([0, 50, 50, 100]);
    expect(percentileRanks([3, null, 1, 2])).toEqual([100, null, 0, 50]);
    expect(percentileRanks([5])).toEqual([100]);
    expect(percentileRanks([null])).toEqual([null]);
    expect(percentileRanks([2, 2])).toEqual([50, 50]);
  });
});

describe("screen over county fixtures", () => {
  const feats = countyFeatures();

  it("reads every registry field into a flat record", () => {
    const rows = toRows(feats, "county", fieldsFor("county"));
    expect(rows).toHaveLength(5);
    const travis = rows.find((r) => r.id === "county:48453")!;
    expect(travis.name).toBe("Travis County, TX");
    expect(travis.geo).toEqual([-97.78, 30.33]);
    expect(travis.layer).toBe("realestate");
    expect(travis.values["home.latest"]).toBe(520_000);
    expect(travis.values.state).toBe("TX");
    expect(Object.keys(travis.values)).toEqual(fieldsFor("county").map((f) => f.key));
  });

  it("filters, sorts and counts; missing values never match", () => {
    const r = screen(feats, q("home.yoyPct > 0 AND jobs.yoy.emp < 0 SORT home.yoyPct DESC"));
    // McKenzie has home +8% but a suppressed QCEW cell: jobs.yoy.emp is null, so it must not match.
    expect(names(r.rows)).toEqual(["Los Angeles County, CA"]);
    expect(r.total).toBe(1);
    expect(r.fieldsUsed).toEqual(["home.yoyPct", "jobs.yoy.emp"]);
  });

  it("applies limit and offset after sorting and reports the full total", () => {
    const r = screen(feats, q("SORT home.latest DESC LIMIT 2 OFFSET 1"));
    expect(names(r.rows)).toEqual(["Los Angeles County, CA", "Travis County, TX"]);
    expect(r.total).toBe(5);
    expect(r.applied).toMatchObject({ limit: 2, offset: 1 });
  });

  it("defaults the limit and clamps oversize limits", () => {
    expect(screen(feats, {}).applied.limit).toBe(100);
    expect(screen(feats, { limit: 99_999 }).applied.limit).toBe(1000);
    expect(screen(feats, { limit: -5 }).rows).toHaveLength(0);
  });

  it("sorts missing values last whichever direction", () => {
    const desc = screen(feats, q("SORT rent.latest DESC"));
    expect(names(desc.rows).at(-1)).toBe("McKenzie County, ND");
    const asc = screen(feats, q("SORT rent.latest ASC"));
    expect(names(asc.rows).at(-1)).toBe("McKenzie County, ND");
    expect(names(asc.rows)[0]).toBe("Bexar County, TX");
  });

  it("handles string filters: ==, in, contains, != skips nulls", () => {
    expect(names(screen(feats, q("state == tx SORT name")).rows)).toEqual(["Bexar County, TX", "Travis County, TX"]);
    expect(names(screen(feats, q("state IN (CA, NY) SORT name")).rows)).toEqual(["Los Angeles County, CA", "New York County, NY"]);
    expect(names(screen(feats, q('name CONTAINS "york"')).rows)).toEqual(["New York County, NY"]);
    // metro is absent for LA, NY and McKenzie: != only matches rows that have one.
    expect(names(screen(feats, q('metro != "Austin-Round Rock-San Marcos, TX"')).rows)).toEqual(["Bexar County, TX"]);
  });

  it("evaluates OR groups and parentheses", () => {
    const r = screen(feats, q("(state == TX OR state == NY) AND home.latest > 400000 SORT name"));
    expect(names(r.rows)).toEqual(["New York County, NY", "Travis County, TX"]);
  });

  it("computes estimates and screens on them", () => {
    const r = screen(feats, q("priceToRent > 0 SORT priceToRent ASC"));
    expect(names(r.rows)[0]).toBe("Bexar County, TX");
    expect(r.rows[0].values.priceToRent).toBeCloseTo(290_000 / (1_400 * 12), 6);
    // McKenzie has only a home term (+8% / 10 = 0.8); New York's four terms average 0.586.
    const m = screen(feats, q("SORT momentum DESC LIMIT 2"));
    expect(names(m.rows)).toEqual(["McKenzie County, ND", "New York County, NY"]);
    expect(m.rows[1].values.momentum).toBeCloseTo(0.586, 2);
  });

  it("summarizes numeric fields over the matched set, not the page", () => {
    const r = screen(feats, q("home.latest > 0 SORT home.latest DESC LIMIT 1"));
    expect(r.rows).toHaveLength(1);
    expect(r.stats["home.latest"]).toMatchObject({ n: 5, min: 260_000, max: 1_200_000, median: 520_000 });
    expect(r.stats["jobs.emp"].n).toBe(4);
    expect(r.stats.name).toBeUndefined();
    expect(r.stats["jobs.suppressed"]).toBeUndefined();
  });

  it("attaches percentile ranks and restricts columns on request", () => {
    const r = screen(feats, q("SORT home.latest DESC"), { percentiles: true, columns: ["name", "home.latest"] });
    expect(Object.keys(r.rows[0].values)).toEqual(["name", "home.latest"]);
    expect(r.rows[0].pct!["home.latest"]).toBe(100);
    expect(r.rows[4].pct!["home.latest"]).toBe(0);
    expect(r.rows[4].pct!["jobs.emp"]).toBeNull();
  });

  it("skips features of another kind and returns nothing for an empty set", () => {
    const mixed = [...feats, ...portFeatures()];
    expect(screen(mixed, {}, { kind: "county" }).total).toBe(5);
    expect(screen(mixed, {}, { kind: "port" }).total).toBe(4);
    expect(screen([], q("a > 1"))).toMatchObject({ rows: [], total: 0, stats: {} });
  });

  it("ranks the top n by one field, excluding gaps", () => {
    const top = rank(feats, "jobs.emp", "desc", 2);
    expect(names(top)).toEqual(["Los Angeles County, CA", "New York County, NY"]);
    expect(rank(feats, "rent.latest", "asc", 10)).toHaveLength(4);
    expect(rank([], "x")).toEqual([]);
  });

  it("tolerates a getter that throws by leaving a gap", () => {
    const broken = { ...feats[0], properties: { ...feats[0].properties, extra: undefined } };
    const v = readValues(broken, fieldsFor("county"));
    expect(v["home.latest"]).toBeNull();
    expect(v.name).toBeNull();
  });
});

describe("screen over other kinds", () => {
  it("ports: BTS fields are gaps where BTS has nothing", () => {
    const r = screen(portFeatures(), q("teu.yoyPct < 0 SORT teu DESC"));
    expect(names(r.rows)).toEqual(["Los Angeles"]);
    const all = screen(portFeatures(), q("SORT teu DESC"));
    expect(names(all.rows).slice(0, 2)).toEqual(["Los Angeles", "Savannah"]);
    expect(all.rows[3].values.teu).toBeNull();
    expect(screen(portFeatures(), q("size == large AND country != 'United States'")).rows.map((r) => r.name)).toEqual(["Rotterdam"]);
  });
  it("crossings: trucks and the people estimate", () => {
    const r = screen(crossingFeatures(), q("trucks > 0 SORT trucks DESC"));
    expect(names(r.rows)).toEqual(["Laredo, TX", "Detroit, MI"]);
    const p = screen(crossingFeatures(), q("SORT people DESC"));
    expect(names(p.rows)[0]).toBe("San Ysidro, CA");
    expect(p.rows[0].values.people).toBe(2_300_000 + 700_000);
  });
  it("countries: balance only when years agree", () => {
    const r = screen(countryFeatures(), q("balance > 0 SORT balance DESC"));
    expect(names(r.rows)).toEqual(["Germany"]);
    const all = screen(countryFeatures(), q("SORT name"));
    expect(all.total).toBe(4);
    expect(all.rows.find((x) => x.name === "Netherlands")!.values.balance).toBeNull();
    expect(all.rows.find((x) => x.name === "United States")!.values.balance).toBe(3.2e12 - 4.1e12);
  });
});
