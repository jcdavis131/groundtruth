import { describe, expect, it } from "vitest";
import { citation, provenance } from "./types";
import { source } from "./sources";

describe("citation", () => {
  it("prints publisher, series, period, url and access date", () => {
    const p = provenance(source("fred"), { kind: "published", seriesId: "MORTGAGE30US", period: "2026-09-04", retrievedAt: "2026-09-11T10:00:00Z" });
    const c = citation(p);
    expect(c).toContain("Federal Reserve Bank of St. Louis");
    expect(c).toContain("series MORTGAGE30US");
    expect(c).toContain("accessed 2026-09-11");
    expect(c).toContain("https://fred.stlouisfed.org/");
  });
  it("marks estimates", () => {
    const p = provenance(source("zillow-zhvi"), { kind: "estimate", method: "x / y", retrievedAt: "2026-09-11T10:00:00Z" });
    expect(citation(p)).toContain("estimate computed by Embedding Atlas: x / y");
  });
});
