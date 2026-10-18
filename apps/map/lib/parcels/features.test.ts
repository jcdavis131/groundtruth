import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADAPTER_BY_ID } from "./adapters";
import { buildOutlines, money, ownerText, parcelFeature, parcelName, plssText, recordDetails } from "./features";
import type { ParcelIdentify, ParcelRecord } from "./types";
import { matchScore } from "@/lib/search/allowlist";

const load = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

function identifyFrom(file: string): ParcelIdentify {
  const fx = load(file);
  const a = ADAPTER_BY_ID.get(fx.adapter)!;
  return {
    point: { lon: fx.point[0], lat: fx.point[1] },
    county: fx.county,
    adapter: { id: a.id, name: a.name, publisher: a.publisher, coverage: a.coverage, ownerPublished: a.ownerPublished },
    parcels: fx.rows.map((r: { geometry: never; properties: Record<string, unknown> }) => ({ record: a.normalize(r.properties, { county: fx.county, extra: fx.extra }), geometry: r.geometry })),
    addresses: [],
    notes: [],
  };
}

describe("outlines", () => {
  it("carry the parcel id and the use class only", () => {
    const rows = load("tx-hcad.json").rows;
    const [f] = buildOutlines(rows, ADAPTER_BY_ID.get("tx-hcad")!);
    expect(f.properties.id).toBe("parcel:tx-hcad:0011490000001");
    expect(f.properties.name).toBe("Parcel 0011490000001");
    expect(f.properties.details).toMatchObject({ "parcel id": "0011490000001", use: "X1" });
    expect(JSON.stringify(f)).not.toContain("CITY OF HOUSTON");
    expect(JSON.stringify(f)).not.toContain("PO BOX");
  });

  it("draw a stacked outline once, and skip rows with no id or no polygon", () => {
    // Three grand-list records at the Vermont State House share one SPAN and one outline.
    const rows = load("vt-vcgi.json").rows;
    expect(new Set(rows.map((r: { properties: { SPAN: string } }) => r.properties.SPAN)).size).toBe(1);
    const a = ADAPTER_BY_ID.get("vt-vcgi")!;
    const out = buildOutlines([...rows, { geometry: null, properties: { SPAN: "X" } }, { geometry: rows[0].geometry, properties: {} }], a);
    expect(out.map((f) => f.properties.id)).toEqual(["parcel:vt-vcgi:405-126-13234"]);
  });
});

describe("the dossier", () => {
  it("names a parcel by its site address, never its owner", () => {
    const id = identifyFrom("tx-hcad.json");
    const f = parcelFeature(id);
    expect(f.properties.name).toBe("901 BAGBY ST, HOUSTON 77002");
    expect(f.properties.id).toBe("parcel:tx-hcad:0011490000001");
    expect(f.geometry.type).toBe("Polygon");
    expect(f.properties.details?.owner).toBe("CITY OF HOUSTON");
    const noSitus: ParcelRecord = { adapter: "x", parcelId: "7", owner: { status: "published", names: ["SOMEONE"], role: "owner" } };
    expect(parcelName(noSitus)).toBe("Parcel 7");
  });

  it("⌘K cannot find a parcel from its owner's name", () => {
    const f = parcelFeature(identifyFrom("mt-statewide.json"));
    expect(matchScore(f.properties, "state of montana")).toBe(0);
    expect(matchScore(f.properties, "05188832244010000")).toBeGreaterThan(0);
  });

  it("prints each value with its own label and year, 0 marked as published", () => {
    const d = recordDetails(identifyFrom("wi-statewide.json").parcels[0].record, "Wisconsin");
    expect(d["estimated fair market value · tax roll year 2025"]).toBe("$0 (as published)");
    const h = recordDetails(identifyFrom("tx-hcad.json").parcels[0].record, "HCAD");
    expect(h["market value · tax year 2026"]).toBe("$19,625,000");
    expect(h["authoritative record"]).toBeUndefined();
  });

  it("says why an owner is missing", () => {
    expect(ownerText(identifyFrom("ca-la.json").parcels[0].record)).toMatch(/^not published: /);
    expect(ownerText(identifyFrom("nj-modiv.json").parcels[0].record)).toMatch(/^withheld: .*Daniel's Law/);
    expect(recordDetails(identifyFrom("nj-modiv.json").parcels[0].record, "NJ").mailing).toBe("not shown (Daniel's Law; see owner)");
    expect(recordDetails(identifyFrom("mi-detroit.json").parcels[0].record, "Detroit").taxpayer).toBe("DETROIT-WAYNE JOINT BUILDING AUTH; CITYOWNED ADMIN");
  });

  it("with no record, says what is here at the clicked point", () => {
    const f = parcelFeature({ point: { lon: -99.5, lat: 27.5 }, county: null, adapter: null, parcels: [], addresses: null, notes: ["No keyless public parcel service is wired for Webb County yet."] });
    expect(f.properties.kind).toBe("no-record");
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-99.5, 27.5] });
    expect(f.properties.details?.["what is here"]).toMatch(/Webb County/);
  });

  it("counts stacked records and prints PLSS as T-R, section", () => {
    const id = identifyFrom("vt-vcgi.json");
    expect(parcelFeature(id, 1).properties.details?.["records here"]).toBe("3 (stacked or overlapping; this is 2 of 3)");
    expect(plssText({ township: "10N 3W", section: "32", sectionType: "Section", meridian: "Montana Meridian" })).toBe("T10N R3W, section 32 (Montana Meridian)");
    expect(plssText({})).toBeUndefined();
    expect(money(1234.4)).toBe("$1,234");
  });
});
