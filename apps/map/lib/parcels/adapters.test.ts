// Every adapter against a payload captured from its own service on
// 2026-09-26 (lib/parcels/fixtures, government-owned parcels only), through
// the same request code the route uses. The rules checked: each value is the
// source's own, labelled with the source's own term; blanks and placeholders
// stay missing; nothing is asked for beyond the adapter's outFields; the
// privacy rules hold.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADAPTER_BY_ID, ADAPTERS, adapterFor, COOK_ADDRESS_COLUMNS, hcadConfidential, NJ_WITHHELD, STRATMAP_FIELDS, utahService } from "./adapters";
import { CONFIDENTIAL_REASON, MASK_REASON } from "./normalize";
import type { CountyRef, ParcelRecord } from "./types";

type Fixture = {
  adapter: string;
  county: CountyRef;
  rows: Array<{ geometry: unknown; properties: Record<string, unknown> }>;
  extra?: Record<string, unknown> | null;
};

const load = (name: string): Fixture => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

function norm(name: string, row = 0): ParcelRecord {
  const fx = load(name);
  const a = ADAPTER_BY_ID.get(fx.adapter)!;
  return a.normalize(fx.rows[row].properties, { county: fx.county, extra: fx.extra });
}

const valueOf = (r: ParcelRecord, label: string) => r.values?.items.find((v) => v.label === label)?.amount;

const FIXTURES: Array<[string, string]> = [
  ["tx-stratmap-bexar.json", "tx-stratmap"],
  ["tx-stratmap-travis.json", "tx-stratmap"],
  ["tx-hcad.json", "tx-hcad"],
  ["az-maricopa.json", "az-maricopa"],
  ["ca-la.json", "ca-la"],
  ["il-cook.json", "il-cook"],
  ["wa-king.json", "wa-king"],
  ["mi-detroit.json", "mi-detroit"],
  ["wi-statewide.json", "wi-statewide"],
  ["nc-statewide.json", "nc-statewide"],
  ["mt-statewide.json", "mt-statewide"],
  ["mn-parcels.json", "mn-parcels"],
  ["fl-dor.json", "fl-dor"],
  ["ma-massgis.json", "ma-massgis"],
  ["vt-vcgi.json", "vt-vcgi"],
  ["ut-lir.json", "ut-lir"],
  ["oh-statewide.json", "oh-statewide"],
  ["nj-modiv.json", "nj-modiv"],
  ["ny-its.json", "ny-its"],
  ["ct-cama.json", "ct-cama"],
  ["md-sdat.json", "md-sdat"],
];

describe("every adapter against its captured payload", () => {
  it("has a fixture for every adapter", () => {
    expect(new Set(FIXTURES.map(([, id]) => id))).toEqual(new Set(ADAPTERS.map((a) => a.id)));
  });

  it.each(FIXTURES)("%s: the county picks this adapter, and only asked-for fields came back", (file, id) => {
    const fx = load(file);
    expect(fx.adapter).toBe(id);
    expect(adapterFor(fx.county)?.id).toBe(id);
    const a = ADAPTER_BY_ID.get(id)!;
    const asked = new Set<string>(a.kind === "identify" ? STRATMAP_FIELDS : a.outFields);
    for (const row of fx.rows) for (const k of Object.keys(row.properties)) expect(asked.has(k), `${id} returned ${k}`).toBe(true);
    // A parcel outline comes back with each point answer.
    expect(["Polygon", "MultiPolygon"]).toContain((fx.rows[0].geometry as { type: string }).type);
  });

  it.each(FIXTURES)("%s: a parcel id, no empty strings, owner state and values labelled", (file) => {
    const r = norm(file);
    expect(r.parcelId).toMatch(/\S/);
    const walk = (v: unknown): void => {
      if (typeof v === "string") expect(v.trim()).not.toBe("");
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
      else expect(v).not.toBeUndefined();
    };
    walk(r);
    expect(["published", "withheld", "not-published"]).toContain(r.owner.status);
    for (const v of r.values?.items ?? []) {
      expect(v.label).toMatch(/[a-z]/);
      expect(Number.isFinite(v.amount)).toBe(true);
    }
  });

  it("never asks a service for owner-occupancy flags", () => {
    // useclass1-4: MnGeo's use class, the homestead classification in many Minnesota counties.
    // LC_CUR: Maricopa's legal class (3.1 primary residence, 4.2 rental).
    const flags = /homestead|hsdecl|^ooi$|jv_hmstd|primary_res|pct_pre_claimed|homeownersexemp|^useclass\d$|^lc_cur$/i;
    for (const a of ADAPTERS) {
      for (const f of a.outFields) expect(f, `${a.id}.${f}`).not.toMatch(flags);
      // An outline's use field is sent for every lot in a box: it must not be one either.
      if (a.useField) expect(a.useField, `${a.id} useField`).not.toMatch(flags);
    }
  });
});

describe("Texas", () => {
  it("StratMap (Bexar, the Alamo): strings to numbers, blanks dropped, the district named", () => {
    const r = norm("tx-stratmap-bexar.json");
    expect(r.parcelId).toBe("101328");
    expect(r.otherIds).toEqual({ "geo id": "00115-000-0010" });
    expect(r.owner).toEqual({ status: "published", names: ["STATE OF TEXAS"], role: "owner" });
    // " 300  ALAMO PLZ , SAN ANTONIO, TX 78205" tidied, not rewritten.
    expect(r.situs).toBe("300 ALAMO PLZ, SAN ANTONIO, TX 78205");
    expect(r.mailing).toBe("PO BOX 29928, SAN ANTONIO, TX 78229");
    expect(r.values?.year).toBe("tax year 2025");
    expect(valueOf(r, "market value")).toBe(200_000_000);
    expect(valueOf(r, "land")).toBe(47_115_460);
    expect(r.use).toBe("state class F1 · local use CSS");
    expect(r.asOf).toBe("2025-07-01");
    expect(r.notes).toEqual(["roll from BEXAR APPRAISAL DISTRICT"]);
    // NAME_CARE repeats the owner: not shown twice.
    expect((r.owner as { careOf?: string }).careOf).toBeUndefined();
    // LEGAL_AREA "0" is not an area; the GIS area is used, and says so.
    expect(r.area?.basis).toMatch(/^GIS/);
  });

  it("StratMap: an area whose unit is blank or not recognised is not shown, never read as acres (derived: the Alamo payload with its units changed)", () => {
    const fx = load("tx-stratmap-bexar.json");
    const a = ADAPTER_BY_ID.get("tx-stratmap")!;
    const row = { ...fx.rows[0].properties, LEGAL_AREA: "43560" };
    // Both units blank: no area at all.
    expect(a.normalize({ ...row, LGL_AREA_UNIT: " ", GIS_AREA_UNIT: " " }).area).toBeUndefined();
    // "SF" is not a unit this adapter reads: the legal area is not shown; the GIS area, in its own stated unit, is.
    const sf = a.normalize({ ...row, LGL_AREA_UNIT: "SF" }).area;
    expect(sf?.basis).toMatch(/^GIS/);
    expect(sf?.unit).toBe("acres");
    expect(a.normalize({ ...row, LGL_AREA_UNIT: "SF", GIS_AREA_UNIT: "SF" }).area).toBeUndefined();
    // A stated unit is still read.
    expect(a.normalize({ ...row, LGL_AREA_UNIT: "Square Feet" }).area).toEqual({ value: 43_560, unit: "sq ft", basis: "legal (as recorded)" });
  });

  it("StratMap (Travis, the Capitol): 0 land and improvements kept as published beside the market value", () => {
    const r = norm("tx-stratmap-travis.json");
    expect(r.parcelId).toBe("0208030201");
    expect(valueOf(r, "land")).toBe(0);
    expect(valueOf(r, "market value")).toBe(41_085_275);
    expect(r.situs).toBe("TX 78701");
  });

  it("HCAD (Houston City Hall): owner, mailing, values, owned-since date and acreage", () => {
    const r = norm("tx-hcad.json");
    expect(r.parcelId).toBe("0011490000001");
    expect(r.situs).toBe("901 BAGBY ST, HOUSTON 77002");
    expect(r.owner).toEqual({ status: "published", names: ["CITY OF HOUSTON"], role: "owner" });
    expect(r.mailing).toBe("PO BOX 1562, HOUSTON TX 77251-1562");
    expect(r.ownedSince).toBe("1988-01-02");
    expect(valueOf(r, "appraised value")).toBe(19_625_000);
    expect(r.area).toEqual({ value: 1.4348, unit: "acres", basis: "HCAD acreage" });
    expect(r.legal).toBe("LTS 1 THRU 12 BLK 149 CITY HALL SSBB");
  });

  it("HCAD's confidential flag withholds the owner and drops every mailing field (derived: the City Hall payload with its flag flipped)", () => {
    const fx = load("tx-hcad.json");
    const flagged = { ...fx.rows[0].properties, confidential_flag: "YNNNNNNNNN", owner_name_1: "CURRENT OWNER" };
    expect(hcadConfidential(fx.rows[0].properties)).toBe(false);
    expect(hcadConfidential(flagged)).toBe(true);
    const r = ADAPTER_BY_ID.get("tx-hcad")!.normalize(flagged);
    expect(r.owner).toEqual({ status: "withheld", reason: CONFIDENTIAL_REASON });
    expect(r.mailing).toBeUndefined();
    expect(r.ownedSince).toBeUndefined();
    expect(r.mailingNote).toMatch(/withheld/);
    expect(JSON.stringify(r)).not.toContain("PO BOX 1562");
    // The rest of the record is the source's as before.
    expect(valueOf(r, "market value")).toBe(19_625_000);
  });
});

describe("county services", () => {
  it("Maricopa: padded comma strings parse, the zoning placeholder is not a zone, the record link", () => {
    const r = norm("az-maricopa.json");
    expect(r.parcelId).toBe("112-21-086");
    expect(valueOf(r, "full cash value")).toBe(86_794_159);
    expect(r.values?.year).toBe("tax year 2027");
    expect(r.zoning).toBeUndefined();
    expect(r.owner).toMatchObject({ names: ["PHOENIX CITY OF"] });
    // INCAREOF is "" in the payload: no care-of line.
    expect((r.owner as { careOf?: string }).careOf).toBeUndefined();
    expect(r.link?.url).toBe("https://mcassessor.maricopa.gov/mcs/?q=11221086&mod=pd");
    // The property use code only: the legal class (owner-occupancy) is not asked for.
    expect(r.use).toBe("property use code 9726");
    expect(ADAPTER_BY_ID.get("az-maricopa")!.outFields).not.toContain("LC_CUR");
  });

  it("LA County: no owner published, and null roll values stay missing rather than 0", () => {
    const r = norm("ca-la.json");
    expect(r.owner.status).toBe("not-published");
    expect(r.values).toBeUndefined();
    expect(r.situs).toBe("200 N SPRING ST LOS ANGELES CA 90012");
    expect(r.link?.url).toBe("https://portal.assessor.lacounty.gov/parceldetail/5161005906");
  });

  it("Cook: GIS record plus the parcel-address row read by PIN", () => {
    const r = norm("il-cook.json");
    expect(r.parcelId).toBe("17-09-447-004-0000");
    expect(r.owner).toEqual({ status: "published", names: ["COOK COUNTY"], role: "owner" });
    expect(r.ownerAddress).toBe("69 W WASHINGTON 1060, CHICAGO IL 60602");
    // Socrata sent no mail_address_* for this PIN: no mailing line is made up.
    expect(r.mailing).toBeUndefined();
    expect(r.notes).toContain("owner and mailing from the 2026 parcel-address table");
    expect(r.link?.url).toBe("https://www.cookcountyassessor.com/pin/17094470040000");
  });

  it("Cook without the address row says the owner is missing, never blank", () => {
    const fx = load("il-cook.json");
    const r = ADAPTER_BY_ID.get("il-cook")!.normalize(fx.rows[0].properties, { county: fx.county, extra: null });
    expect(r.owner.status).toBe("not-published");
  });

  it("Cook's second hop reads only the address columns the normalizer uses", () => {
    const fx = load("il-cook.json");
    for (const k of Object.keys(fx.extra ?? {})) expect(COOK_ADDRESS_COLUMNS as readonly string[]).toContain(k);
  });

  it("King: property name is the building's, the owner is on eRealProperty (linked)", () => {
    const r = norm("wa-king.json");
    expect(r.propertyName).toBe("SEATTLE CITY HALL (SEATTLE MUNICIPAL BUILDING)");
    expect(r.owner.status).toBe("not-published");
    expect(r.use).toBe("Office Building · property type C");
    expect(r.link?.url).toBe("https://blue.kingcounty.com/Assessor/eRealProperty/Detail.aspx?ParcelNbr=0942000810");
  });

  it("Detroit publishes taxpayers, labelled as taxpayers", () => {
    const r = norm("mi-detroit.json");
    expect(r.owner).toEqual({ status: "published", names: ["DETROIT-WAYNE JOINT BUILDING AUTH", "CITYOWNED ADMIN"], role: "taxpayer" });
    expect(valueOf(r, "assessed value")).toBe(0);
    expect(r.exempt).toBe("County, Township, City, Village, School District, Parks");
  });
});

describe("statewide services", () => {
  it("Wisconsin: four value measures kept apart, all 0 as published", () => {
    const r = norm("wi-statewide.json");
    expect(r.values?.items.map((v) => v.label)).toEqual(["land (assessed)", "improvements (assessed)", "total assessed value", "estimated fair market value"]);
    expect(r.values?.items.every((v) => v.amount === 0)).toBe(true);
    expect(r.mailing).toBe("17 W MAIN ST STE 119, MADISON WI 53703");
  });

  it("North Carolina: the mailing parts joined in the published order (the fields are shifted in Wake)", () => {
    const r = norm("nc-statewide.json");
    expect(r.mailing).toBe("STATE PROPERTY OFFICE, 116 W JONES ST");
    expect(valueOf(r, "parcel value (assessed)")).toBe(108_129_848);
  });

  it("Montana: care-of, DBA and PLSS text as published", () => {
    const r = norm("mt-statewide.json");
    expect(r.owner).toMatchObject({ names: ["STATE OF MONTANA DEPT OF ADMIN ATTN GSD"] });
    expect(r.plssText).toBe("S32, T10 N, R03 W");
    expect(r.values?.year).toBe("tax year 2026");
  });

  it("Minnesota: a tax year of 0 is no year, deeded acres of 0 is no area, 0 values said to be for an exempt parcel", () => {
    const r = norm("mn-parcels.json");
    expect(r.values?.year).toBeUndefined();
    expect(r.values?.note).toBe("published for a tax-exempt parcel");
    expect(r.exempt).toBe("tax-exempt");
    expect(r.area).toEqual({ value: 1.25, unit: "acres", basis: "acres of the outline" });
    expect(r.situs).toBe("315 4th Street South, Minneapolis 55415");
    // The taxpayer is the owner here: only its address is added.
    expect(r.taxpayer).toEqual({ address: "300 S 6th Street Mc228, Minneapolis, MN 55487" });
    // No use class: MnGeo's useclass1 is the homestead classification in many counties, so it is neither asked for nor on an outline.
    expect(r.use).toBeUndefined();
    const mn = ADAPTER_BY_ID.get("mn-parcels")!;
    expect(mn.outFields).not.toContain("useclass1");
    expect(mn.useField).toBeUndefined();
  });

  it("Florida: just, assessed and taxable value apart; a sale year of 0 is no sale", () => {
    const r = norm("fl-dor.json");
    expect(valueOf(r, "just value")).toBe(130_393_937);
    expect(valueOf(r, "taxable value (school district)")).toBe(0);
    expect(r.lastSale).toBeUndefined();
    expect(r.plssText).toBe("section 36, township 01N, range 01W");
  });

  it("Massachusetts: fiscal year, lot units read from the source, a $0 transfer kept with its date", () => {
    const r = norm("ma-massgis.json");
    expect(r.values?.year).toBe("fiscal year 2023");
    expect(r.area).toEqual({ value: 5.73, unit: "acres", basis: "lot size (assessor)" });
    expect(r.lastSale).toEqual({ date: "1987-01-01", price: 0 });
  });

  it("Vermont: stacked records at one point each normalise", () => {
    const fx = load("vt-vcgi.json");
    expect(fx.rows.length).toBe(3);
    const r = norm("vt-vcgi.json");
    expect(r.propertyName).toBe("SUPREME COURT LIBRARY");
    expect(r.values?.year).toBe("grand list 2025");
    expect(norm("vt-vcgi.json", 1).situs).toBe("115 STATE ST, Montpelier");
  });

  it("Utah: the service is named from the county, no owner published", () => {
    expect(utahService({ geoid: "49035", name: "Salt Lake County", basename: "Salt Lake", state: "49" })).toBe("Parcels_SaltLake_LIR");
    expect(utahService({ geoid: "49003", name: "Box Elder County", basename: "Box Elder", state: "49" })).toBe("Parcels_BoxElder_LIR");
    const r = norm("ut-lir.json");
    expect(r.owner.status).toBe("not-published");
    expect(valueOf(r, "total market value")).toBe(126_083_800);
    expect(r.asOf).toBe("2026-03-26");
  });

  it("Ohio: a blank mailing field stays blank, the auditor's record is linked, the export date shown", () => {
    const r = norm("oh-statewide.json");
    expect(r.mailing).toBeUndefined();
    expect(r.asOf).toBe("2023-09-26");
    expect(r.link?.url).toBe("https://audr-apps.franklincountyohio.gov/redir/Link/Parcel/010-067008");
  });

  it("New Jersey: owner withheld under Daniel's Law, and no mailing field is even asked for", () => {
    const a = ADAPTER_BY_ID.get("nj-modiv")!;
    for (const f of ["OWNER_NAME", "ST_ADDRESS", "CITY_STATE", "ZIP_CODE", "ZIP5", "ZIP_PLUS4"]) expect(a.outFields).not.toContain(f);
    const r = norm("nj-modiv.json");
    expect(r.owner).toEqual({ status: "withheld", reason: NJ_WITHHELD });
    expect(r.mailing).toBeUndefined();
    expect(valueOf(r, "net taxable value")).toBe(210_565_500);
    expect(r.propertyName).toBe("STATE BLDGS.");
  });

  it("New York: land, total assessed and full market value with the roll year", () => {
    const r = norm("ny-its.json");
    expect(r.parcelId).toBe("76.7-1-1");
    expect(r.owner).toMatchObject({ names: ["State of New York"] });
    expect(valueOf(r, "full market value")).toBe(71_554_286);
    expect(r.values?.year).toBe("roll year 2025");
  });

  it("Connecticut: \"Current Owner\" towns are withheld with their mailing address (derived: the Capitol payload with the suppression tokens)", () => {
    const fx = load("ct-cama.json");
    expect(norm("ct-cama.json").owner).toMatchObject({ names: ["STATE OF CONN CAPITOL"] });
    const masked = { ...fx.rows[0].properties, Owner: "Current Owner", Co_Owner: "Current Co-Owner" };
    const r = ADAPTER_BY_ID.get("ct-cama")!.normalize(masked);
    expect(r.owner).toEqual({ status: "withheld", reason: MASK_REASON });
    expect(r.mailing).toBeUndefined();
    expect(valueOf(r, "total assessed value")).toBe(52_253_390);
    // Tolland publishes "SUPPRESSED OWNER" with the mailing address still filled in: withheld all the same.
    const tolland = ADAPTER_BY_ID.get("ct-cama")!.normalize({ ...fx.rows[0].properties, Owner: "SUPPRESSED OWNER", Co_Owner: " " });
    expect(tolland.owner).toEqual({ status: "withheld", reason: MASK_REASON });
    expect(tolland.mailing).toBeUndefined();
    expect(norm("ct-cama.json").mailing).toBeDefined();
    // "UNKNOWN OWNER" is not a name and not a withholding marker.
    expect(ADAPTER_BY_ID.get("ct-cama")!.normalize({ ...fx.rows[0].properties, Owner: "UNKNOWN OWNER", Co_Owner: " " }).owner.status).toBe("not-published");
  });

  it("Maryland: polygons with SDAT data, the owner on SDAT's page (linked), mailing as published", () => {
    const r = norm("md-sdat.json");
    expect(r.owner.status).toBe("not-published");
    expect(r.mailing).toBe("STATE HOUSE BLDG, STATE CIRCLE, ANNAPOLIS MD 21401");
    expect(valueOf(r, "new appraised full value")).toBe(27_275_600);
    expect(r.link?.url).toMatch(/^https:\/\/sdat\.dat\.maryland\.gov\/RealProperty\//);
  });
});

describe("adapterFor", () => {
  const c = (geoid: string, basename = "X"): CountyRef => ({ geoid, name: `${basename} County`, basename, state: geoid.slice(0, 2) });
  it("prefers a county's own service to its state's", () => {
    expect(adapterFor(c("48201"))?.id).toBe("tx-hcad");
    expect(adapterFor(c("48029"))?.id).toBe("tx-stratmap");
    expect(adapterFor(c("17031"))?.id).toBe("il-cook");
  });
  it("has nothing where nothing keyless is wired, rather than a guess", () => {
    expect(adapterFor(c("47037"))).toBeNull(); // Tennessee: the statewide service needs a token
    expect(adapterFor(c("17043"))).toBeNull(); // DuPage, IL: only Cook is wired in Illinois
    expect(adapterFor(null)).toBeNull();
  });
});
