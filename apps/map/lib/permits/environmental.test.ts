// EPA ECHO and USACE ORM adapters on payloads captured on 2026-09-26 for the
// Houston Ship Channel. ECHO: (-95.2,29.7,-95.0,29.78), first 25 rows each.
// ORM: the route's own request for (-95.2,29.7,-95,29.8), all 300 actions it
// answered: the 172 in the box, then 128 from elsewhere in the country that
// pad the answer to its maximum. In the fixture the Corps' applicant and
// requester strings were replaced (they embed personal names; the adapter
// never reads them), the name fields of the padding rows were cut, and seven
// in-box project names that open with a person's name had that name cut.
// No network.
import { describe, expect, it } from "vitest";
import {
  buildAir,
  buildNpdes,
  buildUsace,
  echoDate,
  echoFacilities,
  echoFacilitiesUrl,
  echoQidUrl,
  echoQuery,
  opensWithPersonalName,
  ORM_MAX,
  ormDate,
  ormFeatures,
  ormInBox,
  ormUrl,
} from "./environmental";
import type { Bbox } from "@/lib/zoning/features";

import cwaQuery from "./fixtures/echo-npdes-query.json";
import cwaRows from "./fixtures/echo-npdes-rows.json";
import airQuery from "./fixtures/echo-air-query.json";
import airRows from "./fixtures/echo-air-rows.json";
import orm from "./fixtures/usace-orm.json";

describe("EPA ECHO", () => {
  it("reads the query id and row count from get_facilities", () => {
    expect(echoQuery(cwaQuery)).toMatchObject({ rows: 459 });
    expect(echoQuery(airQuery)).toMatchObject({ rows: 120 });
    expect(echoQuery({ Results: { Error: { ErrorMessage: "x" } } })).toBeNull();
  });

  it("asks get_qid for named columns, including the longitude the default set leaves out", () => {
    const url = echoQidUrl("npdes", "161");
    expect(url).toContain("qcolumns=");
    expect(decodeURIComponent(url)).toContain(",24,25,");
    expect(echoFacilitiesUrl("air", [-95.2, 29.7, -95, 29.78])).toContain("p_c1lon=-95.2");
  });

  it("NPDES: named by permit id, facility kept for the dossier, dates from MM/DD/YYYY", () => {
    const r = buildNpdes(echoFacilities(cwaRows));
    expect(r.length).toBe(25);
    expect(r[0]).toMatchObject({ program: "npdes", number: "TXR1509LI", facility: "0 BAYWAY DRIVE BAYTOWN TX 77520", dateLabel: "permit expires" });
    expect(r[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.every((x) => Number.isFinite(x.lon) && Number.isFinite(x.lat))).toBe(true);
    expect(r[0].url).toMatch(/^https:\/\/echo\.epa\.gov\/detailed-facility-report\?fid=/);
  });

  it("air: ECHO's compliance words kept; a missing status says 'not reported by ECHO', never 'no violation'", () => {
    const r = buildAir(echoFacilities(airRows));
    expect(r.length).toBe(25);
    expect(r.every((x) => typeof x.compliance === "string" && x.compliance.length > 0)).toBe(true);
    const missing = buildAir([{ SourceID: "X1", FacLat: "29.7", FacLong: "-95.1", AIRName: "SITE" }]);
    expect(missing[0].compliance).toBe("not reported by ECHO");
  });

  it("parses ECHO and ORM dates and nothing else", () => {
    expect(echoDate("03/04/2028")).toBe("2028-03-04");
    expect(echoDate("2028-03-04")).toBeUndefined();
    expect(ormDate("20250617")).toBe("2025-06-17");
    expect(ormDate("05/22/2025")).toBe("2025-05-22");
    expect(ormDate("N/A")).toBeUndefined();
  });
});

describe("USACE ORM", () => {
  const BOX: Bbox = [-95.2, 29.7, -95, 29.8];
  const pt = (x: number, y: number) => ({ geometry: { type: "Point" as const, coordinates: [x, y] }, properties: { daNumber: `SWG-${x}-${y}` } });

  it("keeps the 172 actions in the box and drops the 128 the search padded its answer with", () => {
    const all = ormFeatures(orm);
    expect(all.length).toBe(ORM_MAX);
    const box = ormInBox(all, BOX);
    expect(box.features.length).toBe(172);
    expect(box.outside).toBe(127); // and one padding row with no point at all
    // Padding came from elsewhere, so every action in the box came back.
    expect(box.partial).toBe(false);
    for (const f of box.features) {
      const [x, y] = (f.geometry as GeoJSON.Point).coordinates;
      expect(x >= BOX[0] && x <= BOX[2] && y >= BOX[1] && y <= BOX[3]).toBe(true);
    }
  });

  it("calls the box cut short only when the search's maximum all lay inside it", () => {
    const full = Array.from({ length: ORM_MAX }, (_, i) => pt(-95.1, 29.71 + i / 10_000));
    expect(ormInBox(full, BOX)).toMatchObject({ outside: 0, partial: true });
    // One from outside means the in-box actions ran out before the maximum.
    expect(ormInBox([...full.slice(1), pt(-81.9, 26.5)], BOX)).toMatchObject({ outside: 1, partial: false });
    // Fewer than the maximum, all inside: the box's every action.
    expect(ormInBox(full.slice(0, 40), BOX).partial).toBe(false);
    // Edges count as inside; a feature with no point is neither.
    expect(ormInBox([pt(-95.2, 29.8), { geometry: null, properties: {} }], BOX)).toMatchObject({ outside: 0 });
    expect(ormInBox([pt(-95.2, 29.8)], BOX).features.length).toBe(1);
  });

  it("never keeps the applicant or a 408 requester, names by DA or request number, newest first", () => {
    const r = buildUsace(ormInBox(ormFeatures(orm), BOX).features);
    expect(r.length).toBe(172);
    const json = JSON.stringify(r);
    expect(json).not.toContain("[removed from this fixture");
    expect(json).not.toContain("[cut from this fixture: a row from outside the box]");
    expect(r.find((x) => x.number === "SWG-1993-01047")).toMatchObject({ type: "Letter of Permission", status: "Issued With Special Conditions" });
    expect(r.find((x) => x.number.startsWith("408-SWG-"))?.published["record kind (ORM)"]).toBe("Section 408 permission");
    const dated = r.filter((x) => x.date).map((x) => x.date!);
    expect(dated).toEqual([...dated].sort().reverse());
  });

  it("withholds a project name that opens 'Surname, Given', and keeps a company's", () => {
    for (const n of ["Public, Jane / Build Dock & lift / Lee", "Public, Jane Q", "Public,Jane (Dock)", "Public, John & Mary LS Trust (Joint Use Dock)"]) {
      expect(opensWithPersonalName(n), n).toBe(true);
    }
    for (const n of ["Cargill, Inc. - Permit 1165305 - Maintenance Dredge", "Accutrans, Inc/ Barge Terminal/ Old River", "Harridan, Ltd - Permit No: 8954(12)", "K Solv, LP - Dredge", "Port of Houston Authority/SP/Buffalo Bayou", "Houston Jacintoport, LLC/Deepwater Dock", undefined]) {
      expect(opensWithPersonalName(n), String(n)).toBe(false);
    }
    const [rec] = buildUsace([{ geometry: { type: "Point", coordinates: [-95.1, 29.75] }, properties: { daNumber: "SWG-2026-00001", projectName: "Public, Jane / Dock" } }]);
    expect(rec.facility).toBeUndefined();
    expect(rec.facilityNote).toMatch(/opens with a personal name/);
    const r = buildUsace(ormInBox(ormFeatures(orm), BOX).features);
    expect(r.find((x) => x.number === "SWG-1997-02845")?.facility).toMatch(/^Cargill, Inc\./);
  });

  it("asks for at most 300 actions around the box", () => {
    expect(ormUrl([-95.2, 29.7, -95, 29.78])).toBe("https://permits.ops.usace.army.mil/orm-public-api/permits/search?da=true&max=300&bbox=-95.2,29.7,-95,29.78");
  });
});
