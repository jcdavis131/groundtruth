import { describe, expect, it } from "vitest";
import { matchScore, searchableDetail } from "@/lib/search/allowlist";
import { buildPermits } from "./features";
import { buildLicences } from "./licences";
import { buildNpdes, buildUsace, echoFacilities, ormFeatures, ormInBox } from "./environmental";
import { envFeature, licenceFeature, permitFamily, permitFeature } from "./dossier";
import { envFeatures, licenceFeatures, permitFeatures } from "./geojson";
import { coverageNote } from "./notes";
import { envColor } from "@/lib/globe/civicStyles";

import austin from "./fixtures/permits-austin.json";
import la from "./fixtures/licences-losangeles.json";
import cwaRows from "./fixtures/echo-npdes-rows.json";
import orm from "./fixtures/usace-orm.json";

const rows = (j: unknown) => (j as Array<Record<string, unknown>>).map((r) => ({ geometry: null, properties: r }));

describe("permit dossiers", () => {
  const f = permitFeatures(buildPermits("austin", rows(austin))).features.map(permitFeature);

  it("names a permit by its number and work, and shows the valuation under its own column name", () => {
    expect(f[0].properties.name).toMatch(/^\S+.* · /);
    const withValue = f.find((x) => x.properties.details?.["total job valuation"]);
    if (withValue) expect(String(withValue.properties.details?.["total job valuation"])).toMatch(/^\$/);
    expect(f.every((x) => x.properties.layer === "permits")).toBe(true);
  });

  it("finds a permit by its number, never by its address or contractor", () => {
    const p = f.find((x) => x.properties.details?.["contractor (as published)"] && x.properties.details?.address)!;
    const num = String(p.properties.details?.["permit number"]).toLowerCase();
    expect(matchScore(p.properties, num)).toBeGreaterThan(0);
    expect(matchScore(p.properties, String(p.properties.details?.["contractor (as published)"]).toLowerCase())).toBe(0);
    expect(matchScore(p.properties, String(p.properties.details?.address).toLowerCase())).toBe(0);
    for (const k of ["address", "contractor (as published)", "description", "city record"]) expect(searchableDetail(k), k).toBe(false);
  });

  it("colours by the city's own words", () => {
    expect(permitFamily("Demolition Permit", undefined)).toBe("demolition");
    expect(permitFamily("Building Permit", "New")).toBe("new");
    expect(permitFamily("Electrical Permit", "Remodel")).toBe("trades");
    expect(permitFamily("Bldg-Alter/Repair", "Apartment")).toBe("alteration");
    expect(permitFamily(undefined, undefined)).toBe("other");
  });
});

describe("licence dossiers", () => {
  const b = buildLicences("losangeles", la as Array<Record<string, unknown>>);
  const f = licenceFeatures(b.records).features.map(licenceFeature);

  it("names a licence by its trade name, or by its category when no name may be shown", () => {
    expect(f.map((x) => x.properties.name)).toContain("ANNA'S FISH MARKET");
    const unnamed = f.filter((x) => x.properties.name.endsWith("(name not shown)"));
    expect(unnamed.length).toBe(2);
    expect(unnamed.every((x) => /may be a person/.test(String(x.properties.details?.name)))).toBe(true);
  });

  it("searches the licence number and type, never the address", () => {
    const x = f[0];
    expect(searchableDetail("licence number")).toBe(true);
    expect(searchableDetail("licence type")).toBe(true);
    expect(matchScore(x.properties, String(x.properties.details?.address).toLowerCase())).toBe(0);
  });
});

describe("environmental dossiers", () => {
  const npdes = envFeatures(buildNpdes(echoFacilities(cwaRows))).features.map(envFeature);
  const corps = envFeatures(buildUsace(ormInBox(ormFeatures(orm), [-95.2, 29.7, -95, 29.8]).features)).features.map(envFeature);

  it("names a facility by its permit id; the facility name is in the dossier and never searched", () => {
    expect(npdes[0].properties.name).toBe("NPDES TXR1509LI");
    expect(npdes[0].properties.details?.["facility (as EPA publishes it)"]).toBe("0 BAYWAY DRIVE BAYTOWN TX 77520");
    expect(matchScore(npdes[0].properties, "bayway")).toBe(0);
    expect(matchScore(npdes[0].properties, "txr1509li")).toBeGreaterThan(0);
  });

  it("names a Corps action by its number and type; the project name is not searched", () => {
    const a = corps.find((x) => x.properties.id === "usace:SWG-1993-01047")!;
    expect(a.properties.name).toBe("SWG-1993-01047 · Letter of Permission");
    expect(matchScore(a.properties, "maintenance dredging")).toBe(0);
  });

  it("says why a Corps project name is withheld, where the name would be", () => {
    const [rec] = buildUsace([{ geometry: { type: "Point", coordinates: [-95.1, 29.75] }, properties: { daNumber: "SWG-2026-00001", projectName: "Public, Jane / Dock" } }]);
    const d = envFeature(envFeatures([rec]).features[0]).properties.details!;
    expect(d["project (as the Corps publishes it)"]).toMatch(/^withheld: the project name opens with a personal name/);
    expect(JSON.stringify(d)).not.toContain("Jane");
  });

  it("draws 'not reported by ECHO' in the not-rated colour, never as calm", () => {
    const f = (compliance: string | undefined) => ({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { id: "x", layer: "envpermits", name: "x", source: "x", extra: { program: "npdes", compliance } } }) as Parameters<typeof envColor>[0];
    expect(envColor(f("not reported by ECHO"))).toBe(envColor(f(undefined)));
    expect(envColor(f("No Violation Identified"))).not.toBe(envColor(f("not reported by ECHO")));
    expect(envColor(f("Violation Identified"))).not.toBe(envColor(f("No Violation Identified")));
  });
});

describe("layer notes", () => {
  it("names capped, failed, stale and feedless sources, and counts the answered ones", () => {
    const n = coverageNote("12 permits", [
      { id: "chicago", name: "Chicago", state: "partial", count: 500, reason: "the newest 500 of more" },
      { id: "seattle", name: "Seattle", state: "covered", count: 0 },
      { id: "nyc", name: "New York City", state: "error", count: 0, reason: "nyc 503" },
      { id: "dallas", name: "Dallas", state: "stale", count: 0, reason: "feeds stopped" },
      { id: "houston", name: "Houston", state: "no-feed", count: 0 },
    ]);
    expect(n).toContain("from Chicago 500, Seattle 0");
    expect(n).toContain("Chicago capped (the newest 500 of more)");
    expect(n).toContain("New York City did not answer (nyc 503)");
    expect(n).toContain("Dallas stale (feeds stopped)");
    expect(n).toContain("Houston no permit records published");
  });
});
