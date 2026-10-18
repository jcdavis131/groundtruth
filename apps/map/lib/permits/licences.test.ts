// Licence adapters on payloads captured from each registry on 2026-09-26 with
// the route's own requests, curated to about 18 rows each (Chicago: the Loop,
// -87.6375,41.875,-87.6225,41.885; San Francisco: the Financial District,
// -122.405,37.785,-122.395,37.795). Names that may be a person's (registrant
// and legal names without an entity form, a trade name equal to one, the
// names on the rows the home heuristic withholds) were replaced in the
// fixtures with one "[removed from this fixture: ...]" marker, so a trade name
// and a legal name that were the same name are still the same string; the
// tests prove the marker never reaches a record. No network.
import { describe, expect, it } from "vitest";
import { buildLicences, displayName, homeBased, isEntityName, licenceRequestUrl, SAME_AS_REGISTRANT, type LicenceSourceId } from "./licences";

import nysla from "./fixtures/licences-nysla.json";
import chicago from "./fixtures/licences-chicago.json";
import sf from "./fixtures/licences-sanfrancisco.json";
import la from "./fixtures/licences-losangeles.json";
import nycdcwp from "./fixtures/licences-nycdcwp.json";

type Row = Record<string, unknown>;
const R = (j: unknown) => j as Row[];

describe("name rules", () => {
  it("recognises entity forms at the end of a name, and nothing else", () => {
    for (const n of ["ATHENA PARKING INC", "Aromati LLC", "Sakura Mini Market No.2 Corp.", "CHEZ JOSEPHINE LTD", "Seven Post Investment Office Lp", "Hawkwood Biotech, LLC", "THE HOLLYWOOD LOCATION COMPANY INC"]) {
      expect(isEntityName(n), n).toBe(true);
    }
    for (const n of ["JANE Q PUBLIC", "Inc Fashion", "CORPORATE CAFE", "", undefined]) expect(isEntityName(n as string), String(n)).toBe(false);
  });
  it("prefers the trade name, falls back to an entity's legal name, and otherwise names no one", () => {
    expect(displayName("JEWELRY CORNER", "A PERSON")).toEqual({ name: "JEWELRY CORNER" });
    expect(displayName("", "ASHAPURI DIAMONDS INC")).toEqual({ name: "ASHAPURI DIAMONDS INC" });
    const none = displayName(undefined, "A PERSON");
    expect(none.name).toBeUndefined();
    expect(none.nameNote).toMatch(/may be a person/);
  });
  it("withholds a trade name that is a person-shaped registrant's own name, ignoring case, spacing and punctuation", () => {
    for (const [dba, legal] of [["Jane Q Public", "JANE Q PUBLIC"], ["Jane Q. Public", "JANE Q PUBLIC"], ["JANE  Q  PUBLIC", "Jane Q Public"]]) {
      expect(displayName(dba, legal), `${dba} / ${legal}`).toEqual({ nameNote: SAME_AS_REGISTRANT });
    }
    // Only the same name: a trade name that merely contains it is shown as published.
    expect(displayName("Jane Q Public Bakery", "JANE Q PUBLIC")).toEqual({ name: "Jane Q Public Bakery" });
    // A company trading under its own name keeps it.
    expect(displayName("Hora Express LLC", "Hora Express LLC")).toEqual({ name: "Hora Express LLC" });
    expect(displayName("PREMIUM PARKING SERVICE, L.L.C.", "PREMIUM PARKING SERVICE, L.L.C.")).toEqual({ name: "PREMIUM PARKING SERVICE, L.L.C." });
  });
});

describe("the home-business heuristic on real address strings", () => {
  it("withholds apartment, unit and bare-# addresses", () => {
    for (const a of ["123 S FIGUEROA STREET APT #501", "550 S HILL STREET UNIT #1470", "24 E WASHINGTON ST  875 UNIT37", "73 W MONROE ST  #507", "690 Market St Unit 503", "220 Montgomery St # 2000", "404 S FIGUEROA STREET #302"]) {
      expect(homeBased(a), a).toBe(true);
    }
    expect(homeBased("350 5TH AVE", "APT")).toBe(true);
    expect(homeBased("350 5TH AVE", "UNIT")).toBe(true);
  });
  it("keeps suites, floors and rooms", () => {
    for (const a of ["(Store #1-6)", "550 S HILL STREET SUITE #1390", "112 W 9TH STREET SUITE #803", "582 Market St Ste 1405", "120 Kearny St Fl 6", "427 S LA SALLE ST 3RD FL #303-1", "501 5th Ave Rm 1801", "73 W MONROE ST 5 525"]) {
      expect(homeBased(a), a).toBe(false);
    }
    expect(homeBased("350 5TH AVE", "STE")).toBe(false);
    expect(homeBased(undefined)).toBe(false);
  });
});

describe("registries on captured payloads", () => {
  const check = (src: LicenceSourceId, rows: Row[]) => {
    const b = buildLicences(src, rows);
    // No removed name ever reaches a record.
    expect(JSON.stringify(b.records)).not.toContain("[removed from this fixture");
    return b;
  };

  it("NY SLA: the DBA, or the entity's legal name; a person-shaped legal name is never shown", () => {
    const b = check("nysla", R(nysla));
    expect(b.records.length).toBeGreaterThan(12);
    expect(b.records.find((r) => r.name === "CHIPOTLE MEXICAN GRILL #1321")).toBeTruthy();
    expect(b.records.find((r) => r.name === "BARRELMORE WINE & SPIRITS INC")).toBeTruthy();
    expect(b.records.every((r) => r.category)).toBe(true);
  });

  it("Chicago: trade names, withheld where one is the person-shaped legal name; legal_name asked for that, never shown; unit addresses withheld", () => {
    const b = check("chicago", R(chicago));
    expect(b.withheld).toBe(2);
    expect(b.records.length).toBe(16);
    expect(b.records.map((r) => r.name)).toEqual(expect.arrayContaining(["THE KTM KITCHEN", "HFR HOLDINGS, LLC", "WORLD HAIR INSTITUTE"]));
    // The two rows whose trade name was the registrant's own name carry the note, not a name.
    expect(b.records.filter((r) => r.nameNote === SAME_AS_REGISTRANT).length).toBe(2);
    // An entity's legal name behind a different trade name is not shown either.
    expect(JSON.stringify(b.records)).not.toContain("KTM KITCHEN LLC");
    expect(new URL(licenceRequestUrl("chicago", [-87.635, 41.88, -87.625, 41.887], "2026-09-26")).searchParams.get("$select")).toContain("legal_name");
  });

  it("San Francisco: ownership_name asked for the comparison only; it and the mailing address never reach a record", () => {
    const b = check("sanfrancisco", R(sf));
    expect(b.withheld).toBe(4);
    expect(b.records.length).toBe(15);
    const json = JSON.stringify(b.records);
    expect(json).not.toMatch(/ownership|mailing|mail_/i);
    expect(json).not.toContain("Buena Esperanza Inc");
    expect(b.records.map((r) => r.name)).toEqual(expect.arrayContaining(["Genmo, Inc.", "B E Properties"]));
    expect(b.records.filter((r) => r.nameNote === SAME_AS_REGISTRANT).length).toBe(2);
    expect(new URL(licenceRequestUrl("sanfrancisco", [-1, 1, 0, 2], "2026-09-26")).searchParams.get("$select")).toContain("ownership_name");
  });

  it("Los Angeles: DBA first, entity business names second, no name for the rest", () => {
    const b = check("losangeles", R(la));
    expect(b.records.map((r) => r.name)).toEqual(expect.arrayContaining(["ANNA'S FISH MARKET", "UNITED VALET PARKING INC"]));
    const unnamed = b.records.filter((r) => !r.name);
    expect(unnamed.length).toBe(2);
    expect(unnamed.every((r) => /may be a person/.test(r.nameNote ?? ""))).toBe(true);
  });

  it("New York City: premises licences only, unit-type APT and UNIT withheld, no phone requested", () => {
    const b = check("nycdcwp", R(nycdcwp));
    expect(b.withheld).toBe(3);
    expect(b.records.map((r) => r.name)).toContain("EMPIRE DIAMOND CORPORATION");
    const url = licenceRequestUrl("nycdcwp", [-73.99, 40.745, -73.98, 40.755], "2026-09-26");
    expect(url).not.toContain("contact_phone");
    expect(new URL(url).searchParams.get("$where")).toContain("license_type='Premises'");
  });

  it("asks every registry for named columns, San Francisco included, and never a mailing address or phone", () => {
    for (const src of ["nysla", "chicago", "sanfrancisco", "losangeles", "nycdcwp"] as const) {
      const url = new URL(licenceRequestUrl(src, [-1, 1, 0, 2], "2026-09-26"));
      expect(url.searchParams.get("$select"), src).toBeTruthy();
      expect(url.searchParams.get("$select"), src).not.toMatch(/mail|phone/);
    }
    expect(new URL(licenceRequestUrl("sanfrancisco", [-1, 1, 0, 2], "2026-09-26")).host).toBe("data.sf.gov");
  });
});
