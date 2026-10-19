import { describe, expect, it } from "vitest";
import { citation } from "@/lib/provenance/types";
import {
  btsBorderProvenance,
  btsIndicatorProvenance,
  btsPortsProvenance,
  estimateProvenance,
  fredProvenance,
  naturalEarthProvenance,
  pulseProvenance,
  qcewProvenance,
  tigerProvenance,
  witsProvenance,
  worldBankProvenance,
  wpiProvenance,
  zillowProvenance,
} from "./provenance";

const at = "2026-09-11T10:00:00.000Z";

describe("economy provenance builders", () => {
  it("zillow: file name as seriesId, month period, ZHVI vs ZORI source", () => {
    const h = zillowProvenance("zhviCounty", "2026-07-31", at);
    expect(h.source.id).toBe("zillow-zhvi");
    expect(h.seriesId).toBe("County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv");
    expect(h.upstreamUrl).toBe("https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv");
    expect(h.period).toBe("2026-07");
    expect(h.kind).toBe("published");
    expect(h.retrievedAt).toBe(at);
    const r = zillowProvenance("zoriCounty", null, at);
    expect(r.source.id).toBe("zillow-zori");
    expect(r.period).toBeUndefined();
    expect(r.upstreamUrl).toContain("/zori/County_zori");
  });
  it("qcew: quarter period, area code in seriesId and the BLS open-data URL", () => {
    const p = qcewProvenance("2026 Q1", at, { area: "48453" });
    expect(p.source.id).toBe("bls-qcew");
    expect(p.period).toBe("2026-Q1");
    expect(p.seriesId).toBe("area 48453, all ownerships, all industries");
    expect(p.upstreamUrl).toBe("https://data.bls.gov/cew/data/api/2026/1/area/48453.csv");
    const s = qcewProvenance("2026 Q1", at, { area: "48000", sectors: true });
    expect(s.seriesId).toContain("NAICS sectors");
    const none = qcewProvenance(null, at);
    expect(none.seriesId).toBeUndefined();
    expect(none.upstreamUrl).toBe("https://data.bls.gov/cew/data/api/");
  });
  it("fred / bts indicators: series id and observation date; pulseProvenance routes by id prefix", () => {
    const f = fredProvenance({ id: "MORTGAGE30US", date: "2026-09-04" }, at);
    expect(f.source.id).toBe("fred");
    expect(f.seriesId).toBe("MORTGAGE30US");
    expect(f.period).toBe("2026-09-04");
    expect(f.upstreamUrl).toBe("https://fred.stlouisfed.org/series/MORTGAGE30US");
    expect(f.revision).toContain("ALFRED");
    const b = btsIndicatorProvenance({ id: "bts-diesel", date: "2026-09-07" }, at);
    expect(b.source.id).toBe("bts-supply-chain");
    const list = pulseProvenance([{ id: "UNRATE", date: "2026-08-01" }, { id: "bts-berths", date: "2026-09-05" }], at);
    expect(list.map((p) => p.source.id)).toEqual(["fred", "bts-supply-chain"]);
  });
  it("bundled tables use the pull date as retrievedAt", () => {
    expect(wpiProvenance(at, "2026-09-11").retrievedAt).toBe("2026-09-11");
    expect(wpiProvenance(at).retrievedAt).toBe(at);
    expect(naturalEarthProvenance(at, "2026-09-01").retrievedAt).toBe("2026-09-01");
    expect(naturalEarthProvenance(at).source.id).toBe("natural-earth");
  });
  it("bts ports / border, world bank, wits, tiger", () => {
    expect(btsPortsProvenance(2024, at).period).toBe("2024");
    expect(btsPortsProvenance(null, at).period).toBeUndefined();
    expect(btsBorderProvenance("2026-06", at).period).toBe("2026-06");
    expect(btsBorderProvenance("2026-06-01", at).period).toBe("2026-06");
    expect(worldBankProvenance(at).seriesId).toContain("NY.GDP.MKTP.CD");
    expect(worldBankProvenance(at, ["X"]).seriesId).toBe("X");
    const w = witsProvenance("USA", 2023, at);
    expect(w.seriesId).toContain("USA");
    expect(w.period).toBe("2023");
    expect(tigerProvenance(at, "500K").seriesId).toContain("500K");
    expect(tigerProvenance(at).seriesId).toBe("tigerWMS_Current");
  });
  it("estimates cite the source they were computed from and print the method", () => {
    const e = estimateProvenance("zillow-zhvi", "price-to-rent = 400000 / (2000 × 12) = 16.7", at, ["rent from ZORI"]);
    expect(e.kind).toBe("estimate");
    expect(e.source.id).toBe("zillow-zhvi");
    expect(citation(e)).toContain("estimate computed by Embedding Atlas: price-to-rent = 400000 / (2000 × 12) = 16.7");
    expect(e.notes).toEqual(["rent from ZORI"]);
  });
});
