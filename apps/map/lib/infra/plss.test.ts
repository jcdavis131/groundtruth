// T-R-S parsing and the PLSS search answer, on BLM CadNSDI answers captured
// 2026-09-26 for T12N R3W (26 townships under 24 meridians) and its section 33.

import { describe, expect, it } from "vitest";
import { geometryBbox, parseTrs, plssCandidates, safePlssId, sectionWhere, townshipWhere, trsLabel } from "./plss";
import { townshipName } from "./features";
import townships from "./fixtures/plss-search-t12n-r3w.json";
import sections from "./fixtures/plss-search-t12n-r3w-s33.json";

type Row = { geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> };

describe("parseTrs", () => {
  it("reads the common ways of writing a township, range and section", () => {
    const want = { township: 12, townshipDir: "N", range: 3, rangeDir: "W", section: 33, state: undefined };
    for (const s of ["T12N R3W S33", "t12n r3w s33", "T12N-R3W-S33", "T 12 N R 3 W Sec. 33", "T12N R3W Section 33", "12N 3W 33", "T12N, R3W, S33"]) {
      expect(parseTrs(s), s).toEqual(want);
    }
    expect(parseTrs("T12N R3W")).toEqual({ ...want, section: undefined });
    expect(parseTrs("T12N R3W S33 OK")).toEqual({ ...want, state: "OK" });
  });
  it("never turns an ordinary search into a PLSS lookup", () => {
    for (const s of ["R2D2", "T-Mobile", "Austin", "N12345", "UAL123", "I-35", "12 3", "T12N", "T12N R3W S37", "T12N R3W S33 TX"]) {
      expect(parseTrs(s), s).toBeNull();
    }
  });
  it("builds where-clauses from the parsed fields only", () => {
    const q = parseTrs("T12N R3W S33 OK")!;
    expect(townshipWhere(q)).toBe("TWNSHPNO='012' AND TWNSHPDIR='N' AND RANGENO='003' AND RANGEDIR='W' AND STATEABBR='OK'");
    expect(sectionWhere(["OK170120N0030W0", "x' OR 1=1 --"], 33)).toBe("PLSSID IN ('OK170120N0030W0') AND FRSTDIVNO='33' AND FRSTDIVTXT='Section'");
    expect(safePlssId("OK170120N0030W0")).toBe(true);
    expect(trsLabel(q)).toBe("T12N R3W S33");
  });
});

describe("townshipName", () => {
  it("normalises BLM's two label styles without changing the numbers", () => {
    expect(townshipName("12N 3W")).toEqual({ township: "T12N", range: "R3W" });
    expect(townshipName("T12N R03W")).toEqual({ township: "T12N", range: "R3W" });
    expect(townshipName("12.5N 3W")).toEqual({ township: "T12.5N", range: "R3W" });
    expect(townshipName(undefined)).toEqual({});
  });
});

describe("plssCandidates", () => {
  const t = townships.features as unknown as Row[];
  const s = sections.features as unknown as Row[];
  it("lists every township a T-R without a state names, with its meridian", () => {
    const out = plssCandidates(parseTrs("T12N R3W")!, t, null, 50);
    expect(out).toHaveLength(26);
    const ok = out.find((c) => c.state === "OK")!;
    expect(ok.label).toBe("T12N R3W, Indian Meridian (OK)");
    expect(ok.plssId).toBe("OK170120N0030W0");
    expect(ok.bbox[0]).toBeLessThan(ok.bbox[2]);
    expect(ok.lon).toBeGreaterThan(-98);
    expect(ok.lon).toBeLessThan(-97);
  });
  it("with a section, lists the section in each township that has one", () => {
    const out = plssCandidates(parseTrs("T12N R3W S33")!, t, s, 50);
    expect(out).toHaveLength(23);
    const ok = out.find((c) => c.state === "OK")!;
    expect(ok.label).toBe("T12N R3W S33, Indian Meridian (OK)");
    expect(ok.firstDivisionId).toBe("OK170120N0030W0SN330");
    // A section is a mile on a side: its box is far smaller than its township's.
    const twp = plssCandidates(parseTrs("T12N R3W")!, t, null, 50).find((c) => c.state === "OK")!;
    expect(ok.bbox[2] - ok.bbox[0]).toBeLessThan(twp.bbox[2] - twp.bbox[0]);
  });
  it("caps the list", () => {
    expect(plssCandidates(parseTrs("T12N R3W")!, t, null, 5)).toHaveLength(5);
  });
  it("has a box for each polygon it reads", () => {
    expect(geometryBbox(null)).toBeNull();
    expect(geometryBbox({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 2], [0, 0]]] })).toEqual([0, 0, 1, 2]);
  });
});
