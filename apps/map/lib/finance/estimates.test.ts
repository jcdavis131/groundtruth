import { describe, expect, it } from "vitest";
import { hhi, hhiLabel, marketShares, perJob, sharePct } from "./estimates";
import type { SodRow } from "./types";

function sod(cert: number, name: string, brnum: number, deposits: number | null): SodRow {
  return { cert, name, brnum, uninum: null, deposits, assets: null, fips: "48453", county: "Travis", state: "TX", year: 2025, lat: null, lon: null, cbsa: null, cbsaName: null };
}

describe("marketShares", () => {
  it("sums $ thousands by institution into dollars, counts offices and ranks by deposits", () => {
    const rows = [sod(1, "A", 0, 600), sod(1, "A", 1, 400), sod(2, "B", 0, 800), sod(3, "C", 0, 200)];
    const s = marketShares(rows);
    expect(s.map((x) => x.cert)).toEqual([1, 2, 3]);
    expect(s[0]).toMatchObject({ deposits: 1_000_000, branches: 2, sharePct: 50 });
    expect(s[1]).toMatchObject({ deposits: 800_000, branches: 1, sharePct: 40 });
    expect(s[2].sharePct).toBeCloseTo(10);
  });
  it("counts an office whose deposits were withheld without adding to the total", () => {
    const s = marketShares([sod(1, "A", 0, 500), sod(1, "A", 1, null)]);
    expect(s[0]).toMatchObject({ deposits: 500_000, branches: 2, sharePct: 100 });
  });
  it("gives every bank 0% when no deposits are published", () => {
    const s = marketShares([sod(1, "A", 0, null), sod(2, "B", 0, null)]);
    expect(s.every((x) => x.sharePct === 0)).toBe(true);
    expect(s.map((x) => x.name)).toEqual(["A", "B"]);
  });
  it("returns nothing for no rows", () => {
    expect(marketShares([])).toEqual([]);
  });
});

describe("hhi", () => {
  it("is 10,000 for a monopoly and 2,500 for four equal banks", () => {
    expect(hhi(marketShares([sod(1, "A", 0, 100)]))!.value).toBeCloseTo(10_000);
    const four = hhi(marketShares([sod(1, "A", 0, 100), sod(2, "B", 0, 100), sod(3, "C", 0, 100), sod(4, "D", 0, 100)]))!;
    expect(four.value).toBeCloseTo(2_500);
    expect(four.label).toBe("highly concentrated");
    expect(four.banks).toBe(4);
    expect(four.formula).toContain("Σ (share %)²");
    expect(four.formula).toContain("2,500");
  });
  it("ignores banks with no deposits and returns null when nobody has any", () => {
    const shares = marketShares([sod(1, "A", 0, 100), sod(2, "B", 0, null)]);
    expect(hhi(shares)!.banks).toBe(1);
    expect(hhi(marketShares([sod(1, "A", 0, null)]))).toBeNull();
    expect(hhi([])).toBeNull();
  });
  it("mentions how many banks were folded into the ellipsis", () => {
    const rows = Array.from({ length: 6 }, (_, i) => sod(i + 1, `B${i}`, 0, 100));
    expect(hhi(marketShares(rows))!.formula).toContain("(3 more)");
  });
  it("labels on the DOJ 1995 thresholds", () => {
    expect(hhiLabel(999)).toBe("unconcentrated");
    expect(hhiLabel(1000)).toBe("moderately concentrated");
    expect(hhiLabel(1800)).toBe("moderately concentrated");
    expect(hhiLabel(1801)).toBe("highly concentrated");
  });
});

describe("perJob", () => {
  it("divides obligations by jobs and prints the arithmetic", () => {
    const p = perJob(250_000_000, 500_000, "2026 Q1", 2025)!;
    expect(p.value).toBe(500);
    expect(p.jobs).toBe(500_000);
    expect(p.formula).toContain("FY2025");
    expect(p.formula).toContain("$250.0 m");
    expect(p.formula).toContain("2026 Q1");
    expect(p.formula).toContain("= $500");
  });
  it("is null without obligations, without jobs, or with zero jobs", () => {
    expect(perJob(null, 100, "2026 Q1", 2025)).toBeNull();
    expect(perJob(100, null, "2026 Q1", 2025)).toBeNull();
    expect(perJob(100, 0, "2026 Q1", 2025)).toBeNull();
    expect(perJob(Number.NaN, 10, "2026 Q1", 2025)).toBeNull();
  });
});

describe("sharePct", () => {
  it("is a percent of the total or null", () => {
    expect(sharePct(25, 100)).toBe(25);
    expect(sharePct(25, 0)).toBeNull();
    expect(sharePct(null, 100)).toBeNull();
    expect(sharePct(25, null)).toBeNull();
  });
});
