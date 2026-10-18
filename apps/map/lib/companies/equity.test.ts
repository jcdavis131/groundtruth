import { describe, expect, it } from "vitest";
import { allEquityDossiers, equityDossierTickers, getEquityDossier } from "./equity";

describe("equity dossiers", () => {
  it("covers the pilot batch", () => {
    const all = allEquityDossiers();
    expect(all.length).toBeGreaterThan(0);
    expect(equityDossierTickers()).toContain("JPM");
  });

  it("looks up by ticker case-insensitively", () => {
    expect(getEquityDossier("tmus")?.company).toMatch(/T-Mobile/);
    expect(getEquityDossier("NOPE")).toBeNull();
  });

  it("every cited fact names its exact filing", () => {
    for (const d of allEquityDossiers()) {
      const cited = [...d.vesting, ...d.blackoutDisclosed];
      if (d.equityPlan) cited.push(d.equityPlan);
      if (d.tradingPolicy) cited.push(d.tradingPolicy);
      for (const c of cited) {
        if (d.registry === "HKEX") {
          expect(c.form, `${d.ticker} form`).toBe("Annual Report");
          expect(c.url, `${d.ticker} url`).toMatch(/^https:\/\//);
        } else {
          expect(c.form, `${d.ticker} form`).toMatch(/10-K|DEF 14A|20-F|40-F/);
          expect(c.accessionNumber, `${d.ticker} accession`).toMatch(/^\d{10}-\d{2}-\d{6}$/);
          expect(c.url, `${d.ticker} url`).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
        }
        expect(c.statement.length, `${d.ticker} statement`).toBeGreaterThan(40);
      }
    }
  });

  it("every inferred blackout window is labeled an estimate in the copy", () => {
    for (const d of allEquityDossiers()) {
      const est = d.blackoutWindowEstimate;
      if (!est) continue;
      expect(est.label).toMatch(/ESTIMATE/i);
      expect(est.statement).toMatch(/estimate/i);
      expect(est.method.length).toBeGreaterThan(20);
    }
  });

  it("ETF membership cites official issuer sources with sane weights", () => {
    let held = 0;
    for (const d of allEquityDossiers()) {
      expect(Array.isArray(d.etfMembership), `${d.ticker} etfMembership`).toBe(true);
      for (const m of d.etfMembership) {
        held++;
        expect(m.etf, `${d.ticker} etf`).toMatch(/^[A-Z]{2,5}$/);
        expect(m.weightPct, `${d.ticker} weight`).toBeGreaterThan(0);
        expect(m.weightPct, `${d.ticker} weight`).toBeLessThan(100);
        expect(m.asOf.length, `${d.ticker} asOf`).toBeGreaterThan(0);
        expect(m.source, `${d.ticker} source`).toMatch(/^https:\/\/www\.ishares\.com\//);
      }
    }
    expect(held).toBeGreaterThan(0);
  });

  it("no personal data of any individual is stored", () => {
    const blob = JSON.stringify(allEquityDossiers());
    // officer/insider-name shaped fields must not exist
    expect(blob).not.toMatch(/"officer"|"insider"|"beneficialOwner"/i);
  });
});
