// Superfund site boundaries and NPL status, on answers captured 2026-10-15:
// the NJ envelope (-74.6,40.4,-74.0,40.9; 54 boundaries) and its NPL list rows
// by EPA ID, the Sunnyvale box (-122.05,37.35,-121.95,37.45; 15 boundaries for
// 14 sites, one site drawn twice and two not on the list), and the boundary
// layer's own ?f=json (coded domains).
import { describe, expect, it } from "vitest";
import bndNj from "./fixtures/npl-bnd-nj.json";
import statusNj from "./fixtures/npl-status-nj.json";
import bndSv from "./fixtures/npl-bnd-sunnyvale.json";
import statusSv from "./fixtures/npl-status-sunnyvale.json";
import info from "./fixtures/npl-bnd-info.json";
import { codedDomains, type ArcgisLayerInfo } from "@/lib/server/arcgis";
import {
  anchor,
  buildNplBoundaries,
  buildNplStatus,
  cleanLabel,
  decode,
  epochDate,
  mdyDate,
  NPL_BOUNDARY_WHERE,
  NPL_IN_CHUNK,
  nplBoundaryParams,
  nplLookup,
  nplStatusParams,
  sitePage,
  type NplBoundaryExtra,
  type NplDomains,
} from "./npl";
import { matchScore } from "@/lib/search/allowlist";

type Rows = Parameters<typeof buildNplBoundaries>[0];
const d = codedDomains(info as unknown as ArcgisLayerInfo);
const domains: NplDomains = { status: d.get("NPL_STATUS_CODE")!, federal: d.get("FEDERAL_FACILITY_DETER_CODE")! };

describe("the boundary request", () => {
  it("asks for named fields only: no contact, address, free text or area field, never *", () => {
    const p = nplBoundaryParams([-74.6, 40.4, -74, 40.9]);
    const fields = p.outFields.split(",");
    expect(fields).not.toContain("*");
    for (const bad of ["SITE_CONTACT_NAME", "SITE_CONTACT_EMAIL", "PRIMARY_TELEPHONE_NUM", "STREET_ADDR_TXT", "ADDR_COMMENT", "ZIP_CODE", "GIS_AREA", "GIS_AREA_UNITS", "SITE_FEATURE_NAME", "SITE_FEATURE_DESCRIPTION"]) {
      expect(fields, bad).not.toContain(bad);
    }
    expect(p.where).toBe(NPL_BOUNDARY_WHERE);
    expect(p.where).toContain("LIKE 'Superfund%'");
    expect(p.maxAllowableOffset).toBe("0.0005");
    expect(p.geometryPrecision).toBe("5");
  });

  it("chunks the status IN list and keeps anything that is not an EPA ID out of the where clause", () => {
    // Real EPA IDs from both captures, plus two strings that are not EPA IDs.
    const real = [...new Set([...bndNj.features, ...bndSv.features].map((f) => f.properties.EPA_ID as string))];
    expect(real.length).toBe(68);
    const params = nplStatusParams([...real, "x' OR '1'='1", ""]);
    expect(params.length).toBe(Math.ceil(68 / NPL_IN_CHUNK));
    const all = params.flatMap((p) => p.where.match(/'([A-Z0-9]+)'/g) ?? []);
    expect(all.length).toBe(68);
    for (const p of params) {
      expect(p.where).not.toContain("OR");
      expect(p.returnGeometry).toBe("false");
      expect(p.outFields.split(",")).not.toContain("City");
    }
  });
});

describe("labels, dates and links", () => {
  it("trims and collapses EPA's domain labels, and keeps a null status null", () => {
    expect(domains.status.get("F")).toBe("Currently on the Final NPL   ");
    expect(decode(domains.status, "F")).toBe("Currently on the Final NPL");
    expect(decode(domains.federal, "N")).toBe("Not a Federal Facility");
    expect(decode(domains.status, null)).toBeNull();
    expect(cleanLabel("  a   b ")).toBe("a b");
  });

  it("reads MM/DD/YYYY and epoch dates, and gives null for blank or impossible ones", () => {
    expect(mdyDate("09/08/1983")).toBe("1983-09-08");
    expect(mdyDate("02/30/2020")).toBeNull();
    expect(mdyDate("2020-01-01")).toBeNull();
    expect(mdyDate("")).toBeNull();
    expect(mdyDate(null)).toBeNull();
    expect(epochDate(1709164800000)).toBe("2024-02-29");
    expect(epochDate(null)).toBeNull();
    expect(epochDate("")).toBeNull();
  });

  it("keeps an anchor's text and only an https epa.gov href; no HTML passes through", () => {
    const asbestos = statusNj.features.find((f) => f.properties.Site_EPA_ID === "NJD980654149")!.properties;
    expect(anchor(asbestos.Final_FR_Notice, "final")).toEqual({ kind: "final", text: "09/08/1983 (PDF)", url: "https://semspub.epa.gov/src/document/11/189620" });
    // The deletion notice is on govinfo.gov: its text stays, its link does not.
    expect(anchor(asbestos.Deletion_FR_Notice, "deletion")).toEqual({ kind: "deletion", text: "07/12/2010 (PDF)", url: null });
    expect(anchor("No", "partial")).toEqual({ kind: "partial", text: "No", url: null });
    expect(anchor(null, "x")).toBeNull();
  });

  it("links the site page over https, from the info URL or the alias", () => {
    expect(sitePage("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0200766", null)).toBe("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0200766");
    expect(sitePage(null, "www.epa.gov/superfund/diamond-alkali")).toBe("https://www.epa.gov/superfund/diamond-alkali");
    expect(sitePage(null, "https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0900265")).toBe("https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=0900265");
    expect(sitePage(null, null)).toBeNull();
  });
});

describe("the NPL list", () => {
  it("reads status, score, dates, partial deletion and notices per EPA ID", () => {
    const s = buildNplStatus(statusNj.features);
    expect(s.size).toBe(54);
    const rockaway = s.get("NJD980654115")!;
    expect(rockaway).toMatchObject({ status: "NPL Site", score: 42.34, proposed: "1982-12-30", listed: "1983-09-08", constructionComplete: "2015-04-13", deleted: null, partialDeletion: false });
    expect(rockaway.notices.map((n) => n.kind)).toEqual(["proposed rule (Federal Register)", "final rule (Federal Register)", "site progress profile (EPA)"]);
    const asbestos = s.get("NJD980654149")!;
    expect(asbestos).toMatchObject({ status: "Deleted NPL Site", deleted: "2010-07-12", noticeOfIntentToDelete: "2010-05-11", partialDeletion: true });
  });
});

describe("boundaries", () => {
  it("draws every NJ boundary with its decoded status and its list row", () => {
    const f = buildNplBoundaries(bndNj.features as unknown as Rows, domains, nplLookup(buildNplStatus(statusNj.features)));
    expect(f).toHaveLength(54);
    const rock = f.find((x) => (x.properties.extra as NplBoundaryExtra).programId === "NJD980654115")!;
    expect(rock.properties.name).toBe("Superfund NJD980654115");
    expect(rock.properties.details).toMatchObject({
      "site (as EPA publishes it)": "ROCKAWAY BOROUGH WELL FIELD",
      "NPL status (boundary layer)": "Currently on the Final NPL",
      "federal facility": "Not a Federal Facility",
      "NPL list": "NPL Site",
      "HRS score": 42.34,
      "listed on the NPL": "1983-09-08",
      "last changed (EPA)": "2024-02-29",
      "mapped features for this site here": 1,
    });
    // Found in search by EPA ID, never by the site's name.
    expect(matchScore(rock.properties, "njd980654115")).toBeGreaterThan(0);
    expect(matchScore(rock.properties, "rockaway borough")).toBe(0);
    expect(JSON.stringify(f)).not.toMatch(/<a |target=/);
  });

  it("does not merge a site's features, says how many there are, and keeps a null status and a site not on the list apart", () => {
    const f = buildNplBoundaries(bndSv.features as unknown as Rows, domains, nplLookup(buildNplStatus(statusSv.features)));
    expect(f).toHaveLength(15);
    const triple = f.filter((x) => (x.properties.extra as NplBoundaryExtra).programId === "CAN000900265");
    expect(triple).toHaveLength(2);
    for (const t of triple) {
      const x = t.properties.extra as NplBoundaryExtra;
      expect(x.siteFeatures).toBe(2);
      expect(x.nplCode).toBeNull();
      expect(x.npl).toBeNull();
      expect(t.properties.details?.["NPL status (boundary layer)"]).toBe("status not given");
      expect(t.properties.details?.["NPL list"]).toBe("not on EPA's NPL status list");
      expect(String(t.properties.details?.["mapped features for this site here"])).toMatch(/^2 /);
    }
    // One of the two is "Not a Federal Facility", the other gives none: "not given", never "no".
    expect(triple.map((t) => t.properties.details?.["federal facility"]).sort()).toEqual(["Not a Federal Facility", "not given"]);
  });

  it("says unknown, never 'not on the list', when the list did not answer", () => {
    const f = buildNplBoundaries(bndSv.features as unknown as Rows, domains, nplLookup(new Map(), "all"));
    for (const x of f) {
      expect((x.properties.extra as NplBoundaryExtra).npl).toBeUndefined();
      expect(x.properties.details?.["NPL list"]).toMatch(/^unknown/);
    }
  });

  it("shows a code as published when the domains did not load", () => {
    const f = buildNplBoundaries(bndNj.features as unknown as Rows, null, nplLookup(new Map(), "all"));
    expect(new Set(f.map((x) => x.properties.details?.["NPL status (boundary layer)"]))).toEqual(new Set(["F", "D"]));
  });
});
