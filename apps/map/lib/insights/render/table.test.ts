// The data table, CSV and description: every row of the spec, "not
// published" where a value is null, full citations with full URLs, and no
// wall clock anywhere.

import { describe, expect, it } from "vitest";
import { MISSING } from "@/lib/brief/format";
import FIXTURE from "./fixtures/qcew-metro-job-growth-2019-2023.json";
import { parseChartSpec, type BubbleSpec } from "./spec";
import { chartTable, citations, describe as describeChart, missingIds } from "./table";

const SPEC = parseChartSpec(FIXTURE) as BubbleSpec;

describe("chartTable", () => {
  const t = chartTable(SPEC);

  it("lists every row, plotted or not, with null as 'not published'", () => {
    expect(t.rows.length).toBe(150);
    expect(t.columns.map((c) => c.label)).toEqual(["Name", SPEC.x.label, SPEC.y.label, SPEC.size.label]);
    expect(t.missing.length).toBe(36);
    expect(missingIds(SPEC).length).toBe(36);
    const unplotted = t.rows.filter((r) => r.cells.includes(MISSING));
    expect(unplotted.length).toBe(36);
    // A published zero prints as a value; only a null prints "not published".
    expect(t.rows.find((r) => r.key === "C1146")?.cells[1]).toBe("+0.0%");
    const austin = t.rows.find((r) => r.key === "C1242");
    expect(austin?.cells).toEqual(["Austin-Round Rock-San Marcos, TX", "+35.6%", "+18.7%", "187,324"]);
  });

  it("cites every record in full, with its exact upstream URL", () => {
    expect(t.citations.length).toBe(14);
    expect(citations(SPEC)).toEqual(t.citations);
    expect(t.citations.filter((c) => c.includes("https://data.bls.gov/cew/data/api/")).length).toBe(12);
    expect(t.citations.filter((c) => c.includes("estimate computed by Embedding Atlas: ")).length).toBe(2);
  });

  it("writes an RFC 4180 CSV with raw numbers, empty cells for nulls and an as_of footer instead of a clock", () => {
    const lines = t.csv.split("\r\n");
    expect(lines[0]).toBe('id,Name,"Finance and professional services jobs, change 2019 to 2023","Goods-producing jobs, change 2019 to 2023","change in total covered jobs, 2019 to 2023"');
    const austin = lines.find((l) => l.startsWith("C1242,"));
    expect(austin).toBe('C1242,"Austin-Round Rock-San Marcos, TX",35.64808677312443,18.684712716794017,187324');
    expect(lines.filter((l) => /^C\d{4},/.test(l)).length).toBe(150);
    expect(t.csv).toContain("# as_of: 2026-10-01");
    expect(t.csv).not.toContain("generated_at");
    expect(t.csv.endsWith("\r\n")).toBe(true);
    expect(chartTable(SPEC).csv).toBe(t.csv);
  });

  it("captions the table with the universe and the published count", () => {
    expect(t.caption).toBe("The 150 largest metropolitan areas by 2019 total covered employment, Puerto Rico included. 114 of 150 with published figures.");
  });
});

describe("describe", () => {
  it("states the encodings, the counts and the subject from a fixed template", () => {
    expect(describeChart(SPEC)).toBe(
      `Bubble chart. Horizontal: ${SPEC.x.label}. Vertical: ${SPEC.y.label}. Bubble area: ${SPEC.size.label}; an outlined bubble is a negative value. ` +
        "114 of 150 plotted; 36 not published. Austin-Round Rock-San Marcos, TX: +35.6% horizontal, +18.7% vertical, 187,324 bubble. Full data in the table below.",
    );
  });
});
