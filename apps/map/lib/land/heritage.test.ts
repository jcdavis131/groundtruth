// National heritage on NPS answers captured 2026-10-16, unmodified: the World Heritage Sites
// (35 rows), the National Heritage Areas (62), every unit centroid (437), the unit boundaries in
// -77.5,39.75,-77,40 (APPA, GETT, EISE), and ABPP's six layers in -77.5,39.5,-77,40
// (Gettysburg and Hanover study areas, Gettysburg's core area; no Revolutionary War or 1812).
import { describe, expect, it } from "vitest";
import whs from "./fixtures/nps-whs-all.json";
import nha from "./fixtures/nps-nha-all.json";
import centroids from "./fixtures/nps-centroids-all.json";
import units from "./fixtures/nps-units-gettysburg.json";
import cw from "./fixtures/abpp-0-gettysburg.json";
import cwCore from "./fixtures/abpp-1-gettysburg.json";
import { ABPP_LAYERS, buildBattlefields, buildNha, buildUnits, buildWhs, inscriptionOf, type HeritageExtra } from "./heritage";
import { heritageRequests, heritageViewKey } from "@/lib/layers/heritage";

type Fc = { features: Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }> };

describe("World Heritage Sites", () => {
  it("makes the nine Frank Lloyd Wright rows one inscription, and the 35 rows 26 drawn sites", () => {
    expect(inscriptionOf("1496rev-007")).toBe("1496rev");
    expect(inscriptionOf("72Ter")).toBe("72Ter");
    const sites = buildWhs((whs as Fc).features);
    // 27 inscriptions; the blank row has no geometry, so it is not drawn.
    expect(sites).toHaveLength(26);
    const wright = sites.find((s) => s.properties.id === "whs:1496rev")!;
    expect(wright.geometry.type).toBe("MultiPolygon");
    expect(String(wright.properties.details?.components)).toMatch(/^9 boundaries in this inscription: .*Fallingwater/);
  });

  it("draws no row without a geometry (the one blank row has none), never fills a name in, and never asks for SiteOwner", () => {
    const rows = (whs as Fc).features;
    const blank = rows.filter((f) => !String(f.properties?.RESNAME ?? "").trim());
    expect(blank).toHaveLength(1);
    expect(blank[0].geometry).toBeNull();
    const sites = buildWhs(rows);
    expect(sites.every((s) => s.properties.name.trim().length > 0)).toBe(true);
    for (const f of rows) expect(Object.keys(f.properties ?? {})).not.toContain("SiteOwner");
  });
});

describe("National Heritage Areas", () => {
  it("keeps NPS's text as served (the Blue Ridge em dash arrives intact; nothing to repair)", () => {
    const areas = buildNha((nha as Fc).features);
    expect(areas).toHaveLength(62);
    const br = areas.find((a) => a.properties.name === "Blue Ridge National Heritage Area")!;
    expect(String(br.properties.details?.["about (NPS)"])).toContain("three separate continents—North America");
    for (const a of areas) expect(String(a.properties.details?.["about (NPS)"] ?? "")).not.toMatch(/â€|Ã|�/);
  });
});

describe("park units", () => {
  it("draws centroids from afar and boundaries near, named as NPS names the unit, linked to nps.gov", () => {
    const pts = buildUnits((centroids as Fc).features, "point");
    expect(pts).toHaveLength(437);
    const bnd = buildUnits((units as Fc).features, "polygon");
    expect(bnd.map((f) => f.properties.id).sort()).toEqual(["nps-unit:bnd:APPA", "nps-unit:bnd:EISE", "nps-unit:bnd:GETT"]);
    const gett = bnd.find((f) => f.properties.id === "nps-unit:bnd:GETT")!;
    expect(gett.properties.name).toBe("Gettysburg National Military Park");
    expect(gett.properties.details).toMatchObject({ "unit type": "National Military Parks", "unit code": "GETT", "nps.gov": "https://www.nps.gov/gett/", boundary: "boundary edited 2023-12-12" });
  });

  it("switches from centroids to boundaries at 250 km and asks battlefields only below 1,500 km", () => {
    const far = heritageRequests({ lon: -77.2, lat: 39.8, height: 2_000_000 });
    expect(far.units).toBe("/api/land?op=heritage&kind=units");
    expect(far.battlefields).toBeUndefined();
    const mid = heritageRequests({ lon: -77.2, lat: 39.8, height: 600_000 });
    expect(mid.units).toBe("/api/land?op=heritage&kind=units");
    expect(mid.battlefields).toMatch(/kind=battlefields&bbox=/);
    const near = heritageRequests({ lon: -77.2, lat: 39.8, height: 200_000 });
    expect(near.units).toMatch(/kind=units&bbox=/);
    expect(heritageViewKey({ lon: -77.2, lat: 39.8, height: 2_000_000, heading: 0, pitch: -90 })).toBe("far");
  });
});

describe("ABPP battlefields", () => {
  it("draws study areas and core areas by war, survey areas, never listings", () => {
    const study = buildBattlefields((cw as Fc).features, ABPP_LAYERS[0]);
    const core = buildBattlefields((cwCore as Fc).features, ABPP_LAYERS[1]);
    expect(study.map((f) => f.properties.details?.site)).toEqual(["PA002", "PA001"]);
    expect(core[0].properties.name).toBe("GETTYSBURG (core area)");
    expect((core[0].properties.extra as HeritageExtra)).toMatchObject({ kind: "battlefield", group: "Civil War", boundary: "core" });
    expect(core[0].properties.details?.["what this is"]).toMatch(/not a property line/);
    expect(ABPP_LAYERS.map((l) => l.id)).toEqual([0, 1, 5, 6, 8, 9]);
  });
});
