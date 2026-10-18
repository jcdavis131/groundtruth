import { describe, expect, it } from "vitest";
import { PORT_BY_LOCODE, PORTS } from "./ports";

describe("PORTS table", () => {
  it("has unique, well-formed LOCODEs", () => {
    const ids = PORTS.map((p) => p.locode);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z]{5}$/);
  });
  it("has sane coordinates and radii", () => {
    for (const p of PORTS) {
      expect(p.lon).toBeGreaterThanOrEqual(-180);
      expect(p.lon).toBeLessThanOrEqual(180);
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.lat).toBeLessThanOrEqual(90);
      expect(p.radiusKm).toBeGreaterThanOrEqual(10);
      expect(p.radiusKm).toBeLessThanOrEqual(50);
      expect(p.locode.slice(0, 2)).toBe(p.country);
    }
  });
  it("covers the Baltic keylessly and lists the big container ports", () => {
    expect(PORTS.filter((p) => p.coverage === "digitraffic").length).toBeGreaterThanOrEqual(4);
    for (const id of ["USLAX", "USNYC", "NLRTM", "SGSIN", "CNSHA", "KRPUS", "AEJEA", "EGSUZ", "PACTB", "BRSSZ", "ZADUR", "FIHEL"]) {
      expect(PORT_BY_LOCODE.has(id)).toBe(true);
    }
    expect(PORTS.length).toBeGreaterThanOrEqual(40);
  });
});
