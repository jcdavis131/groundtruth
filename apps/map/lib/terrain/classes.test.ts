// The class tables are the publishers' own legends, and each point answer is
// parsed from a payload captured from the live service (2026-09-26): downtown
// San Antonio, Canyon Lake, and the Hill Country north-west of the city.
import { describe, expect, it } from "vitest";
import nlcdLegend from "./fixtures/nlcd-legend.json";
import whpLegend from "./fixtures/whp-legend.json";
import slrLegend from "./fixtures/slr-legend.json";
import nwiRat from "./fixtures/nwi-raster-rat.json";
import whpDt from "./fixtures/whp-identify-dt.json";
import whpLake from "./fixtures/whp-identify-lake.json";
import whpNw from "./fixtures/whp-identify-nw.json";
import nlcdDt from "./fixtures/nlcd-gfi-dt.json";
import nlcdLake from "./fixtures/nlcd-gfi-lake.json";
import nlcdNw from "./fixtures/nlcd-gfi-nw.json";
import slopeDt from "./fixtures/slope-identify-dt.json";
import slopeNw from "./fixtures/slope-identify-nw.json";
import { classFor, NLCD_CLASSES, NWI_RASTER_CLASSES, parseNlcdFeatureInfo, parseSlopeIdentify, parseWhpIdentify, SLR_LEGEND, WHP_CLASSES } from "./classes";

describe("class tables match what each service's own legend serves", () => {
  it("NWI raster: eight wetland types with the colours of the ImageServer's raster attribute table (Wetlands_Raster, captured 2026-10-18)", () => {
    const rows = nwiRat.features.map((f) => f.attributes);
    expect(NWI_RASTER_CLASSES.map((c) => c.code)).toEqual(rows.map((r) => r.Value));
    expect(NWI_RASTER_CLASSES.map((c) => c.label)).toEqual(rows.map((r) => r.WETLAND_TYPE));
    const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
    expect(NWI_RASTER_CLASSES.map((c) => c.color)).toEqual(rows.map((r) => `#${hex(r.Red)}${hex(r.Green)}${hex(r.Blue)}`));
    // The tiles ask for 0 as NoData so it draws clear; that is only safe while 0 is no class.
    expect(rows.map((r) => r.Value)).not.toContain(0);
  });

  it("WHP: seven classes in code order, labels and swatches from the ImageServer /legend", () => {
    const served = whpLegend.layers[0].legend;
    expect(WHP_CLASSES.map((c) => c.label)).toEqual(served.map((l) => l.label));
    expect(WHP_CLASSES.map((c) => c.color)).toEqual(served.map((l) => l.swatch));
    expect(WHP_CLASSES.map((c) => c.code)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("NLCD: every class code, label and colour from MRLC's GetLegendGraphic (its 0 = no data entry left out)", () => {
    const entries = nlcdLegend.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries.filter((e) => e.quantity !== "0");
    expect(NLCD_CLASSES.map((c) => c.code)).toEqual(entries.map((e) => Number(e.quantity)));
    expect(NLCD_CLASSES.map((c) => c.color)).toEqual(entries.map((e) => e.color.toUpperCase()));
    // MRLC's labels end with the code in brackets and spell "(AK only)" loosely; the words are the same.
    const norm = (s: string) => s.replace(/\(\d+\)$/, "").replace(/\s+|\//g, "").toLowerCase();
    expect(NLCD_CLASSES.map((c) => norm(c.label))).toEqual(entries.map((e) => norm(e.label)));
  });

  it("sea level rise: NOAA's two legend entries and swatches", () => {
    const served = slrLegend.layers.flatMap((l) => l.legend.map((e) => e.swatch));
    expect(SLR_LEGEND.map((l) => l.color)).toEqual(served);
  });
});

describe("point answers from captured payloads", () => {
  it("WHP: downtown non-burnable (6), Canyon Lake water (7), Hill Country low (2)", () => {
    expect(parseWhpIdentify(whpDt)).toEqual({ code: 6, label: "Non-burnable", color: "#E1E1E1" });
    expect(parseWhpIdentify(whpLake)?.label).toBe("Water");
    expect(parseWhpIdentify(whpNw)?.label).toBe("Low");
  });

  it("NLCD: PALETTE_INDEX is the class code", () => {
    expect(parseNlcdFeatureInfo(nlcdDt)).toMatchObject({ code: 24, label: "Developed, High Intensity" });
    expect(parseNlcdFeatureInfo(nlcdLake)).toMatchObject({ code: 11, label: "Open Water" });
    expect(parseNlcdFeatureInfo(nlcdNw)).toMatchObject({ code: 52, label: "Shrub/Scrub" });
  });

  it("3DEP slope: whole degrees as returned", () => {
    expect(parseSlopeIdentify(slopeDt)).toBe(1);
    expect(parseSlopeIdentify(slopeNw)).toBe(11);
  });

  it("never turns a missing or unknown value into a class or a number", () => {
    expect(parseWhpIdentify({ value: "NoData" })).toBeNull();
    expect(parseWhpIdentify({ value: "" })).toBeNull();
    expect(parseWhpIdentify({ value: "9" })).toBeNull();
    expect(parseWhpIdentify({})).toBeNull();
    expect(parseNlcdFeatureInfo({ features: [] })).toBeNull();
    expect(parseNlcdFeatureInfo({ features: [{ properties: { PALETTE_INDEX: 0 } }] })).toBeNull();
    expect(parseSlopeIdentify({ value: "NoData" })).toBeNull();
    expect(parseSlopeIdentify({ value: null })).toBeNull();
    expect(parseSlopeIdentify({ value: "" })).toBeNull();
    expect(classFor(WHP_CLASSES, "3.5")).toBeNull();
  });
});
