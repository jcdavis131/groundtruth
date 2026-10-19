import { describe, expect, it } from "vitest";
import { citeReport, notesMarkdown, type ReportCite } from "./notes";

const market: ReportCite = {
  title: "Market report",
  place: "Travis County",
  generatedAt: Date.UTC(2026, 8, 11, 10, 5),
  sections: [
    { title: "Home values", basis: "Zillow ZHVI, county, 2026-07", loaded: true },
    { title: "Trade gateways", basis: "off", loaded: false },
  ],
  caveats: ["QCEW suppressed one cell"],
};

describe("citeReport", () => {
  it("lists loaded sections and caveats under the report line", () => {
    expect(citeReport(market)).toEqual([
      "- **Market report**, Travis County, generated 2026-09-11 10:05Z",
      "  - Home values: Zillow ZHVI, county, 2026-07",
      "  - Caveat: QCEW suppressed one cell",
    ]);
  });
});

describe("notesMarkdown", () => {
  const now = Date.UTC(2026, 8, 11, 12, 0);
  it("is just heading, link and text when nothing else is open", () => {
    const md = notesMarkdown({ notes: "  hello  ", url: "https://x/?lat=1&mode=desk", now });
    expect(md).toBe(["# Embedding Atlas notes", "", "_2026-09-11 12:00Z · [permalink](https://x/?lat=1&mode=desk)_", "", "hello", "", "---", "Aggregates only; estimates print their arithmetic. No data about private individuals.", ""].join("\n"));
  });
  it("adds data and source sections when present", () => {
    const md = notesMarkdown({ notes: "", url: "u", now, reports: [market], series: [{ label: "Rate", id: "fred:MORTGAGE30US", source: "series" }] });
    expect(md).toContain("## Data on the chart\n\n- Rate (`fred:MORTGAGE30US`, series)");
    expect(md).toContain("## Sources of the open reports\n\n- **Market report**");
    expect(md).not.toContain("Trade gateways");
  });
});
