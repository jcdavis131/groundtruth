// HUD housing vouchers by tract and QCT titled 2026, pure, on captures from 2026-10-17
// (lib/civic/fixtures/hud-*, unmodified; hud-hcv-five.sentinel.json is a labelled mutation).
import { describe, expect, it } from "vitest";
import hcvAustin from "./fixtures/hud-hcv-austin.json";
import qctAustin from "./fixtures/hud-qct-austin.json";
import hcvAttrs from "./fixtures/hud-hcv-austin-attrs.json";
import hcvLayer from "./fixtures/hud-hcv-layer.json";
import hcvCt from "./fixtures/hud-hcv-ct-box.json";
import qctCt from "./fixtures/hud-qct-ct-box.json";
import five from "./fixtures/hud-hcv-five.sentinel.json";
import {
  buildHousing,
  HCV_DENOMINATOR_QUOTE,
  HCV_FIELDS,
  HCV_SUPPRESSION_QUOTE,
  HOUSING_BIN_COLORS,
  HOUSING_CAVEAT,
  HOUSING_SUPPRESSED_FILL,
  housingBin,
  housingBoxParams,
  housingPlace,
  isCtLegacyTract,
  housingPlaceParams,
  hcvRow,
  pickFields,
  QCT_FIELDS,
  remeasureHousing,
  SUPPRESSED_LEGEND,
  type HousingExtra,
} from "./housing";

type Raw = { geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null };
const feats = (fc: unknown) => (fc as { features: Raw[] }).features;
const ext = (f: { properties: { extra?: unknown } }) => f.properties.extra as HousingExtra;

describe("HUD's own words", () => {
  it("the layer description says the suppression rule and the renter-units denominator, as quoted", () => {
    const d = (hcvLayer as { description: string }).description;
    expect(d).toContain(HCV_SUPPRESSION_QUOTE);
    expect(d).toContain(HCV_DENOMINATOR_QUOTE);
    expect(HOUSING_CAVEAT).toMatch(/a grey tract may have a few vouchers or none/);
  });
});

describe("queries", () => {
  it("name their fields, never *, and only the allow-list", () => {
    const b: [number, number, number, number] = [-97.9, 30.15, -97.6, 30.45];
    for (const [fields, want] of [
      [HCV_FIELDS, "GEOID,HCV_PUBLIC,HCV_PUBLIC_PCT"],
      [QCT_FIELDS, "GEOID"],
    ] as const) {
      const p = housingBoxParams(b, fields);
      expect(p.outFields).toBe(want);
      expect(Object.values(p).join(" ")).not.toContain("*");
      expect(housingPlaceParams("48453002220", fields).outFields).toBe(want);
    }
    expect(housingPlaceParams("48453002220", HCV_FIELDS).where).toBe("GEOID='48453002220'");
    expect(() => housingPlaceParams("48453' OR '1'='1", HCV_FIELDS)).toThrow();
  });
  it("pickFields drops every property outside the allow-list", () => {
    const leaky = [{ geometry: null, properties: { GEOID: "48453002220", HCV_PUBLIC: 166, HCV_PUBLIC_PCT: 20.1, EANAME: "Austin", CONTACT: "x" } }];
    expect(pickFields(leaky, HCV_FIELDS)[0].properties).toEqual({ GEOID: "48453002220", HCV_PUBLIC: 166, HCV_PUBLIC_PCT: 20.1 });
  });
});

describe("tracts", () => {
  it("Austin: 259 tracts, 134 suppressed drawn grey (never a bin), 48453002220 is 166 / 20.1 %", () => {
    const b = buildHousing(feats(hcvAustin), feats(qctAustin), 0);
    expect(b.published + b.suppressed).toBe(259);
    expect(b.suppressed).toBe(134);
    expect(b.ctNotPublished).toBe(0);
    const t = b.features.find((f) => f.properties.id === "housing:hcv:48453002220")!;
    expect(ext(t)).toMatchObject({ status: "published", value: 20.1, bin: 4 });
    expect(t.properties.details!["voucher households"]).toBe("166");
    expect(t.properties.details!["share of renter units"]).toMatch(/^20\.1 %/);
    const s = b.features.find((f) => ext(f).kind === "hcv" && ext(f).status === "suppressed")!;
    expect(ext(s).bin).toBeNull();
    expect(s.properties.kind).toBe("suppressed");
    expect(s.properties.details!["voucher households"]).toBe("suppressed: 10 or fewer, or none");
    expect(HOUSING_BIN_COLORS).not.toContain(HOUSING_SUPPRESSED_FILL);
    expect(SUPPRESSED_LEGEND).toBe("10 or fewer vouchers, or none (HUD suppresses)");
  });

  it("a tract is found in the palette by its GEOID (the card's one searchable field)", async () => {
    const { matchScore } = await import("@/lib/search/allowlist");
    const b = buildHousing(feats(hcvAustin), feats(qctAustin), 0);
    const t = b.features.find((f) => f.properties.id === "housing:hcv:48453002220")!;
    expect(matchScore(t.properties, "48453002220")).toBeGreaterThan(0);
    expect(matchScore(t.properties, "austin")).toBe(0);
  });

  it("QCT outlines come after the tracts, and membership is shown on the tract", () => {
    const b = buildHousing(feats(hcvAustin), feats(qctAustin), 0);
    expect(b.qct).toBe(46);
    const firstQct = b.features.findIndex((f) => ext(f).kind === "qct");
    expect(b.features.slice(firstQct).every((f) => ext(f).kind === "qct")).toBe(true);
    const qctId = ext(b.features[firstQct]).geoid;
    const tract = b.features.find((f) => f.properties.id === `housing:hcv:${qctId}`);
    if (tract) expect(tract.properties.details!["qualified census tract"]).toMatch(/^yes/);
  });

  it("draws what HUD publishes: a sentinel count of 5 is a bin, not suppressed (the rule is HUD's, not ours)", () => {
    expect((five as { _note: string })._note).toMatch(/^SENTINEL, not an upstream response/);
    const b = buildHousing(feats(five), [], 1);
    expect(ext(b.features[0])).toMatchObject({ status: "published", value: 5, bin: 0 });
  });

  it("Connecticut: every voucher tract is null in HUD's layer, drawn 'not published', never suppressed; no county name is looked up", () => {
    const b = buildHousing(feats(hcvCt), feats(qctCt), 0);
    expect(b.ctNotPublished).toBe(104);
    expect(b.suppressed).toBe(0);
    const t = b.features.find((f) => ext(f).kind === "hcv")!;
    expect(ext(t).status).toBe("not-published-ct");
    expect(t.properties.details!["voucher households"]).toMatch(/^not published for Connecticut/);
    expect(t.properties.details!["qualified census tract"]).toMatch(/^not known here/);
    expect(t.properties.details!.connecticut).toBe("HUD files these vouchers under Connecticut's old counties");
    expect(JSON.stringify(t.properties.details)).not.toMatch(/Hartford|County/);
    expect(b.qct).toBe(39);
    expect(feats(qctCt).every((f) => String(f.properties?.GEOID).startsWith("09110"))).toBe(true);
  });

  it("re-colours by count without a request, on its own breaks", () => {
    const b = buildHousing(feats(hcvAustin), [], 0);
    const c = remeasureHousing(b.features, 1);
    const t = c.find((f) => f.properties.id === "housing:hcv:48453002220")!;
    expect(ext(t)).toMatchObject({ measure: 1, value: 166, bin: 3 });
    expect(housingBin(11, 1)).toBe(0);
    expect(housingBin(null, 1)).toBeNull();
  });
});

describe("the place answer", () => {
  it("one tract's row and QCT membership, from the attribute rows", () => {
    const rows = (hcvAttrs as { features: Array<{ attributes: Record<string, unknown> }> }).features.map((f) => f.attributes);
    expect(housingPlace("48453002220", rows, [{ GEOID: "48453002220" }])).toEqual({ geoid: "48453002220", vouchers: 166, share: 20.1, status: "published", qct: true });
    const nul = rows.find((r) => r.HCV_PUBLIC == null)!;
    expect(housingPlace(String(nul.GEOID), rows, [])).toMatchObject({ vouchers: null, share: null, status: "suppressed", qct: false });
    expect(housingPlace("48453999999", rows, []).status).toBe("not-in-layer");
    expect(hcvRow({ GEOID: "4845300222" })).toBeNull();
  });

  it("a Connecticut voucher tract (legacy-county code) has QCT membership unknown, not false; a planning-region code is answered", () => {
    // hud-hcv-ct-box.json and hud-qct-ct-box.json: the Hartford-area box (2026-10-17). Every voucher
    // tract is 0900x; every QCT GEOID is in planning-region codes (091x0), so they never meet.
    const hcv = (hcvCt as { features: Array<{ properties: Record<string, unknown> }> }).features.map((f) => f.properties);
    const qct = (qctCt as { features: Array<{ properties: Record<string, unknown> }> }).features.map((f) => f.properties);
    expect(hcv.every((r) => /^090/.test(String(r.GEOID)))).toBe(true);
    expect(qct.every((r) => /^091[1-9]0/.test(String(r.GEOID)))).toBe(true);
    const legacy = String(hcv[0].GEOID);
    expect(isCtLegacyTract(legacy)).toBe(true);
    expect(housingPlace(legacy, hcv, qct)).toEqual({ geoid: legacy, vouchers: null, share: null, status: "not-published-ct", qct: null });
    const region = String(qct[0].GEOID);
    expect(isCtLegacyTract(region)).toBe(false);
    expect(housingPlace(region, hcv, qct)).toMatchObject({ status: "not-in-layer", qct: true });
    expect(isCtLegacyTract("09016000100")).toBe(false);
    expect(isCtLegacyTract("48453002220")).toBe(false);
  });
});
