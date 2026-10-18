// TRI release quantities. Fixtures are real Envirofacts answers captured
// 2026-10-13 and projected to the TRI_KEEP allowlist BEFORE they were written
// to disk (the raw bodies carry the certifying official's and contacts' names,
// phones and emails and were never saved):
//   tri-r-77536DRPRK5900H-2024-trimmed  Deer Park 2024 Form R join, the rows of
//                                       two chemicals (dioxins in grams, phenanthrene
//                                       in pounds) of 490, unmodified
//   tri-r-91331MCPRD12306-2024          a facility's 2024 Form R rows (11)
//   tri-a-91331MCPRD12306-2024          the same facility's 2024 Form A list (5)
//   tri-r-47905CTRPL3701S-1997          a 1997 filing with range codes
import { describe, expect, it } from "vitest";
import deerPark from "./fixtures/tri-r-77536DRPRK5900H-2024-trimmed.json";
import formR from "./fixtures/tri-r-91331MCPRD12306-2024.json";
import formA from "./fixtures/tri-a-91331MCPRD12306-2024.json";
import ranged from "./fixtures/tri-r-47905CTRPL3701S-1997.json";
import { projectTri, TRI_KEEP, triDefaultYears, triFormA, triReleases, triTotals, TRIFID_RE, triReleaseUrl } from "./tri";

describe("the allowlist", () => {
  it("keeps only the allowlisted fields, whatever else Envirofacts sends", () => {
    // A real projected row, given every certifier and contact column name Envirofacts sent on
    // 2026-10-13 (values here are test stand-ins, not anyone's details).
    const contactColumns = ["certif_date_signed", "certif_name", "certif_official_title", "certif_signature", "public_contact_email", "public_contact_person", "public_contact_phone", "public_phone_ext", "technical_contact_email", "technical_contact_person", "technical_contact_phone", "technical_phone_ext"];
    const row = { ...(deerPark as Array<Record<string, unknown>>)[0], ...Object.fromEntries(contactColumns.map((k) => [k, "stand-in"])), tri_facility_id: "77536DRPRK5900H", pref_longitude: 95.1 };
    const [p] = projectTri([row]);
    expect(Object.keys(p).sort()).toEqual([...TRI_KEEP].sort());
    for (const k of contactColumns) expect(p).not.toHaveProperty(k);
    expect(JSON.stringify(p)).not.toContain("stand-in");
    expect(projectTri({ error: "x" })).toEqual([]);
  });

  it("checks the facility id and builds Envirofacts' own join", () => {
    expect(TRIFID_RE.test("77012HLLPT9701M")).toBe(true);
    expect(TRIFID_RE.test("77012hllpt9701m")).toBe(false);
    expect(TRIFID_RE.test("77012HLLPT9701M/../x")).toBe(false);
    expect(triReleaseUrl("77012HLLPT9701M", 2024)).toBe(
      "https://data.epa.gov/dmapservice/tri.tri_reporting_form/tri_facility_id/equals/77012HLLPT9701M/and/reporting_year/equals/2024/join/tri.tri_release_qty/doc_ctrl_num/equals/doc_ctrl_num/join/tri.tri_chem_info/tri_chem_id/equals/tri_chem_id/JSON",
    );
    expect(triDefaultYears(new Date("2026-10-13T00:00:00Z"))).toEqual([2024, 2023]);
  });
});

describe("releases and totals", () => {
  it("never adds grams to pounds, and keeps a reported 0 as 0", () => {
    const rows = triReleases(projectTri(deerPark));
    expect(rows.length).toBe(24);
    const totals = triTotals(rows);
    expect(new Set(totals.map((t) => t.unit))).toEqual(new Set(["Pounds", "Grams"]));
    for (const t of totals) expect(rows.filter((r) => r.medium === t.medium && r.unit === t.unit && r.amount != null).length).toBe(t.rows);
    const zero = rows.find((r) => r.chemical === "Phenanthrene" && r.medium === "OTH DISP")!;
    expect(zero.amount).toBe(0);
    expect(zero.notApplicable).toBe(false);
    expect(totals.find((t) => t.medium === "WATER" && t.unit === "Pounds")).toEqual({ medium: "WATER", mediumLabel: "surface water", unit: "Pounds", amount: 1, rows: 2 });
    expect(totals.find((t) => t.medium === "AIR STACK" && t.unit === "Grams")).toMatchObject({ amount: 0.587, rows: 1 });
  });

  it("reads 'NA' rows as not applicable, null and outside the totals, never 0", () => {
    const rows = triReleases(projectTri(formR));
    const na = rows.filter((r) => r.notApplicable);
    expect(na.length).toBeGreaterThan(0);
    for (const r of na) expect(r.amount).toBeNull();
    const total = triTotals(rows).reduce((n, t) => n + t.rows, 0);
    expect(total).toBe(rows.filter((r) => r.amount != null).length);
  });

  it("shows a range report as its range, not a number", () => {
    const rows = triReleases(projectTri(ranged));
    const r = rows.find((x) => x.range)!;
    expect(r.range).toBe("range B: 11-499 pounds");
    expect(r.amount).toBeNull();
    expect(triTotals(rows.filter((x) => x.range))).toEqual([]);
  });

  it("lists Form A certifications as chemicals without quantities", () => {
    expect(triFormA(projectTri(formA)).map((f) => f.chemical)).toEqual(["Methanol", "Ethylbenzene", "Ethylene glycol", "Xylene (mixed isomers)", "N-Methyl-2-pyrrolidone"]);
    // The Form R join never holds Form A rows.
    expect(triReleases(projectTri(formA))).toEqual([]);
  });
});
