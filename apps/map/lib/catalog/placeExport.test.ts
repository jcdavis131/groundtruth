import { describe, expect, it } from "vitest";
import counties from "@/lib/places/data/counties.json";
import { COLLECTIONS } from "./collections";
import { PLACE_EXPORTS, PLACE_EXPORT_FORM, placeExport } from "./placeExport";

interface StaticExport {
  meta: {
    collection: string;
    form: string;
    years: null;
    features: string[];
    zero_vs_missing: string;
    counts: Record<string, unknown>;
    source: { pages: { sha256: string }[]; fetchedAt: string };
  };
  places: string[];
  value: (number | null)[][];
  nullPlaces: Record<string, string>;
  nullCells?: Record<string, Record<string, string>>;
}

const ALL = new Set(counties.rows.map((c) => c.geoid));
const data = (id: string) => placeExport(id)!.data as StaticExport;

/** Every key anywhere in a JSON value. */
function keys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keys(x, out);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keys(x, out);
    }
  return out;
}

describe("place exports", () => {
  it("are exactly the cards that list catalog?op=place-export", () => {
    const listed = COLLECTIONS.filter((c) => c.ops.includes("catalog?op=place-export")).map((c) => c.id).sort();
    expect(listed).toEqual([...PLACE_EXPORTS].sort());
  });

  for (const id of PLACE_EXPORTS.filter((x) => PLACE_EXPORT_FORM[x] === "static")) {
    it(`${id}: static shape, provenance, and every county either valued, null with a reason, or (complete census) 0`, () => {
      const d = data(id);
      expect(d.meta.collection).toBe(id);
      expect(d.meta.form).toBe("static");
      expect(d.meta.years).toBeNull();
      expect(d.meta.source.pages.length).toBeGreaterThan(0);
      for (const p of d.meta.source.pages) expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isNaN(Date.parse(d.meta.source.fetchedAt))).toBe(false);
      expect(d.value).toHaveLength(d.places.length);
      for (const v of d.value) expect(v).toHaveLength(d.meta.features.length);
      for (const g of [...d.places, ...Object.keys(d.nullPlaces)]) expect(ALL.has(g), g).toBe(true);
      for (const g of d.places) expect(d.nullPlaces[g], g).toBeUndefined();
      for (const r of Object.values(d.nullPlaces)) expect(r).toMatch(/^(join|source):[a-z_]+$/);
      // A null cell has a reason, and a reason has a null cell.
      d.places.forEach((g, i) =>
        d.meta.features.forEach((f, j) => {
          const reason = d.nullCells?.[g]?.[f];
          if (d.value[i][j] == null) expect(reason, `${g} ${f}`).toBeTruthy();
          else {
            expect(reason, `${g} ${f}`).toBeUndefined();
            expect(Number.isInteger(d.value[i][j]) && d.value[i][j]! >= 0).toBe(true);
          }
        }),
      );
      if (d.meta.zero_vs_missing === "as-published") expect(d.places.length + Object.keys(d.nullPlaces).length).toBe(ALL.size);
    });
  }

  it("UST: Connecticut's planning regions and Chugach/Copper River have no row; Virginia's cities do; no population", () => {
    for (const id of ["ust-releases-county", "ust-facilities-county"]) {
      const d = data(id);
      expect(d.meta.zero_vs_missing).toBe("as-published");
      for (const g of ["09110", "09190", "02063", "02066"]) expect(d.nullPlaces[g]).toBe("join:no_source_row");
      expect(Object.keys(d.nullPlaces)).toHaveLength(11);
      for (const g of ["51720", "51800", "51510", "24510", "29510"]) expect(d.places).toContain(g);
      expect(d.meta.counts.nameAndPointDisagree).toBe(0);
      expect(keys(d).has("POPULATION")).toBe(false);
      expect(d.meta.counts.rowsRead).toBe(d.meta.counts.serviceCount);
    }
    // Kentucky publishes no open-release count: null, not 0.
    const r = data("ust-releases-county");
    const i = r.places.indexOf("21111");
    expect(r.value[i][r.meta.features.indexOf("ust_open_release_count")]).toBeNull();
    expect(r.nullCells!["21111"].ust_open_release_count).toBe("source:null_in_county_layer");
    // The layer never publishes a 0 for the status counts, so the nulls are explained, not filled.
    const rm = r.meta as unknown as { nullCellNote: string; nullPattern: { publishedZerosByFeature: Record<string, number>; openPlusNfaAboveRelease: number; releaseZeroWithNullStatus: string[] } };
    expect(rm.nullPattern.publishedZerosByFeature).toMatchObject({ ust_open_release_count: 0, ust_nfa_release_count: 0 });
    expect(rm.nullPattern.openPlusNfaAboveRelease).toBe(0);
    expect(rm.nullPattern.releaseZeroWithNullStatus).toContain("15005");
    expect(rm.nullCellNote).toMatch(/most likely means 0/);
    // Facility tank nulls are not only Puerto Rico's: California and two Georgia counties too.
    const f = data("ust-facilities-county");
    const byState = (f.meta.counts as unknown as { nullCellsByState: Record<string, Record<string, number>> }).nullCellsByState;
    expect(Object.keys(byState.ust_closed_tanks).sort()).toEqual(["CA", "GA", "PR"]);
    for (const g of ["06037", "13123", "13125"]) expect(f.nullCells![g].ust_closed_tanks).toBe("source:null_in_county_layer");
  });

  it("every export's served meta.form is PLACE_EXPORT_FORM's", () => {
    for (const id of PLACE_EXPORTS) expect((placeExport(id)!.data as { meta: { form?: string } }).meta.form, id).toBe(PLACE_EXPORT_FORM[id]);
  });

  it("FUDS: property numbers only, no coordinates, owners or names; counts re-derive from the ids", () => {
    const d = data("fuds-properties") as StaticExport & { propertyIds: Record<string, string[]>; meta: { unlocated: Record<string, string[]>; counts: { strictRule: { observedShare: number } } } };
    expect(d.meta.zero_vs_missing).toBe("complete-census");
    const k = keys(d);
    for (const bad of ["lat", "lon", "LATITUDE", "LONGITUDE", "x", "y", "geometry", "CURRENTOWNER", "FEATURENAME", "FEATUREDESCRIPTION", "DODFORMERLYUSEDDEFENSESITENAME", "CLOSESTCITY"]) expect(k.has(bad), bad).toBe(false);
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/CURRENTOWNER|FEATURENAME|PROPERTY \(/);
    const id = /^[A-Z]\d{2}[A-Z]{2}\d{4}$/;
    d.places.forEach((g, i) => {
      const ids = d.propertyIds[g];
      for (const x of ids) expect(x).toMatch(id);
      const [all, withProjects, open] = d.value[i] as number[];
      expect(all).toBe(ids.length);
      expect(withProjects).toBeLessThanOrEqual(all);
      expect(open).toBeLessThanOrEqual(withProjects);
    });
    for (const ids of Object.values(d.meta.unlocated)) for (const x of ids) expect(x).toMatch(id);
    for (const g of ["09110", "09190"]) expect(d.nullPlaces[g]).toBe("join:unplaced_property_in_state");
    expect(d.meta.counts.strictRule.observedShare).toBeLessThan(1);
    // placed counts properties put in a county later nulled; counted is what propertyIds holds.
    const c = d.meta.counts as unknown as { placed: number; counted: number; placedThenNulled: number };
    expect(c.counted).toBe(Object.values(d.propertyIds).reduce((a, v) => a + v.length, 0));
    expect(c.placed - c.counted).toBe(c.placedThenNulled);
    // A county-or-city name is placed by its point: B07MO0988 "ST LOUIS" is in St. Louis city.
    expect(d.propertyIds["29510"]).toContain("B07MO0988");
    expect((d.meta as unknown as { zeroRuleStatus: string }).zeroRuleStatus).toMatch(/^approved/);
  });
});

describe("place exports: a county count names the rows it was computed from", () => {
  /** A path the way a ProvenanceInput names it, "data.siteIds", read from the served reply's data. */
  const at = (data: unknown, p: string): unknown => p.split(".").slice(1).reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], data);

  for (const id of PLACE_EXPORTS) {
    it(`${id}: the estimate carries one input for the publisher's layer and one for the TIGERweb county rows, each dated`, () => {
      const x = placeExport(id)!;
      const meta = (x.data as { meta: { source: { layer: string; fetchedAt: string; serviceDataLastEdit?: string }; counties: { pulled: string } } }).meta;
      const est = x.provenance.filter((p) => p.kind === "estimate");
      expect(est).toHaveLength(1);
      const inputs = est[0].inputs ?? [];
      expect(inputs.map((i) => i.sourceId)).toEqual([est[0].source.id, "census-tigerweb"]);
      expect(inputs[0].upstreamRecordUrl).toBe(meta.source.layer);
      expect(inputs[0].retrievedAt).toBe(meta.source.fetchedAt);
      expect(inputs[0].releasedAt).toBe(meta.source.serviceDataLastEdit);
      expect(inputs[1].upstreamRecordUrl).toMatch(/^https:\/\/tigerweb\.geo\.census\.gov\/arcgis\/rest\/services\//);
      expect(inputs[1].retrievedAt).toBe(meta.counties.pulled);
      for (const i of inputs) expect(Number.isNaN(Date.parse(i.retrievedAt)), `${id} ${i.sourceId} retrievedAt`).toBe(false);
    });

    it(`${id}: the reply lists the input rows at the path each input names, for every county it counts`, () => {
      const x = placeExport(id)!;
      const inputs = x.provenance.find((p) => p.kind === "estimate")?.inputs ?? [];
      const places = (x.data as { places: string[] }).places;
      const rows = at(x.data, inputs[0].rowIdsAt ?? "") as Record<string, unknown> | undefined;
      expect(rows, `${id} ${inputs[0].rowIdsAt}`).toBeTruthy();
      for (const g of places) expect(rows![g], `${id} ${g}`).toBeDefined();
      expect(at(x.data, inputs[1].rowIdsAt ?? "")).toEqual(places);
    });
  }

  it("the TIGERweb county table is relayed as-is: published, and it names no inputs", () => {
    for (const id of PLACE_EXPORTS) {
      const tiger = placeExport(id)!.provenance.filter((p) => p.source.id === "census-tigerweb");
      expect(tiger, id).toHaveLength(1);
      expect(tiger[0].kind).toBe("published");
      expect(tiger[0].inputs).toBeUndefined();
    }
  });
});
