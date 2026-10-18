import { describe, expect, it } from "vitest";
import clayPoint from "./fixtures/sda-saclay-point.json";
import clayMapunit from "./fixtures/sda-saclay-mapunit.json";
import whpNw from "./fixtures/whp-identify-nw.json";
import { groundClickWanted, groundDetails, groundFeature, groundId, isGroundSelection, partsFor } from "./ground";
import { parseComponents, parseSoilPoint, soilAnswer } from "./soil";
import { parseWhpIdentify } from "./classes";

describe("which ground questions a click asks", () => {
  it("asks only the layers that are on, each once, elevation for relief and contours together", () => {
    expect(partsFor({})).toEqual([]);
    expect(partsFor({ soils: true, aircraft: true })).toEqual(["soils"]);
    expect(partsFor({ relief: true, contours: true, landcover: true })).toEqual(["landcover", "elevation"]);
  });

  it("only below 150 km and only with a ground layer on, so a click from orbit still deselects", () => {
    expect(groundClickWanted({ soils: true }, 20_000)).toBe(true);
    expect(groundClickWanted({ soils: true }, 2_000_000)).toBe(false);
    expect(groundClickWanted({ flood: true, water: true }, 2_000)).toBe(false);
  });
});

describe("the ground dossier", () => {
  const soil = soilAnswer(parseSoilPoint(clayPoint)!, parseComponents(clayMapunit));

  it("reads the soil, the class and the point as published", () => {
    const d = groundDetails({
      lon: -98.45,
      lat: 29.28,
      parts: { soils: { loading: false, data: soil }, firehazard: { loading: false, data: parseWhpIdentify(whpNw) } },
    });
    expect(d["soil map unit"]).toBe("San Antonio clay loam, 1 to 3 percent slopes (SaB)");
    expect(d["farmland class (NRCS)"]).toBe("All areas are prime farmland");
    expect(d["NCCPI (main soil, 0 to 1)"]).toBe("0.455 (Moderate inherent productivity)");
    expect(d["main soil"]).toBe("San Antonio, 100 % of the map unit");
    expect(d["soil survey"]).toBe("Bexar County, Texas, saved 9/4/2025 2:58:52 PM");
    expect(d["wildfire hazard potential"]).toBe("Low (class 2 of WHP 2023)");
    expect(d.point).toBe("29.28000, -98.45000");
  });

  it("says what is loading, what failed and what the source has no value for, never a number it did not send", () => {
    const d = groundDetails({
      lon: -40,
      lat: 30,
      parts: {
        soils: { loading: false, data: null },
        landcover: { loading: true },
        slope: { loading: false, error: "3dep 503" },
        elevation: { loading: false, data: { note: "EPQS returned no value" } },
        firehazard: { loading: false, data: null },
      },
    });
    expect(d["soil map unit"]).toMatch(/none mapped here/);
    expect(d["land cover"]).toMatch(/^asking MRLC/);
    expect(d.slope).toMatch(/did not answer: 3dep 503/);
    expect(d["ground elevation"]).toMatch(/no 3DEP value/);
    expect(d["wildfire hazard potential"]).toMatch(/no class here/);
  });

  it("is a point feature on the first layer asked, named after the soil when there is one, and travels as its point", () => {
    const f = groundFeature({ lon: -98.45, lat: 29.28, seq: 1, layer: "soils", parts: { soils: { loading: false, data: soil } } });
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-98.45, 29.28] });
    expect(f.properties).toMatchObject({ id: groundId(-98.45, 29.28), layer: "soils", kind: "ground", name: "Ground here · San Antonio clay loam, 1 to 3 percent slopes", source: "NRCS SSURGO" });
    expect(isGroundSelection({ id: f.properties.id })).toBe(true);
    expect(isGroundSelection({ id: "nfhl:48029C:0" })).toBe(false);
  });
});

describe("the geology part of the ground dossier", () => {
  it("asks Macrostrat when the Geology picture is on", () => {
    expect(partsFor({ geology: true })).toEqual(["geology"]);
    expect(groundClickWanted({ geology: true }, 20_000)).toBe(true);
  });

  it("reads the most detailed unit with its age, lithology and map, and names the coarser ones", async () => {
    const { parseMacrostrat } = await import("@/lib/infra/geology");
    const pikes = (await import("@/lib/infra/fixtures/macrostrat-pikes-peak.json")).default;
    const d = groundDetails({ lon: -104.95, lat: 38.85, parts: { geology: { loading: false, data: parseMacrostrat(pikes) } } });
    expect(d["geologic unit"]).toBe("Rocks of Pikes Peak Batholith (1000-m.y. age group)");
    expect(d["geologic age"]).toBe("Mesoproterozoic (1,000 to 1,600 million years)");
    expect(d["geologic map"]).toMatch(/State Geologic Map Compilation/);
    expect(d["on coarser maps"]).toBe("Mesoproterozoic plutonic: granite; Paleoproterozoic crystalline metamorphic rocks");
  });

  it("says when there is no unit, and when Macrostrat did not answer", async () => {
    const { parseMacrostrat } = await import("@/lib/infra/geology");
    const empty = (await import("@/lib/infra/fixtures/macrostrat-empty.json")).default;
    expect(groundDetails({ lon: -150, lat: 0, parts: { geology: { loading: false, data: parseMacrostrat(empty) } } }).geology).toMatch(/no mapped unit/);
    expect(groundDetails({ lon: 0, lat: 0, parts: { geology: { loading: false, error: "macrostrat 502" } } }).geology).toMatch(/did not answer: macrostrat 502/);
  });
});

describe("critical habitat in the ground dossier", () => {
  it("is asked when the Critical habitat layer is on, alone or with others", () => {
    expect(partsFor({ crithab: true })).toEqual(["crithab"]);
    expect(partsFor({ soils: true, crithab: true })).toEqual(["soils", "crithab"]);
    expect(groundClickWanted({ crithab: true }, 20_000)).toBe(true);
  });

  it("names each designation, says PROPOSED, and says what an empty answer does not mean", () => {
    const final = [{ common: "Austin blind Salamander", scientific: "Eurycea waterlooensis", listing: "Endangered", designation: "Final", fedreg: "78FR51328 51379", published: "2013-08-20" }];
    const proposed = [{ common: "Pecos pupfish", scientific: "Cyprinodon pecosensis", listing: "Proposed Threatened", designation: "Proposed", fedreg: "89FR92744 92785", published: "2024-11-22" }];
    const both = groundDetails({ lon: -97.7713, lat: 30.2638, parts: { crithab: { loading: false, data: { final, proposed } } } });
    expect(both["critical habitat 1"]).toMatch(/^Austin blind Salamander .* final critical habitat · 78 FR 51328 51379, published 2013-08-20$/);
    expect(both["critical habitat 2"]).toMatch(/PROPOSED critical habitat \(not final\)/);
    const none = groundDetails({ lon: -98.5, lat: 29.4, parts: { crithab: { loading: false, data: { final: [], proposed: [] } } } });
    expect(none["critical habitat"]).toMatch(/^no designated critical habitat at this point/);
    const half = groundDetails({ lon: -98.5, lat: 29.4, parts: { crithab: { loading: false, data: { final: [], proposed: null } } } });
    expect(half["critical habitat"]).toBeUndefined();
    expect(half["critical habitat (proposed)"]).toMatch(/unknown, not absent/);
  });
});

describe("historic topo maps in the ground dossier", () => {
  it("is asked when the Historic topo maps layer is on", () => {
    expect(partsFor({ topo: true })).toEqual(["topo"]);
    expect(groundClickWanted({ topo: true }, 20_000)).toBe(true);
  });

  it("lists the drawn edition's sheets with citation and files, then the other editions", async () => {
    const { parseHtmcSheets, tnmFiles, topoYears, withTnmFiles } = await import("./topo");
    const htmc = (await import("./fixtures/htmc-point-sf.json")).default;
    const tnm = (await import("./fixtures/tnm-htmc-sf.json")).default;
    const sheets = withTnmFiles(parseHtmcSheets(htmc), tnmFiles(tnm));
    const years = topoYears(sheets);
    const d = groundDetails({ lon: -122.42, lat: 37.77, parts: { topo: { loading: false, data: { sheets, years, year: 1895 } } } });
    expect(d["topographic maps"]).toBe(`31 sheets in ${years.length} editions here, 1895 to 1995`);
    const keys = Object.keys(d).filter((k) => k.startsWith("topo 1895 sheet"));
    expect(keys.length).toBeGreaterThan(0);
    expect(Object.entries(d).some(([k, v]) => k.endsWith("GeoTIFF") && typeof v === "string" && v.startsWith("https://prd-tnm.s3.amazonaws.com/"))).toBe(true);
    expect(d["other topo editions here"]).not.toContain("1895");
    const none = groundDetails({ lon: -150, lat: 0, parts: { topo: { loading: false, data: { sheets: [], years: [], year: null } } } });
    expect(none["topographic maps"]).toMatch(/^no USGS topographic sheet here/);
  });
});

describe("Wayback capture dates in the ground dossier", () => {
  it("is asked when Historic imagery is on", () => {
    expect(partsFor({ wayback: true })).toEqual(["wayback"]);
    expect(partsFor({ topo: true, wayback: true })).toEqual(["topo", "wayback"]);
  });

  it("says the release, every capture date, and never guesses one", async () => {
    const { parseCaptures } = await import("./wayback");
    const meta = (await import("./fixtures/wayback-meta-2014r01-5-sf.json")).default as { features: Array<{ attributes: Record<string, unknown> }> };
    const captures = parseCaptures(meta.features.map((f) => f.attributes));
    const d = groundDetails({ lon: -122.42, lat: 37.77, parts: { wayback: { loading: false, data: { release: { release: 10, date: "2014-02-20" }, z: 18, captures } } } });
    expect(d["imagery captured"]).toBe("Release 2014-02-20 · captured 2010-10-26 and 2010-11-02 · 0.3 m · Microsoft (UC-G)");
    expect(d["imagery collection (Esri)"]).toBe("US-CA-SanFran-Oakland");
    const none = groundDetails({ lon: 0, lat: 0, parts: { wayback: { loading: false, data: { release: { release: 10, date: "2014-02-20" }, z: 18, captures: [] } } } });
    expect(none["imagery captured"]).toBe("Release 2014-02-20 · Esri lists no capture date here");
  });
});

describe("NOAA Fisheries critical habitat in the ground dossier", () => {
  it("lists NOAA's species with the agency named, and says NOAA is unknown when it did not answer", async () => {
    const { parseNmfs } = await import("@/lib/land/features");
    const area = (await import("@/lib/land/fixtures/nmfs-226-seattle.json")).default as { features: Array<{ properties: Record<string, unknown> }> };
    const noaa = parseNmfs(area.features, "area");
    const d = groundDetails({ lon: -122.4, lat: 47.6, parts: { crithab: { loading: false, data: { final: [], proposed: [], noaa } } } });
    expect(d["critical habitat"]).toBe("Whale, killer (Orcinus orca) · Endangered · final critical habitat · unit Puget Sound · 71 FR 69054, published 2006-11-29 · NOAA Fisheries");
    const down = groundDetails({ lon: -122.4, lat: 47.6, parts: { crithab: { loading: false, data: { final: [], proposed: [], noaa: null } } } });
    expect(down["critical habitat"]).toBeUndefined();
    expect(down["critical habitat (NOAA Fisheries)"]).toMatch(/unknown, not absent/);
  });
});

describe("species ranges in the ground dossier", () => {
  it("groups the species by status, says range is not presence, and says unknown when the layer failed", async () => {
    const { parseRanges } = await import("@/lib/land/features");
    const austin = (await import("@/lib/land/fixtures/ranges-3-austin.json")).default as { features: Array<{ attributes: Record<string, unknown> }> };
    const ranges = parseRanges(austin.features.map((f) => f.attributes));
    const d = groundDetails({ lon: -97.74, lat: 30.27, parts: { crithab: { loading: false, data: { final: [], proposed: [], noaa: [], ranges } } } });
    expect(d["listed species ranges here"]).toMatch(/^13 listed or proposed species whose range covers this point .* not where it is$/);
    const groups = Object.keys(d).filter((k) => k.startsWith("range: "));
    expect(groups[0]).toMatch(/^range: endangered \(\d+\)$/);
    expect(String(d[groups[0]])).toContain("Bone Cave harvestman (Texella reyesi; arachnids; FWS; range 2018-01-24)");
    const down = groundDetails({ lon: -97.74, lat: 30.27, parts: { crithab: { loading: false, data: { final: [], proposed: [], noaa: [], ranges: null } } } });
    expect(down["listed species ranges here"]).toMatch(/unknown, not none/);
  });
});
