import { describe, expect, it } from "vitest";
import type { MultiPolygon, Polygon } from "geojson";
import { searchableDetail } from "@/lib/search/allowlist";
import nwiWetlands from "./fixtures/nwi-wetlands-mitchell.json";
import nwiCodeRows from "./fixtures/nwi-codes-mitchell.json";
import nrhpPoints from "./fixtures/nrhp-points-dc.json";
import nrhpBoundaries from "./fixtures/nrhp-polygons-dc.json";
import chProposedPecos from "./fixtures/crithab-2-pecos.json";
import {
  buildFloodZones,
  buildHistoric,
  buildPublicLands,
  critHabText,
  FWS_PLACEHOLDER,
  fwsDate,
  parseCritHab,
  buildWetlands,
  decodeCowardin,
  floodZoneMeaning,
  NRHP_FIELDS,
  NWI_CAVEAT,
  nwiImagerySummary,
  parseCertDate,
  parseEpqs,
  parseNwiSources,
  pointInRing,
  trimParts,
  type FloodZoneExtra,
  type HistoricExtra,
  type PublicLandExtra,
  type WetlandExtra,
} from "./features";

const square: Polygon = { type: "Polygon", coordinates: [[[-120, 40], [-119.9, 40], [-119.9, 40.1], [-120, 40]]] };

// ---------------------------------------------------------------- FEMA NFHL

describe("buildFloodZones", () => {
  it("drops FEMA's -9999 'none' sentinel instead of showing it as an elevation", () => {
    const [f] = buildFloodZones([{ geometry: square, properties: { FLD_AR_ID: "48029C_1", FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: -9999, DEPTH: -9999, LEN_UNIT: "Feet" } }]);
    const x = f.properties.extra as FloodZoneExtra;
    expect(x.bfe).toBeUndefined();
    expect(x.depth).toBeUndefined();
    expect(f.properties.name).toBe("Zone AE");
    expect(f.properties.details?.["base flood elevation"]).toBeUndefined();
    expect(x.hazard).toBe("sfha");
  });

  it("shows a published base flood elevation with its unit and datum", () => {
    const [f] = buildFloodZones([{ geometry: square, properties: { FLD_ZONE: "AE", STATIC_BFE: 634.5, LEN_UNIT: "Feet", V_DATUM: "NAVD88", DFIRM_ID: "48029C" } }]);
    expect(f.properties.name).toBe("Zone AE · BFE 634.5 feet");
    expect(f.properties.details?.["base flood elevation"]).toBe("634.5 feet NAVD88");
    // No FLD_AR_ID: the id is built from the FIRM database and the row, never left empty.
    expect(f.properties.id).toBe("nfhl:48029C:0");
  });

  it("treats zone D as undetermined (no FEMA analysis), not as minimal hazard", () => {
    const [d, x] = buildFloodZones([
      { geometry: square, properties: { FLD_AR_ID: "1", FLD_ZONE: "D" } },
      { geometry: square, properties: { FLD_AR_ID: "2", FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } },
    ]);
    expect((d.properties.extra as FloodZoneExtra).hazard).toBe("undetermined");
    expect(d.properties.details?.meaning).toBe("possible but undetermined flood hazard: no FEMA analysis");
    expect((x.properties.extra as FloodZoneExtra).hazard).toBe("minimal");
    expect(floodZoneMeaning("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD")).toMatch(/^0\.2 % annual-chance/);
  });

  it("skips rows with no polygon", () => {
    expect(buildFloodZones([{ geometry: null, properties: { FLD_ZONE: "AE" } }])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- NWI

describe("wetlands and their imagery year", () => {
  const quad = (name: string, w: number, yr: number) => ({
    geometry: { type: "Polygon" as const, coordinates: [[[w, 29.25], [w + 0.125, 29.25], [w + 0.125, 29.375], [w, 29.375], [w, 29.25]]] },
    properties: { PROJECT_NAME: name, IMAGE_YR: yr, IMAGE_DATE: "03/83", IMAGE_SCALE: 58000, SOURCE_TYPE: "CIR" },
  });
  const wet = (lon: number) => ({
    geometry: { type: "Polygon" as const, coordinates: [[[lon, 29.3], [lon + 0.001, 29.3], [lon + 0.001, 29.301], [lon, 29.3]]] },
    properties: { ATTRIBUTE: "PEM1A", OBJECTID: lon, WETLAND_TYPE: "Freshwater Emergent Wetland" },
  });

  it("gives each wetland its mapping project's imagery year, or says it was not found", () => {
    const sources = parseNwiSources([quad("Southton", -98.5, 1983), quad("Losoya", -98.375, 2010)]);
    const built = buildWetlands([wet(-98.45), wet(-98.3), wet(-97)], sources);
    expect(built[0].properties.details?.["mapped from"]).toBe("1983 imagery (Southton, CIR 1:58,000, 03/83)");
    expect((built[0].properties.extra as WetlandExtra).imageYear).toBe(1983);
    expect((built[1].properties.extra as WetlandExtra).imageYear).toBe(2010);
    expect(built[2].properties.details?.["mapped from"]).toBe("imagery date not found in NWI's source layer");
    expect(built[0].properties.details?.["usfws caveat"]).toBe(NWI_CAVEAT);
    expect(built[0].properties.name).toBe("Freshwater Emergent Wetland · PEM1A");
    expect(nwiImagerySummary(sources).years).toEqual([1983, 2010]);
  });

  it("names each real polygon locally, matching NWI's own code table (both captured 2026-10-12)", () => {
    const rows = nwiWetlands.features as unknown as Parameters<typeof buildWetlands>[0];
    const built = buildWetlands(rows, []);
    expect(built).toHaveLength(14);
    const lake = built.find((f) => (f.properties.extra as WetlandExtra).code === "L2USAh")!;
    expect(lake.properties.id).toBe("nwi:24255589");
    expect(lake.properties.extra).toMatchObject({ type: "Lake", system: "Lacustrine", subsystem: "Littoral", cls: "Unconsolidated Shore", regime: "Temporarily Flooded" });
    // Palustrine has no subsystem: it stays absent, never "".
    const pem = built.find((f) => (f.properties.extra as WetlandExtra).code === "PEM1Ch")!;
    expect((pem.properties.extra as WetlandExtra).subsystem).toBeUndefined();
    expect(pem.properties.details?.subsystem).toBeUndefined();
    // The oracle: NWI's table 1 rows for every code in that answer (first row per code;
    // NWI spells A "Temporary Flooded", Cowardin "Temporarily Flooded").
    const table = new Map<string, Record<string, string | null>>();
    for (const f of nwiCodeRows.features) if (!table.has(f.attributes.ATTRIBUTE)) table.set(f.attributes.ATTRIBUTE, f.attributes);
    const codes = [...new Set(built.map((f) => (f.properties.extra as WetlandExtra).code))].sort();
    expect(codes).toEqual(["L2USAh", "PEM1Ch", "PUBFh", "PUBHh", "PUSAh", "PUSCh", "R4SBAx", "R4SBC", "R5UBH"]);
    for (const code of codes) {
      const t = table.get(code)!;
      expect(decodeCowardin(code), code).toEqual({
        system: t.SYSTEM_NAME ?? undefined,
        subsystem: t.SUBSYSTEM_NAME ?? undefined,
        cls: t.CLASS_NAME ?? undefined,
        regime: t.WATER_REGIME_NAME?.replace("Temporary Flooded", "Temporarily Flooded") ?? undefined,
      });
    }
  });

  it("reads NWI's 0 year as not recorded rather than as year 0", () => {
    const [s] = parseNwiSources([quad("Nowhere", -98.5, 0)]);
    expect(s.year).toBeUndefined();
    expect(nwiImagerySummary([s]).years).toEqual([]);
  });

  it("decodes Cowardin names locally from the ATTRIBUTE code", () => {
    expect(decodeCowardin("PEM1A")).toEqual({
      system: "Palustrine",
      subsystem: undefined,
      cls: "Emergent",
      regime: "Temporarily Flooded",
    });
    expect(decodeCowardin("R2UBH")).toEqual({
      system: "Riverine",
      subsystem: "Lower Perennial",
      cls: "Unconsolidated Bottom",
      regime: "Permanently Flooded",
    });
    expect(decodeCowardin("L1UBHh")).toEqual({
      system: "Lacustrine",
      subsystem: "Limnetic",
      cls: "Unconsolidated Bottom",
      regime: "Permanently Flooded",
    });
    expect(decodeCowardin("E2EM1P")).toMatchObject({
      system: "Estuarine",
      cls: "Emergent",
      regime: "Irregularly Flooded",
    });
    expect(decodeCowardin("E1UBL")).toMatchObject({ subsystem: "Subtidal", regime: "Subtidal" });
    expect(decodeCowardin("")).toEqual({});
    expect(decodeCowardin("XX9Q")).toEqual({});
  });

  it("tests points against a ring with the even-odd rule", () => {
    const ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    expect(pointInRing(1, 1, ring)).toBe(true);
    expect(pointInRing(3, 1, ring)).toBe(false);
  });
});

// ---------------------------------------------------------------- NPS National Register

describe("National Register listings (captured from NPS around the National Mall, 2026-10-12)", () => {
  const pts = buildHistoric(nrhpPoints.features as unknown as Parameters<typeof buildHistoric>[0], "point");
  const bnd = buildHistoric(nrhpBoundaries.features as unknown as Parameters<typeof buildHistoric>[0], "boundary");

  it("names a listing by its NRIS number and type, the property's name kept out of the searchable name", () => {
    expect(pts).toHaveLength(60);
    const urn = pts.find((f) => (f.properties.extra as HistoricExtra).refnum === "07001053")!;
    expect(urn.properties.name).toBe("NRHP 07001053 · object");
    expect(urn.properties.details?.["property name (as NPS lists it)"]).toBe("Cuban Friendship Urn");
    expect(urn.properties.details?.listed).toBe("2007-10");
    expect(urn.properties.details?.["nomination (National Archives)"]).toBe("https://catalog.archives.gov/id/117691539");
    expect(urn.properties.extra).toMatchObject({ resType: "object", nhl: false, shape: "point" });
  });

  it("marks National Historic Landmarks only where NPS flags them", () => {
    const nhl = pts.filter((f) => (f.properties.extra as HistoricExtra).nhl);
    expect(nhl).toHaveLength(13);
    expect(nhl[0].properties.name).toMatch(/· NHL$/);
    expect(pts.find((f) => !(f.properties.extra as HistoricExtra).nhl)!.properties.details?.["national historic landmark"]).toBeUndefined();
  });

  it("draws boundaries from layer 1 and never carries an address", () => {
    expect(bnd).toHaveLength(18);
    expect(bnd.every((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")).toBe(true);
    expect(bnd[0].properties.id).toMatch(/^nrhp:bnd:/);
    for (const f of [...pts, ...bnd]) expect(Object.keys(f.properties.details ?? {}).join(" ")).not.toMatch(/address/i);
    expect(NRHP_FIELDS as readonly string[]).not.toContain("Address");
    expect(NRHP_FIELDS as readonly string[]).not.toContain("Vicinity");
  });

  it("drops a NARA link NPS left blank rather than linking nowhere", () => {
    const blank = bnd.find((f) => (f.properties.extra as HistoricExtra).refnum === "15000845")!;
    expect(blank.properties.details?.["nomination (National Archives)"]).toBeUndefined();
  });

  it("reads NPS's partial CertDate leniently and never guesses", () => {
    expect(parseCertDate("2007-10-")).toBe("2007-10");
    expect(parseCertDate("2007-10-15")).toBe("2007-10-15");
    expect(parseCertDate("1974")).toBe("1974");
    expect(parseCertDate("")).toBeUndefined();
    expect(parseCertDate(null)).toBeUndefined();
    expect(parseCertDate("unknown")).toBeUndefined();
    expect(parseCertDate("2007-13-")).toBeUndefined();
    expect(parseCertDate("0000-00-")).toBeUndefined();
    // A blank CertDate in the capture stays blank.
    const undated = pts.filter((f) => (f.properties.extra as HistoricExtra).listed === undefined);
    expect(undated.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- USFWS critical habitat

describe("critical habitat at a point", () => {
  it("reads FWS's placeholder text as no value, never as a value", () => {
    // FWS fills unitname with this on every final row (2026-10-12); the route does not ask for it,
    // and any field that carries it reads as absent.
    const [s] = parseCritHab([{ properties: { comname: "Austin blind Salamander", sciname: "Eurycea waterlooensis", listing_status: "Endangered", status: "Final", fedreg: FWS_PLACEHOLDER, pubdate: FWS_PLACEHOLDER } }]);
    expect(s.fedreg).toBeUndefined();
    expect(s.published).toBeUndefined();
    expect(fwsDate("20130820")).toBe("2013-08-20");
    expect(fwsDate("2013")).toBeUndefined();
  });

  it("says PROPOSED on a proposed designation, with the rule as FWS cites it", () => {
    const [s] = parseCritHab(chProposedPecos.features);
    expect(critHabText(s)).toBe("Pecos pupfish (Cyprinodon pecosensis) · Proposed Threatened · PROPOSED critical habitat (not final) · 89 FR 92744 92785, published 2024-11-22");
  });

  it("lists a species once per rule when its habitat comes back as several units", () => {
    const row = chProposedPecos.features[0];
    expect(parseCritHab([row, row])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- PAD-US

describe("public and protected lands", () => {
  it("labels a privately owned unit by PAD-US id, keeping its published name out of the searched fields", () => {
    const [f] = buildPublicLands(
      [{ geometry: square, properties: { OBJECTID: 7, Category: "Easement", Unit_Nm: "Smith Family Farm", Loc_Nm: "Smith Farm", Own_Type: "PVT", Pub_Access: "XA" } }],
      new Map(),
    );
    expect(f.properties.name).toBe("Easement · PAD-US 7");
    expect(f.properties.details?.["published name"]).toBe("Smith Family Farm");
    expect(f.properties.details?.["local name"]).toBeUndefined();
    expect(searchableDetail("published name")).toBe(false);
  });
  it("brings easements through with their holder, keeping the holder type's published code", () => {
    const domains = new Map([
      ["Category", new Map([["Easement", "Easement"]])],
      ["Own_Type", new Map([["DIST", "Regional Agency Special District"]])],
      ["Pub_Access", new Map([["OA", "Open Access"]])],
    ]);
    const [f] = buildPublicLands(
      [{ geometry: square, properties: { OBJECTID: 1, Category: "Easement", Unit_Nm: "Palo Alto College", Own_Type: "DIST", Loc_Own: "DIST", EsmtHldr: "Alamo Community College District", EHoldTyp: "DIST", Pub_Access: "OA", GIS_Acres: 161 } }],
      domains,
    );
    const d = f.properties.details!;
    expect(d["easement holder"]).toBe("Alamo Community College District");
    expect(d["easement holder type"]).toBe("DIST (Regional Agency Special District)");
    expect(d["local owner"]).toBe("DIST");
    expect(d["public access"]).toBe("open access");
    expect(String(d.note)).toMatch(/owner keeps the land/);
    // Only what the style and note need rides in `extra`; the rest travels once, as dossier lines.
    // Plus the record text (lib/catalog/recordText.ts): decoded categories only, never the unit's name or the holder.
    expect(Object.keys(f.properties.extra as PublicLandExtra).sort()).toEqual(["access", "acres", "category", "embedText"]);
    const text = (f.properties.extra as { embedText: string }).embedText;
    // B0 (2026-10-18): the card's head comes first; an easement never carries its unit name, even with a public owner.
    expect(text).toBe(
      "collection: Protected areas and public lands (PAD-US); agency: U.S. Geological Survey; protected area category: Easement; owner type: Regional Agency Special District; public access: Open Access",
    );
    expect(text).not.toMatch(/Palo Alto|Alamo/);
  });

  it("says access is unknown when PAD-US has no code, and leaves an unknown coded value as its code", () => {
    const [f] = buildPublicLands([{ geometry: square, properties: { OBJECTID: 2, Category: "Fee", Mang_Name: "ZZZ" } }], new Map());
    expect((f.properties.extra as PublicLandExtra).access).toBe("unknown");
    expect(f.properties.details?.["public access"]).toBe("unknown (not reported to PAD-US)");
    expect(f.properties.details?.manager).toBe("ZZZ");
    expect(f.properties.details?.["easement holder"]).toBeUndefined();
  });

  it("trims parts outside the box or smaller than the generalisation, and says how many", () => {
    const part = (x: number, y: number, d: number) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
    const g: MultiPolygon = { type: "MultiPolygon", coordinates: [part(0.1, 0.1, 0.5), part(0.2, 0.2, 0.0001), part(5, 5, 0.5)] };
    const t = trimParts(g, [0, 0, 1, 1], 0.0025);
    expect(t.dropped).toBe(2);
    expect((t.geometry as MultiPolygon).coordinates).toHaveLength(1);
    const specks: MultiPolygon = { type: "MultiPolygon", coordinates: [part(0.2, 0.2, 0.0001), part(0.3, 0.3, 0.0002)] };
    const s = trimParts(specks, [0, 0, 1, 1], 0.0025);
    // The largest part in the box is always kept, and it is the larger of the two specks.
    expect((s.geometry as MultiPolygon).coordinates).toHaveLength(1);
    expect((s.geometry as MultiPolygon).coordinates[0][0][0][0]).toBe(0.3);
    const [f] = buildPublicLands([{ geometry: g, properties: { OBJECTID: 9, Category: "Designation", Unit_Nm: "Coastal" } }], new Map(), { box: [0, 0, 1, 1], minDeg: 0.0025 });
    expect(String(f.properties.details?.outline)).toMatch(/^2 of its 3 parts not drawn/);
  });
});

// ---------------------------------------------------------------- USGS EPQS

describe("parseEpqs", () => {
  it("reads the string value EPQS sends, with the DEM resolution", () => {
    expect(parseEpqs(-98.47, 29.465, { value: "221.37", resolution: 1, rasterId: 7 })).toEqual({ lon: -98.47, lat: 29.465, metres: 221.37, resolutionM: 1, rasterId: 7 });
  });
  it("turns the -1000000 'no data' sentinel into no value, never a depth", () => {
    const r = parseEpqs(-90, 25, { value: -1000000, resolution: null });
    expect(r.metres).toBeUndefined();
    expect(r.resolutionM).toBeUndefined();
  });
});

describe("NOAA Fisheries fields", () => {
  it("parses both slash date forms and NOAA's one yyyymmdd, and nothing else", async () => {
    const { nmfsDate, nmfsFr } = await import("./features");
    expect(nmfsDate("8/17/2017")).toBe("2017-08-17");
    expect(nmfsDate("08/09/2023")).toBe("2023-08-09");
    expect(nmfsDate("20240102")).toBe("2024-01-02");
    expect(nmfsDate("13/01/2020")).toBeUndefined();
    expect(nmfsDate("soon")).toBeUndefined();
    expect(nmfsDate(" ")).toBeUndefined();
    expect(nmfsFr("<a href='https://example.gov/rule' target='_top'>70 FR 52629</a>")).toEqual({ text: "70 FR 52629", url: "https://example.gov/rule" });
    expect(nmfsFr("<a href='http://example.gov/rule'>70 FR 52629</a>")).toEqual({ text: "70 FR 52629", url: undefined });
    expect(nmfsFr("73 FR 72210")).toEqual({ text: "73 FR 72210" });
    expect(nmfsFr("<b>odd</b>")).toBeUndefined();
  });
});
