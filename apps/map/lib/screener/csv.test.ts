import { describe, expect, it } from "vitest";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { csvCell, csvHeader, screenCsv } from "./csv";
import { screen } from "./engine";
import { fieldMeta } from "./fields";
import { parseQuery } from "./query";
import { countyFeatures } from "./fixtures";
import { screenProvenance } from "./entities";

const q = (t: string) => {
  const r = parseQuery(t);
  if (!r.ok) throw new Error("bad query");
  return r.query;
};

describe("csv cells and headers", () => {
  it("quotes commas, quotes and newlines like lib/explore/export.ts", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
  });
  it("puts the unit and the estimate tag in the header", () => {
    const meta = fieldMeta("county");
    expect(csvHeader("home.latest", meta.find((m) => m.key === "home.latest"))).toBe("home.latest (USD)");
    expect(csvHeader("home.yoyPct", meta.find((m) => m.key === "home.yoyPct"))).toBe("home.yoyPct (%)");
    expect(csvHeader("momentum", meta.find((m) => m.key === "momentum"))).toBe("momentum (index −1..1, estimate)");
    expect(csvHeader("name", meta.find((m) => m.key === "name"))).toBe("name");
    expect(csvHeader("unknown", undefined)).toBe("unknown");
  });
});

describe("screenCsv", () => {
  const feats = countyFeatures();
  const meta = fieldMeta("county");
  const prov = screenProvenance("county", { retrievedAt: "2026-09-11T10:00:00.000Z", periods: { "bls-qcew": "2026 Q1", "zillow-zhvi": "2026-07-31" } });

  it("writes a header with units, one row per entity, and a provenance footer", () => {
    const r = screen(feats, q("SORT home.latest DESC LIMIT 2"), { columns: ["name", "state", "home.latest", "home.yoyPct", "priceToRent"] });
    const text = screenCsv(r.rows, meta, prov, { retrievedAt: "2026-09-11T10:00:00.000Z", query: "SORT home.latest DESC LIMIT 2" });
    const lines = text.split("\n");
    // The estimate header carries a comma, so it is quoted like any other cell.
    expect(lines[0]).toBe('id,kind,name,lon,lat,name,state,home.latest (USD),home.yoyPct (%),"priceToRent (ratio, estimate)"');
    expect(lines[1]).toBe('county:36061,county,"New York County, NY",-73.97,40.78,New York County,NY,1200000,6,26.315789');
    expect(lines[2].startsWith("county:06037,county,")).toBe(true);
    const footer = lines.slice(3);
    expect(footer.every((l) => l.startsWith("#"))).toBe(true);
    expect(footer[0]).toBe("# Embedding Atlas screener export, 2 rows, retrieved 2026-09-11T10:00:00.000Z");
    expect(footer[1]).toBe("# query: SORT home.latest DESC LIMIT 2");
    expect(footer.some((l) => l.includes("U.S. Bureau of Labor Statistics") && l.includes("period 2026 Q1") && l.includes("accessed 2026-09-11"))).toBe(true);
    expect(footer.some((l) => l.includes("Zillow Research") && l.includes("period 2026-07-31"))).toBe(true);
    expect(footer.some((l) => l.startsWith("# estimate priceToRent: typical home value / (typical rent × 12)"))).toBe(true);
    expect(footer.some((l) => l.startsWith("# estimate momentum"))).toBe(false);
    expect(footer.at(-1)).toContain("nothing is imputed");
  });

  it("writes empty cells for gaps and percentile columns when asked", () => {
    const r = screen(feats, q("state == ND"), { percentiles: true, columns: ["name", "jobs.emp", "home.yoyPct"] });
    const text = screenCsv(r.rows, meta, [], { percentiles: true, retrievedAt: "2026-09-11T10:00:00.000Z" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("id,kind,name,lon,lat,name,jobs.emp (jobs),home.yoyPct (%),jobs.emp.pct (percentile 0-100),home.yoyPct.pct (percentile 0-100)");
    expect(lines[1]).toBe('county:38053,county,"McKenzie County, ND",-103.4,47.74,McKenzie County,,8,,100');
  });

  it("prints a header and footer even with no rows, and dedupes identical sources", () => {
    const p = provenance(source("nga-wpi"), { kind: "published", retrievedAt: "2026-09-11T10:00:00.000Z" });
    const text = screenCsv([], fieldMeta("port").slice(0, 3), [p, p], { retrievedAt: "2026-09-11T10:00:00.000Z" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("id,kind,name,lon,lat,name,country,region");
    expect(lines.filter((l) => l.startsWith("# source:"))).toHaveLength(1);
    expect(lines[1]).toContain("0 rows");
  });

  it("defaults columns to the keys of the first row", () => {
    const r = screen(feats, q("LIMIT 1"), { columns: ["name", "geoid"] });
    const text = screenCsv(r.rows, meta, []);
    expect(text.split("\n")[0]).toBe("id,kind,name,lon,lat,name,geoid");
  });
});
