import { describe, expect, it } from "vitest";
import {
  classify,
  countReasons,
  expandConstants,
  findConstants,
  findEndpoints,
  isFailing,
  knownOutage,
  probeTarget,
  resolveConstants,
  settle,
} from "./endpoint-sweep.mjs";

const json = (o: unknown) => Buffer.from(JSON.stringify(o));
const PNG = Buffer.from("89504e470d0a1a0a0000", "hex");

describe("endpoint sweep", () => {
  it("finds ArcGIS services and tile templates in source text, not plain links", () => {
    const text = [
      'export const A = "https://x.gov/arcgis/rest/services/Foo/MapServer";',
      'const T = "https://t.org/carto/{z}/{x}/{y}.png";',
      "const U = `https://h.gov/a/${id}/{z}/{x}/{y}`;",
      'const L = "https://www.example.gov/about";',
    ].join("\n");
    expect(findEndpoints(text)).toEqual([
      "https://x.gov/arcgis/rest/services/Foo/MapServer",
      "https://t.org/carto/{z}/{x}/{y}.png",
      "https://h.gov/a/${id}/{z}/{x}/{y}",
    ]);
  });

  it("asks an ArcGIS service for its root (keeping a layer number) and fills tile templates", () => {
    expect(probeTarget("https://x.gov/arcgis/rest/services/Foo/FeatureServer/3/query?where=1")).toEqual({
      kind: "arcgis",
      url: "https://x.gov/arcgis/rest/services/Foo/FeatureServer/3?f=json",
    });
    expect(probeTarget("https://t.org/{z}/{x}/{y}.png")).toEqual({ kind: "tile", url: "https://t.org/6/14/24.png" });
    expect(probeTarget("https://i.gov/ImageServer/exportImage?bbox={westProjected},{southProjected},{eastProjected},{northProjected}").kind).toBe("arcgis");
    expect(probeTarget("https://h.gov/a/${id}/{z}").kind).toBeNull();
    expect(probeTarget("https://h.gov/tile/{release}/{z}/{y}/{x}")).toMatchObject({ kind: null, why: "unfilled {release}" });
    expect(probeTarget("https://developers.google.com/maps/documentation/tile/get-api-key").kind).toBeNull();
  });

  it("calls an ArcGIS error inside HTTP 200 dead (the Wetlands_Raster_v5 case)", () => {
    const v5 = json({ error: { code: 404, message: "Service not found", details: [] } });
    expect(classify("arcgis", 200, "application/json", v5)).toMatchObject({ verdict: "DEAD" });
    expect(classify("arcgis", 200, "application/json", json({ name: "Wetlands_Raster" }))).toMatchObject({ verdict: "OK" });
    expect(classify("arcgis", 503, "text/html", Buffer.from("<html>"))).toMatchObject({ verdict: "DEAD" });
    expect(classify("arcgis", 200, "text/html", Buffer.from("<html>"))).toMatchObject({ verdict: "ODD" });
  });

  it("wants an image body from a tile, and reads an empty 404 as no tile here", () => {
    expect(classify("tile", 200, "image/png", PNG)).toMatchObject({ verdict: "OK" });
    expect(classify("tile", 200, "text/html", Buffer.from("<html>error</html>"))).toMatchObject({ verdict: "ODD" });
    expect(classify("tile", 404, "", Buffer.alloc(0))).toMatchObject({ verdict: "EMPTY" });
    expect(classify("tile", 500, "text/plain", Buffer.from("x"))).toMatchObject({ verdict: "DEAD" });
  });

  it("does not take a template's runtime ${x} for a tile placeholder", () => {
    // A JSON API with runtime parts is out of the sweep's scope, so it is neither probed nor counted.
    const text = "const url = `https://api.windy.com/webcams/api/v3/webcams?lang=en&limit=50&nearby=${lat},${lon},${radius}`;";
    expect(findEndpoints(text)).toEqual([]);
  });

  it("resolves service bases from string constants, across files and through templates", () => {
    // Shapes copied from lib/hazards/wrc.ts, lib/civic/housing.ts + taxcredit.ts and app/api/infra/route.ts.
    const files = new Map([
      [
        "lib/hazards/wrc.ts",
        [
          'export const WRC_HOST = "https://services1.arcgis.com/gGHDlz6USftL5Pau/arcgis/rest/services";',
          "export const WRC_COUNTY_LAYER = `${WRC_HOST}/county_boundaries_conus_ak_hi/FeatureServer/0`;",
        ].join("\n"),
      ],
      [
        "lib/civic/housing.ts",
        'export const HUD_ORG = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services";',
      ],
      [
        "lib/civic/taxcredit.ts",
        [
          'import { HUD_ORG } from "./housing";',
          "export const DDA_LAYER = `${HUD_ORG}/Difficult_Development_Areas_2026/FeatureServer/0`;",
        ].join("\n"),
      ],
      [
        "app/api/infra/route.ts",
        [
          'const ESRI_FED = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services";',
          "const PIPELINES: Record<PipelineKind, string> = {",
          "  natgas: `${ESRI_FED}/Natural_Gas_Interstate_and_Intrastate_Pipelines_1/FeatureServer/0`,",
          "};",
        ].join("\n"),
      ],
    ]);
    const lookup = resolveConstants(new Map([...files].map(([rel, text]) => [rel, findConstants(text)])));
    expect(lookup("lib/hazards/wrc.ts", "WRC_COUNTY_LAYER")).toEqual({
      value: "https://services1.arcgis.com/gGHDlz6USftL5Pau/arcgis/rest/services/county_boundaries_conus_ak_hi/FeatureServer/0",
    });
    const found = (rel: string) => findEndpoints(expandConstants(files.get(rel)!, (n: string) => lookup(rel, n)).text).map((l) => (probeTarget(l) as { url?: string }).url);
    expect(found("lib/civic/taxcredit.ts")).toEqual([
      "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Difficult_Development_Areas_2026/FeatureServer/0?f=json",
    ]);
    expect(found("app/api/infra/route.ts")).toEqual([
      "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Natural_Gas_Interstate_and_Intrastate_Pipelines_1/FeatureServer/0?f=json",
    ]);
  });

  it("fills NOAA's sea level scenario in the SLR template and probes the service root", () => {
    // lib/terrain/products.ts: SLR_BASE and the template one product row builds on it.
    const text = [
      'export const SLR_BASE = "https://coast.noaa.gov/arcgis/rest/services/dc_slr";',
      "    template: `${SLR_BASE}/slr_{ft}ft/MapServer/tile/{z}/{y}/{x}`,",
    ].join("\n");
    const lookup = resolveConstants(new Map([["lib/terrain/products.ts", findConstants(text)]]));
    const [literal] = findEndpoints(expandConstants(text, (n: string) => lookup("lib/terrain/products.ts", n)).text);
    expect(probeTarget(literal)).toEqual({ kind: "arcgis", url: "https://coast.noaa.gov/arcgis/rest/services/dc_slr/slr_3ft/MapServer?f=json" });
    // lib/terrain/products.ts: the NAIP mosaic needs a search id from the planetary computer, so it is not probed.
    expect(probeTarget("https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchid}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x")).toEqual({
      kind: null,
      why: "unfilled {searchid}",
    });
  });

  it("lists a base it cannot resolve as not probed, with the reason", () => {
    // The NPS and WRC ArcGIS orgs (lib/land/heritage.ts, lib/hazards/wrc.ts) under one name: neither is picked.
    const files = new Map([
      ["lib/a.ts", 'export const HOST = "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services";'],
      ["lib/b.ts", 'const HOST = "https://services1.arcgis.com/gGHDlz6USftL5Pau/arcgis/rest/services";'],
      [
        "lib/c.ts",
        [
          "const u = `${HOST}/World_Heritage_Sites/FeatureServer/0`;",
          "const v = `${base}/FeatureServer/0`;",
          "const w = `${utahService(county)}/FeatureServer/0`;",
          // A JSON API on an unknown base is out of scope, so it is not counted.
          "const x = `${EDGAR_BASE}/submissions/CIK${padCik(cik)}.json`;",
        ].join("\n"),
      ],
    ]);
    const lookup = resolveConstants(new Map([...files].map(([rel, text]) => [rel, findConstants(text)])));
    // A file's own definition still wins.
    expect((lookup("lib/b.ts", "HOST") as { value?: string }).value).toContain("gGHDlz6USftL5Pau");
    const { unresolved } = expandConstants(files.get("lib/c.ts")!, (n: string) => lookup("lib/c.ts", n));
    expect(unresolved).toEqual([
      { literal: "${HOST}/World_Heritage_Sites/FeatureServer/0", why: "base ${HOST} has more than one value under lib/ and app/" },
      { literal: "${base}/FeatureServer/0", why: "base ${base} is not a string constant under lib/ or app/" },
      { literal: "${utahService(county)}/FeatureServer/0", why: "base ${utahService(county)} is an expression" },
    ]);
  });

  it("fails only when both tries fail, and keeps both verdicts of a mixed pair", () => {
    const ok = { verdict: "OK", detail: "Wetlands" };
    const dead = { verdict: "DEAD", detail: "HTTP 503" };
    const err = { verdict: "ERR", detail: "ECONNRESET" };
    const odd = { verdict: "ODD", detail: "HTTP 200, not JSON (text/html)" };
    expect(settle(ok, null)).toMatchObject({ verdict: "OK", failing: false, recovered: false });
    expect(settle(dead, dead)).toMatchObject({ verdict: "DEAD", failing: true, detail: "HTTP 503 (twice)" });
    expect(settle(odd, odd)).toMatchObject({ verdict: "ODD", failing: true });
    expect(settle(err, err)).toMatchObject({ verdict: "ERR", failing: true });
    expect(settle(err, dead)).toMatchObject({ verdict: "ERR+DEAD", failing: true, detail: "first ERR: ECONNRESET; then DEAD: HTTP 503" });
    expect(settle(err, ok)).toMatchObject({ verdict: "OK", failing: false, recovered: true });
    expect(settle(odd, { verdict: "EMPTY", detail: "404 with no body (no tile here)" })).toMatchObject({ verdict: "EMPTY", failing: false, recovered: true });
    expect(isFailing("ODD")).toBe(true);
    expect(isFailing("EMPTY")).toBe(false);
  });

  it("counts the not-probed items by reason", () => {
    expect(
      countReasons([
        { why: "runtime parts" },
        { why: "unfilled {searchid}" },
        { why: "runtime parts" },
        { why: "not a service or a template (a page link)" },
      ]),
    ).toEqual([
      ["runtime parts", 2],
      ["not a service or a template (a page link)", 1],
      ["unfilled {searchid}", 1],
    ]);
  });

  it("matches a known outage by substring", () => {
    const known = [{ match: "geopub.epa.gov/arcgis/rest/services/EMEF/", since: "2026-10-18", note: "" }];
    expect(knownOutage("https://geopub.epa.gov/arcgis/rest/services/EMEF/efpoints/MapServer?f=json", known)).toBe(known[0]);
    expect(knownOutage("https://other.gov/MapServer?f=json", known)).toBeNull();
  });
});
