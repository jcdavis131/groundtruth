// The companies section over the committed bundle. Two properties matter more
// than the wording: a county the snapshot does not cover returns null rather
// than an empty list, and nothing the section emits is about a person.
import { describe, expect, it } from "vitest";
import type { SectorRow } from "@/lib/economy/features";
import { BUNDLE } from "./features";
import { BUNDLE_CAVEATS, bundleProvenance, companiesSection } from "./section";

const AT = "2026-09-11T00:00:00Z";
/** Travis County, TX: two rows in the fixture. */
const COVERED = "48453";
/** Autauga County, AL: no row in the fixture. */
const UNCOVERED = "01001";

const sectors: SectorRow[] = [
  { code: "54", title: "Professional and technical services", estabs: 9000, emp: 120_000, avgWeeklyWage: 2200, lq: 1.8, yoyEmp: 2.1, suppressed: false },
  { code: "31-33", title: "Manufacturing", estabs: 1200, emp: 45_000, avgWeeklyWage: 1700, lq: 0.7, yoyEmp: -0.4, suppressed: false },
];

/** Every key the section is allowed to emit. Anything person-shaped is a bug, not a feature. */
const DATA_KEYS = ["n", "withFacts", "bundlePulled", "sectorExposure"];
const ITEM_KEYS = ["id", "layer", "name", "value", "flag", "distanceKm"];
const FORBIDDEN = /officer|insider|owner|shareholder|holder|executive|director|ceo|cfo|person|people|resident|household|form ?[345]\b/i;

describe("companiesSection", () => {
  it("summarises the county's filers and says the rows are a fixture, not a pull", () => {
    const s = companiesSection(COVERED, { sectors, retrievedAt: AT })!;
    expect(s).not.toBeNull();
    expect(s.title).toBe("Public companies");
    expect(s.loaded).toBe(true);
    expect(s.data.n).toBeGreaterThan(0);
    expect(s.data.n).toBe(s.items.length);
    expect(BUNDLE.pulled).toBeNull();
    expect(s.data.bundlePulled).toBeNull();
    expect(s.summary).toContain("fixture");
    expect(s.summary).toContain("not a pull");
    expect(s.data.withFacts).toBe(0);
  });

  it("returns null for a county the snapshot does not cover, so the caller omits the section", () => {
    expect(companiesSection(UNCOVERED, { sectors, retrievedAt: AT })).toBeNull();
    expect(companiesSection("99999")).toBeNull();
  });

  it("folds the county's jobs mix into GICS sectors and names the source of each", () => {
    const s = companiesSection(COVERED, { sectors, retrievedAt: AT })!;
    expect(s.data.sectorExposure.length).toBeGreaterThan(0);
    expect(s.summary).toContain("GICS sector");
    for (const e of s.data.sectorExposure) expect(e.provenance.source.id).toBe("bls-qcew");
    const none = companiesSection(COVERED, { retrievedAt: AT })!;
    expect(none.data.sectorExposure).toEqual([]);
    expect(none.summary).not.toContain("GICS sector");
  });

  it("carries the snapshot, the ZIP-to-county file and the centroid source as provenance", () => {
    const s = companiesSection(COVERED, { sectors, retrievedAt: AT })!;
    const ids = s.provenance.map((p) => p.source.id);
    expect(ids).toContain("sec-edgar");
    expect(ids).toContain("census-zcta-county");
    expect(ids).toContain("census-tigerweb");
    expect(bundleProvenance(AT).map((p) => p.source.id)).toEqual(["sec-edgar", "census-zcta-county", "census-tigerweb"]);
    expect(bundleProvenance(AT)[0].notes?.join(" ")).toContain("committed fixture");
  });

  it("states in the basis and the caveats that a position is a centroid, not a building", () => {
    const s = companiesSection(COVERED, { sectors, retrievedAt: AT })!;
    expect(s.basis).toContain("centroid");
    expect(s.basis).toContain("not a building");
    expect(BUNDLE_CAVEATS.join(" ")).toContain("centroids");
    expect(BUNDLE_CAVEATS.join(" ")).toContain("not building footprints");
  });

  it("emits legal entities only: no officer, insider or person-level key or value", () => {
    const s = companiesSection(COVERED, { sectors, retrievedAt: AT })!;
    expect(Object.keys(s.data).sort()).toEqual([...DATA_KEYS].sort());
    for (const item of s.items) {
      for (const k of Object.keys(item)) expect(ITEM_KEYS).toContain(k);
      expect(item.name).not.toMatch(FORBIDDEN);
      expect(item.value).not.toMatch(FORBIDDEN);
      expect(item.id.startsWith("cik:")).toBe(true);
    }
    // The basis names the exclusion; the section body must not reintroduce it.
    expect(s.summary).not.toMatch(FORBIDDEN);
    expect(s.basis).toContain("Forms 3, 4 and 5 are excluded");
  });
});
