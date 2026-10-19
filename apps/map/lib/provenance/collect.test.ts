import { describe, expect, it } from "vitest";
import { citationsOf, dedupeProvenance, iso, monthPeriod, provenanceKey, quarterPeriod } from "./collect";
import { provenance } from "./types";
import { source } from "./sources";

const at = "2026-09-11T10:00:00.000Z";
const a = provenance(source("bls-qcew"), { kind: "published", period: "2026-Q1", retrievedAt: at });
const aAgain = provenance(source("bls-qcew"), { kind: "published", period: "2026-Q1", retrievedAt: "2026-09-11T11:00:00.000Z", notes: ["later"] });
const b = provenance(source("bls-qcew"), { kind: "published", period: "2025-Q4", retrievedAt: at });
const est = provenance(source("bls-qcew"), { kind: "estimate", method: "x / y", retrievedAt: at });

describe("dedupeProvenance", () => {
  it("keys on source, series, period, kind and method and keeps the first", () => {
    expect(provenanceKey(a)).toBe("bls-qcew||2026-Q1|published|");
    const out = dedupeProvenance([[a], [aAgain, b], undefined, null, [est]]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(a);
    expect(out.map((p) => p.kind)).toEqual(["published", "published", "estimate"]);
  });
});

describe("citationsOf", () => {
  it("returns unique citation lines in order", () => {
    const out = citationsOf([a, a, b, est]);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("period 2026-Q1");
    expect(out[2]).toContain("estimate computed by Embedding Atlas: x / y");
  });
});

describe("period helpers", () => {
  it("normalise QCEW quarters and Zillow month columns", () => {
    expect(quarterPeriod("2026 Q1")).toBe("2026-Q1");
    expect(quarterPeriod("2026-Q1")).toBe("2026-Q1");
    expect(quarterPeriod(null)).toBeUndefined();
    expect(monthPeriod("2026-07-31")).toBe("2026-07");
    expect(monthPeriod("2026-07")).toBe("2026-07");
    expect(monthPeriod("")).toBeUndefined();
    expect(iso(0)).toBe("1970-01-01T00:00:00.000Z");
  });
});
