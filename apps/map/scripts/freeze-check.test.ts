import { describe, expect, it } from "vitest";
import { collectionIds, verdict } from "./freeze-check.mjs";

// Constructed test inputs: small made-up files shaped like
// lib/catalog/collections.ts, not the real catalogue.
const SAMPLE = [
  'const R1 = "2026-10-01";',
  "export const SHELVES = [",
  "  {",
  '    id: "not-a-collection",',
  "  },",
  "];",
  "export const COLLECTIONS: readonly Collection[] = [",
  "  // a comment line",
  "  {",
  '    id: "alpha",',
  '    coverage: { spatial: "x", count: null },',
  "    excluded: [",
  "      {",
  '        id: "nested-not-counted",',
  "      },",
  "    ],",
  "  },",
  "  {",
  '    id: "beta",',
  "  },",
  "];",
  "export function collection() {}",
  "  {",
  '    id: "after-the-array",',
  "  },",
].join("\n");

const freeze = (max: number, until = "2026-11-01") => ({ collections: { max, until, why: "test" } });

describe("freeze check", () => {
  it("counts only the top-level entries of COLLECTIONS", () => {
    expect(collectionIds(SAMPLE)).toEqual(["alpha", "beta"]);
  });

  it("reads CRLF files the same way", () => {
    expect(collectionIds(SAMPLE.replace(/\n/g, "\r\n"))).toEqual(["alpha", "beta"]);
  });

  it("throws when the array is missing", () => {
    expect(() => collectionIds("export const OTHER = [\n];")).toThrow(/COLLECTIONS/);
  });

  it("passes at or under the cap", () => {
    expect(verdict(["a", "b"], freeze(2), "2026-10-18").ok).toBe(true);
    expect(verdict(["a"], freeze(2), "2026-10-18").ok).toBe(true);
  });

  it("fails over the cap before the date and names the new ids", () => {
    const v = verdict(["a", "b", "c", "d"], freeze(2), "2026-10-18");
    expect(v.ok).toBe(false);
    expect(v.message).toContain("c, d");
  });

  it("lifts on the until date and after it", () => {
    expect(verdict(["a", "b", "c"], freeze(2), "2026-11-01").ok).toBe(true);
    expect(verdict(["a", "b", "c"], freeze(2), "2026-12-25").ok).toBe(true);
  });

  it("still binds the day before", () => {
    expect(verdict(["a", "b", "c"], freeze(2), "2026-10-31").ok).toBe(false);
  });
});
