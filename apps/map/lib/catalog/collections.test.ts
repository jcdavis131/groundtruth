// The catalogue's own rules: ids, references into SOURCES, LAYER_IDS and
// public/openapi.json, the deny list that keeps person-name and contact fields
// out of search and embedding, and that every curated layer has a card.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLLECTIONS, DENY_FIELD, catalogued, collection, collectionsForLayer, parseOpRef, SHELVES } from "./collections";
import { SOURCES } from "@/lib/provenance/sources";
import { LAYER_IDS } from "@/lib/layers/types";

const spec = JSON.parse(readFileSync(path.resolve(__dirname, "../../public/openapi.json"), "utf8")) as {
  paths: Record<string, { get: { parameters?: Array<{ name?: string; schema?: { enum?: string[] } }> } }>;
};
const opsOf = (route: string) => spec.paths[route]?.get.parameters?.find((p) => p.name === "op")?.schema?.enum ?? [];
const iso = /^\d{4}-\d{2}-\d{2}$/;

describe("the catalogue", () => {
  it("holds exactly these collections, ids unique and kebab-case", () => {
    expect(COLLECTIONS.map((c) => c.id)).toEqual([
      "nwi-wetlands",
      "nwi-wetlands-raster",
      "nrhp-listed",
      "fws-crithab",
      "nmfs-crithab",
      "opp-ranges",
      "attains-impaired",
      "ucmr5-pfas",
      "cws-service-areas",
      "emef-sems",
      "emef-tri",
      "emef-rcra",
      "emef-acres",
      "tri-releases",
      "npl-boundaries",
      "npl-status",
      "fuds-properties",
      "fuds-projects",
      "fuds-mrs",
      "ust-releases-county",
      "ust-facilities-county",
      "fema-nfhl-zones",
      "padus-units",
      "nid-dams",
      "esri-wayback",
      "wayback-capture",
      "usgs-htmc",
      "nhd-hydro-picture",
      "nldi-trace",
      "nhdplus-v21-reach",
      "nri-counties",
      "nri-tracts",
      "nhl-listed",
      "naip-years",
      "nps-units",
      "nps-nha",
      "abpp-battlefields",
      "nps-whs",
      "places-county",
      "places-tract",
      "svi-counties",
      "svi-tracts",
      "hifld-hospitals",
      "nces-public-schools",
      "fcc-bdc-counties",
      "fcc-bdc-hex",
      "wrc-counties",
      "wrc-communities",
      "bia-lar",
      "fema-declarations",
      "usdm-county-dsci",
      "noaa-cag-county",
      "spc-tornado-county",
      "hud-hcv-tracts",
      "hud-qct",
      "usgs-landslide-susc",
      "ncei-storm-events-county",
      "hud-dda",
      "hud-lihtc",
      "cms-hospital-ratings",
    ]);
    const ids = COLLECTIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("refers to sources, layers and ops that exist", () => {
    for (const c of COLLECTIONS) {
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      for (const s of c.sources) expect(SOURCES[s], `${c.id} source ${s}`).toBeDefined();
      expect(LAYER_IDS, c.id).toContain(c.layer);
      expect(c.ops.length, c.id).toBeGreaterThan(0);
      for (const ref of c.ops) {
        const r = parseOpRef(ref);
        expect(r, `${c.id} op ${ref}`).not.toBeNull();
        expect(opsOf(r!.route), `${c.id} op ${ref}`).toContain(r!.op);
      }
    }
  });

  it("gives every curated layer at least one card, and shelves every catalogued layer once", () => {
    for (const l of ["wetlands", "historic", "crithab", "contaminants", "wayback", "topo", "impaired", "pfas", "flood", "publiclands", "dams", "ust", "hydro", "riskindex", "naip", "heritage", "health", "vulnerability", "hospitals", "schools", "broadband", "wildfirerisk", "tribal", "housing", "landslidesusc"] as const) expect(collectionsForLayer(l).length, l).toBeGreaterThan(0);
    const shelved = SHELVES.flatMap((s) => s.layers);
    expect(new Set(shelved).size).toBe(shelved.length);
    for (const l of catalogued()) expect(shelved, l).toContain(l);
  });

  it("never lets an address, contact or person-name field be searched or embedded", () => {
    for (const c of COLLECTIONS) {
      for (const f of [...c.searchable, ...c.embedText]) expect(DENY_FIELD.test(f), `${c.id}: ${f}`).toBe(false);
    }
    for (const bad of [
      "location_address",
      "STREET_ADDR_TXT",
      "ZIP_CODE",
      "public_contact_person",
      "technical_contact_phone",
      "certif_name",
      "SITE_CONTACT_EMAIL",
      "SITE_CONTACT_NAME",
      "PRIMARY_TELEPHONE_NUM",
      "primary_name",
      "RESNAME",
      "Name",
      "Address",
      "CURRENTOWNER",
      "SITE_NAME",
      "Site_Name",
      "PWS_Name",
      "FEATURENAME",
      "DODFORMERLYUSEDDEFENSESITENAME",
      "ENVRESTORATIONPROJECTNAME",
      "OFFICIALSITENAME",
      "FEATUREDESCRIPTION",
      "SITE_FEATURE_DESCRIPTION",
      "Loc_Own",
    ]) {
      expect(DENY_FIELD.test(bad), bad).toBe(true);
    }
  });

  it("dates every count and freshness reading, and says what each exclusion is and why", () => {
    for (const c of COLLECTIONS) {
      expect(c.freshness.recordedOn, c.id).toMatch(iso);
      expect(c.freshness.readFrom.length, c.id).toBeGreaterThan(5);
      if (c.coverage.count) {
        expect(c.coverage.count.countedOn, c.id).toMatch(iso);
        expect(Number.isInteger(c.coverage.count.value) && c.coverage.count.value > 0, c.id).toBe(true);
      }
      for (const x of c.excluded) {
        expect(x.what.length, c.id).toBeGreaterThan(3);
        expect(x.why.length, c.id).toBeGreaterThan(3);
      }
      expect(c.caveats.length + c.excluded.length, c.id).toBeGreaterThan(0);
    }
  });

  it("finds a card by id and parses op references", () => {
    expect(collection("nrhp-listed")?.layer).toBe("historic");
    expect(collection("nope")).toBeUndefined();
    expect(parseOpRef("land?op=historic")).toEqual({ route: "/api/land", op: "historic" });
    expect(parseOpRef("https://x/land?op=historic")).toBeNull();
  });
});
