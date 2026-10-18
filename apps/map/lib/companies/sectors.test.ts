import { describe, expect, it } from "vitest";
import type { SectorRow } from "@/lib/economy/features";
import { countySectorExposure, EXPOSURE_METHOD, GICS_TITLE, NAICS_TO_GICS, SECTOR_COLOR, SECTOR_ETF, sicToSector } from "./sectors";
import type { GicsSector } from "./types";

describe("sicToSector", () => {
  it("maps the fixture companies' SIC codes to the expected sectors and funds", () => {
    expect(sicToSector("3571").gics).toBe("information-technology"); // Apple, Dell
    expect(sicToSector("7372").gics).toBe("information-technology"); // Microsoft, Oracle
    expect(sicToSector("2911")).toMatchObject({ gics: "energy", etfs: ["XLE"], division: { code: "D" } }); // Exxon, Valero
    expect(sicToSector("6021").etfs).toEqual(["XLF", "KRE"]); // JPMorgan
    expect(sicToSector("5331")).toMatchObject({ gics: "consumer-staples", etfs: ["XLP", "XRT"] }); // Walmart
    expect(sicToSector("3711").gics).toBe("consumer-discretionary"); // Tesla
    expect(sicToSector("3531").gics).toBe("industrials"); // Caterpillar
    expect(sicToSector("4011").etfs).toEqual(["XLI", "IYT"]); // Union Pacific
    expect(sicToSector("4513").etfs).toEqual(["XLI", "IYT"]); // FedEx
    expect(sicToSector("3312").gics).toBe("materials"); // Nucor
    expect(sicToSector("1531")).toMatchObject({ gics: "consumer-discretionary", etfs: ["XLY", "ITB", "XHB"] }); // homebuilders
    expect(sicToSector("6798").gics).toBe("real-estate"); // Prologis
    expect(sicToSector("1000").gics).toBe("materials"); // Freeport
    expect(sicToSector("4922").gics).toBe("energy"); // Kinder Morgan
    expect(sicToSector("4813").gics).toBe("communication-services"); // AT&T
    expect(sicToSector("3674").etfs).toEqual(["XLK", "SMH"]); // TI, NVIDIA
    expect(sicToSector(1311).etfs).toEqual(["XLE", "XOP", "OIH"]);
    expect(sicToSector("2834").gics).toBe("health-care");
    expect(sicToSector("4911").gics).toBe("utilities");
  });
  it("returns unclassified for missing, non-numeric or unmapped codes", () => {
    expect(sicToSector(null).gics).toBe("unclassified");
    expect(sicToSector("").gics).toBe("unclassified");
    expect(sicToSector("abc").gics).toBe("unclassified");
    expect(sicToSector("9995").gics).toBe("unclassified");
    expect(sicToSector("9995").division.code).toBe("J");
  });
  it("has a title, colour and fund list for every sector", () => {
    for (const g of Object.keys(GICS_TITLE) as GicsSector[]) {
      expect(SECTOR_COLOR[g]).toMatch(/^#[0-9A-F]{6}$/i);
      expect(Array.isArray(SECTOR_ETF[g])).toBe(true);
    }
    for (const v of Object.values(NAICS_TO_GICS)) expect(GICS_TITLE[v.gics]).toBeTruthy();
  });
});

function row(code: string, emp: number | null, lq: number | null, suppressed = false): SectorRow {
  return { code, title: code, estabs: null, emp, avgWeeklyWage: null, lq, yoyEmp: null, suppressed };
}

describe("countySectorExposure", () => {
  it("folds NAICS rows into GICS sectors with an employment-weighted LQ", () => {
    const out = countySectorExposure([row("21", 10000, 3.0), row("23", 20000, 1.0), row("31-33", 20000, 0.5), row("52", 5000, 1.2), row("99", 10, 1.0)], { period: "2026 Q1", fips: "48029" });
    const energy = out.find((e) => e.gics === "energy")!;
    expect(energy.lq).toBe(3);
    expect(energy.etfs).toEqual(["XLE", "XOP", "OIH"]);
    const ind = out.find((e) => e.gics === "industrials")!;
    expect(ind.emp).toBe(40000);
    expect(ind.lq).toBe(0.75);
    expect(ind.etfs).toEqual(["XLI", "ITB", "XHB", "XLB"]);
    expect(ind.naics.map((n) => n.code)).toEqual(["23", "31-33"]);
    expect(out[0].gics).toBe("energy");
    expect(out[out.length - 1].gics).toBe("unclassified");
    expect(ind.provenance.kind).toBe("estimate");
    expect(ind.provenance.method).toBe(EXPOSURE_METHOD);
    expect(ind.provenance.period).toBe("2026 Q1");
    expect(ind.provenance.seriesId).toBe("qcew:48029:sectors");
  });
  it("carries withheld cells as null and drops sectors with nothing published", () => {
    const out = countySectorExposure([row("62", null, null, true), row("22", 300, 0.9)]);
    expect(out.map((e) => e.gics)).toEqual(["utilities"]);
  });
  it("gives null LQ when jobs are published but LQ is not", () => {
    const [u] = countySectorExposure([row("22", 300, null)]);
    expect(u.emp).toBe(300);
    expect(u.lq).toBeNull();
  });
  it("ignores codes outside the table", () => {
    expect(countySectorExposure([row("10", 5, 1)])).toEqual([]);
  });
});
