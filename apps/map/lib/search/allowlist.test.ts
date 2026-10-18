import { describe, expect, it } from "vitest";
import type { BaseProps } from "@/lib/layers/types";
import { matchScore, searchableDetail, SEARCHABLE_DETAILS } from "./allowlist";

const props = (p: Partial<BaseProps>): BaseProps => ({ id: "x", layer: "publiclands", name: "Unit", source: "t", ...p });

describe("the search allowlist", () => {
  it("never lists an owner, operator, manager, holder, bank or recipient field", () => {
    for (const k of ["owner", "local owner", "owner type", "operator", "manager", "easement holder", "easement holder type", "bank", "provider", "HQ", "recipient", "issued by", "owning railroads (reporting marks)", "trackage rights", "reporting entity (EIA)", "from substation", "to substation"]) {
      expect(searchableDetail(k), k).toBe(false);
    }
    for (const k of SEARCHABLE_DETAILS) expect(k).toBe(k.toLowerCase());
  });

  it("finds a public land by its name but not by the owner or easement holder PAD-US publishes", () => {
    const unit = props({ name: "Palo Alto College", details: { owner: "Alamo Community College District", "easement holder": "Bexar Land Trust", county: "Bexar" } });
    expect(matchScore(unit, "palo alto")).toBe(2);
    expect(matchScore(unit, "alamo community")).toBe(0);
    expect(matchScore(unit, "land trust")).toBe(0);
    // A place field is fine.
    expect(matchScore(unit, "bexar")).toBe(1);
  });

  it("finds an aircraft by registration or callsign, never by its operator", () => {
    const ac = props({ layer: "aircraft", id: "a1b2c3", name: "UAL123", details: { registration: "N12345", operator: "Some Holdings LLC", callsign: "UAL123" } });
    expect(matchScore(ac, "n12345")).toBe(1);
    expect(matchScore(ac, "a1b2")).toBe(2);
    expect(matchScore(ac, "holdings")).toBe(0);
  });

  it("matches published identifiers that come as numbers (FDIC cert, construct code)", () => {
    expect(matchScore(props({ layer: "banks", name: "Branch", details: { "FDIC cert": 3510 } }), "3510")).toBe(1);
    expect(matchScore(props({ layer: "constructs", name: "Bexar County", details: { code: "48029" } }), "48029")).toBe(1);
  });

  it("finds a game by its teams and league (the name is the abbreviated score line)", () => {
    const game = props({ layer: "sports", id: "401", name: "DAL @ NYG", details: { league: "NFL", matchup: "Dallas Cowboys @ New York Giants", venue: "MetLife Stadium, East Rutherford, NJ", broadcast: "FOX" } });
    expect(matchScore(game, "cowboys")).toBe(1);
    expect(matchScore(game, "nfl")).toBe(1);
    expect(matchScore(game, "metlife")).toBe(1);
    expect(matchScore(game, "fox")).toBe(0);
  });

  it("finds a company by sector and SIC, never by its HQ address", () => {
    const co = props({ layer: "companies", id: "320193", name: "Apple Inc.", details: { ticker: "AAPL · Nasdaq", CIK: "320193", sector: "Information Technology · XLK", SIC: "3571 Electronic Computers", HQ: "Cupertino, CA 95014" } });
    expect(matchScore(co, "information technology")).toBe(1);
    expect(matchScore(co, "electronic computers")).toBe(1);
    expect(matchScore(co, "3571")).toBe(1);
    expect(matchScore(co, "cupertino")).toBe(0);
  });

  it("finds a ship by its destination and an aircraft by its origin country, never by operator", () => {
    const ship = props({ layer: "ships", id: "230000000", name: "NORDIC STAR", details: { mmsi: 230000000, destination: "HELSINKI" } });
    expect(matchScore(ship, "helsinki")).toBe(1);
    const plane = props({ layer: "aircraft", id: "abc123", name: "DLH400", details: { "origin country": "Germany", operator: "Deutsche Lufthansa AG" } });
    expect(matchScore(plane, "germany")).toBe(1);
    expect(matchScore(plane, "lufthansa")).toBe(0);
  });

  it("finds a launch by its vehicle and pad, never by its provider", () => {
    const launch = props({ layer: "launches", id: "l1", name: "Starlink Group 10-1", details: { vehicle: "Falcon 9 Block 5", pad: "SLC-40", provider: "SpaceX" } });
    expect(matchScore(launch, "falcon 9")).toBe(1);
    expect(matchScore(launch, "spacex")).toBe(0);
  });

  it("finds a bank branch by the bank's name only because FDIC puts it in the branch name, never through the bank field", () => {
    // lib/finance/features.ts names a branch "<bank> · <office>"; the ethics text says so rather than claiming otherwise.
    const branch = props({ layer: "banks", id: "3511:1", name: "Wells Fargo Bank · CONGRESS AVENUE BRANCH", details: { bank: "Wells Fargo Bank, National Association", "FDIC cert": 3511 } });
    expect(matchScore(branch, "wells fargo")).toBe(2);
    expect(matchScore(branch, "congress avenue")).toBe(1);
    // Only the bank field carries the legal name; the palette never reads it.
    expect(matchScore(branch, "national association")).toBe(0);
  });

  it("finds a zoning district by its code, never by its ordinance or the city's description", () => {
    const d = props({ layer: "zoning", id: "zoning:point:47.60670,-122.33250", name: "DOC1 U/450-U Â· Seattle", details: { zoning: "DOC1 U/450-U", ordinance: "125291", description: "Downtown Office Core 1 U/450-U", city: "Seattle" } });
    expect(matchScore(d, "doc1")).toBe(2);
    expect(matchScore(d, "u/450")).toBe(1);
    expect(matchScore(d, "125291")).toBe(0);
    expect(matchScore(d, "office core")).toBe(0);
  });

  it("searches permit and licence numbers and licence types, never an address, contractor, facility, project or licensee", () => {
    for (const k of ["permit number", "licence number", "licence type", "permit id"]) expect(searchableDetail(k), k).toBe(true);
    for (const k of ["address", "contractor (as published)", "facility (as EPA publishes it)", "project (as the Corps publishes it)", "name", "registry", "publisher", "description"]) {
      expect(searchableDetail(k), k).toBe(false);
    }
  });

  it("scores exact over prefix over contained, and never matches a loaded box", () => {
    expect(matchScore(props({ name: "Zone AE" }), "zone ae")).toBe(3);
    expect(matchScore(props({ name: "Zone AE" }), "zone")).toBe(2);
    expect(matchScore(props({ name: "Big Zone" }), "zone")).toBe(1);
    expect(matchScore(props({ name: "Loaded area", kind: "loaded-box", details: { zone: "AE" } }), "loaded")).toBe(0);
  });

  it("never matches a label-only name (nameNotSearchable), but still the id and allowlisted fields", () => {
    const p = props({ id: "housing:lihtc:WAA00000117", layer: "housing", kind: "lihtc", name: "803-28TH ST", nameNotSearchable: true, details: { "HUD id": "WAA00000117", address: "803 28TH ST, ANACORTES, WA 98221" } });
    for (const q of ["803-28th st", "803", "28th st", "anacortes"]) expect(matchScore(p, q), q).toBe(0);
    expect(matchScore(p, "waa00000117")).toBe(1);
    expect(matchScore(p, "housing:lihtc:waa00000117")).toBe(3);
    // the same props without the flag would be found by the name
    expect(matchScore({ ...p, nameNotSearchable: undefined }, "803-28th st")).toBe(3);
  });
});

describe("the search allowlist on infrastructure layers", () => {
  it("finds a dam, an airport and a plant by the registry's identifier, never by owner or operator", () => {
    const dam = props({ layer: "dams", id: "nid:TX01432", name: "Victor Braunig Dam", details: { "NID id": "TX01432", "owner type": "Local Government" } });
    expect(matchScore(dam, "tx01432")).toBe(1);
    expect(matchScore(dam, "local government")).toBe(0);
    const line = props({ layer: "transmission", id: "hifld-tl:312435", name: "138 kV line", details: { owner: "ONCOR ELECTRIC DELIVERY CO.", "HIFLD id": "312435" } });
    expect(matchScore(line, "oncor")).toBe(0);
    const plant = props({ layer: "plants", id: "eia:3612", name: "V H Braunig", details: { "EIA plant id": 3612, "reporting entity (EIA)": "City of San Antonio - (TX)" } });
    expect(matchScore(plant, "3612")).toBe(1);
    expect(matchScore(plant, "city of san antonio")).toBe(0);
    const rail = props({ layer: "rail", id: "narn:441507", name: "CORPUS CHRISTI subdivision", details: { "owning railroads (reporting marks)": "UP", "trackage rights": "AMTK" } });
    expect(matchScore(rail, "amtk")).toBe(0);
  });
  it("finds a PLSS section by its township, range and section", () => {
    const sec = props({ layer: "plss", id: "plss-s:OK170120N0030W0SN330", name: "Section 33", details: { section: "33", "PLSS id": "OK170120N0030W0" } });
    expect(matchScore(sec, "ok170120n0030w0")).toBe(1);
  });
});

describe("hospitals", () => {
  it("finds a hospital by a bare HIFLD id and by each field its card lists, never by owner type, address or industry", async () => {
    const { buildHospitals } = await import("@/lib/infra/hospitals");
    const { collection } = await import("@/lib/catalog/collections");
    // FEMA RAPT's own row (lib/infra/fixtures/hosp-box-austin.json, captured 2026-10-17).
    const row = {
      ID: "0133978746", NAME: "ARISE AUSTIN MEDICAL CENTER", ADDRESS: "3003 BEE CAVE ROAD", CITY: "AUSTIN", STATE: "TX", ZIP: "78746",
      TYPE: "GENERAL ACUTE CARE", STATUS: "OPEN", COUNTYFIPS: "48453", BEDS: 19, TRAUMA: "NOT AVAILABLE", HELIPAD: "N", OWNER: "PROPRIETARY",
      NAICS_DESC: "GENERAL MEDICAL AND SURGICAL HOSPITALS", SOURCE: "https://www.hhs.texas.gov/providers/health-care-facilities-regulation",
      SOURCEDATE: 1709856000000, VAL_DATE: 1418083200000, WEBSITE: "NOT AVAILABLE",
    };
    const [f] = buildHospitals([{ geometry: { type: "Point", coordinates: [-97.79, 30.27] }, properties: row }]);
    // The bare id, as typed into the palette: the feature id is "hifld-hosp:<ID>", so only the dossier key finds it.
    expect(searchableDetail("HIFLD id")).toBe(true);
    expect(matchScore(f.properties, "0133978746")).toBe(1);
    const card = collection("hifld-hospitals")!;
    for (const field of card.searchable) {
      expect(matchScore(f.properties, String(row[field as keyof typeof row]).toLowerCase()), field).toBeGreaterThan(0);
    }
    for (const no of ["proprietary", "bee cave", "3003", "tx 78746", "general medical and surgical", "hhs.texas.gov"]) expect(matchScore(f.properties, no), no).toBe(0);
  });
});

describe("historic places", () => {
  it("finds a National Register listing by its NRIS number, never by the property's name (which can be a person's)", async () => {
    const { buildHistoric } = await import("@/lib/land/features");
    const [f] = buildHistoric(
      // NPS's own record, layer 0, 2026-10-12.
      [{ geometry: { type: "Point", coordinates: [-98.499705, 29.426095] }, properties: { OBJECTID: 1408741, NRIS_Refnum: "100005535", RESNAME: "Milam, Ben, Statue", ResType: "object", City: "San Antonio", County: "Bexar", State: "TEXAS", Is_NHL: null, CertDate: "2020-08-" } }],
      "point",
    );
    expect(searchableDetail("property name (as NPS lists it)")).toBe(false);
    expect(matchScore(f.properties, "milam")).toBe(0);
    expect(matchScore(f.properties, "100005535")).toBeGreaterThan(0);
    // A place field is still a place.
    expect(matchScore(f.properties, "bexar")).toBe(1);
  });
});
