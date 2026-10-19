// B0 (2026-10-18): a record's text starts with its card's short title and agency, then its public
// name where the card allows one, then its place, then the card's other fields. These tests hold the
// order, keep the head honest to the catalogue, and keep the privacy rule: a name enters only through
// PUBLIC_NAME_RULE, never on a card whose sensitivity line keeps it out. Every row below is a real
// captured fixture row.

import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "./collections";
import { SOURCES } from "@/lib/provenance/sources";
import { EMBED_TEXT, PLACE_FIELD_RANK, PUBLIC_NAME_RULE, RECORD_HEAD, RECORD_VECTOR_CARDS, fieldLabel, type CollectionId } from "./embedFields";
import { receivedRecordText, recordText } from "./recordText";
import { recordFixtures } from "@/lib/embed/__fixtures__/records";
import { buildLihtc } from "@/lib/civic/taxcredit";
import lihtcAustin from "@/lib/civic/fixtures/hud-lihtc-austin.json";
import wrcBoulder from "@/lib/hazards/fixtures/wrc-place-boulder-box.json";
import { buildWrcPlaces } from "@/lib/hazards/wrc";
import nrhpPoints from "@/lib/land/fixtures/nrhp-points-dc.json";
import { PADUS_NAMED_OWNERS, buildHistoric } from "@/lib/land/features";
import { readFileSync } from "node:fs";
import path from "node:path";

const card = (id: string) => COLLECTIONS.find((c) => c.id === id)!;
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
type FC = { features: Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }> };

describe("record head (B0)", () => {
  it("gives every record-vector card a head, and no other card", () => {
    expect(new Set(Object.keys(RECORD_HEAD))).toEqual(RECORD_VECTOR_CARDS);
  });

  it("says only what the catalogue says: every head word is in the card's title or what-text, or its source's name or publisher", () => {
    for (const [id, h] of Object.entries(RECORD_HEAD)) {
      const c = card(id);
      const said = new Set(words([c.title, c.what, ...c.sources.map((s) => `${SOURCES[s].name} ${SOURCES[s].publisher}`)].join(" ")));
      for (const w of words(`${h.collection} ${h.agency}`)) expect(said.has(w), `${id}: "${w}"`).toBe(true);
    }
  });

  it("orders head, public name, place (city, county, state), then the card's other fields", () => {
    for (const { card: id, features } of recordFixtures()) {
      const h = RECORD_HEAD[id];
      const places = new Set(EMBED_TEXT[id].filter((f) => f in PLACE_FIELD_RANK));
      for (const f of features) {
        const t = receivedRecordText(f.properties);
        if (!t) continue;
        const parts = t.split("; ");
        expect(parts.slice(0, 2), id).toEqual([`collection: ${h.collection}`, `agency: ${h.agency}`]);
        const rest = parts.slice(2).filter((p) => !p.startsWith("name: "));
        if (parts[2]?.startsWith("name: ")) expect(parts.indexOf(parts[2])).toBe(2);
        const isPlace = rest.map((p) => [...places].some((pf) => p.startsWith(`${fieldLabel(id, pf)}: `)));
        // all place segments come before every other segment
        const lastPlace = isPlace.lastIndexOf(true);
        const firstOther = isPlace.indexOf(false);
        if (lastPlace >= 0 && firstOther >= 0) expect(lastPlace < firstOther, `${id}: ${t}`).toBe(true);
      }
    }
  });
});


describe("public names in record text (B0 privacy rule)", () => {
  it("allows a name only on cards whose sensitivity line says it is embedded, never on one that keeps it out", () => {
    for (const id of Object.keys(PUBLIC_NAME_RULE)) {
      expect(RECORD_VECTOR_CARDS.has(id), id).toBe(true);
      expect(card(id).sensitivity, id).toMatch(/embedded[^.]*\(B0, 2026-10-18\)/);
    }
    // Cards whose name can be a person's or a business's, or whose exclusions keep the name out.
    for (const id of ["nrhp-listed", "emef-sems", "emef-tri", "emef-rcra", "emef-acres", "npl-boundaries", "fuds-properties", "fuds-mrs", "wrc-communities", "hud-lihtc"]) {
      expect(id in PUBLIC_NAME_RULE, id).toBe(false);
      const c = card(id);
      expect(`${c.sensitivity} ${c.excluded.map((x) => `${x.what} ${x.why}`).join(" ")}`, id).toMatch(/never (searched or )?embedded|not embedded|names are never embedded|on the label only|neither the name[^.]*is embedded/i);
    }
  });

  it("names PAD-US units only on federal or state land, never an easement, in the real records corpus", () => {
    expect([...PADUS_NAMED_OWNERS].sort()).toEqual(["FED", "STAT"]);
    const corpus: Array<{ card: string; embedText: string; n: number }> = JSON.parse(readFileSync(path.join(process.cwd(), "lib/embed/__eval__/records-corpus.json"), "utf8"));
    const padus = corpus.filter((r) => r.card === "padus-units");
    const named = padus.filter((r) => r.embedText.includes("; name: "));
    expect(named.length).toBeGreaterThan(0);
    for (const r of named) {
      expect(r.embedText, r.embedText).toMatch(/; owner type: (Federal|State);/);
      expect(r.embedText).not.toMatch(/protected area category: Easement/);
    }
    // Local, district, joint, NGO, designation and private units carry no name.
    for (const r of padus.filter((x) => !/; owner type: (Federal|State);/.test(x.embedText))) expect(r.embedText).not.toContain("; name: ");
    // Every named dam has a published, non-private owner type in its builder (checked on the fixture above); no dam text names a private dam.
    for (const r of corpus.filter((x) => x.card === "nid-dams")) expect(r.embedText).not.toMatch(/Blue Wing|Riley Lake/i);
  });

  it("refuses a public name on any card outside PUBLIC_NAME_RULE", () => {
    expect(() => recordText("nrhp-listed", { ResType: "building" }, "a name")).toThrow(/no public name/);
    expect(() => recordText("npl-boundaries", { COUNTY: "MORRIS" }, "a name")).toThrow(/no public name/);
  });

  it("never embeds a LIHTC project's name or address (a sensitive card): the builder attaches no text, and recordText refuses the name", () => {
    const rows = (lihtcAustin as unknown as FC).features;
    const real = rows.find((r) => r.properties.PROJECT === "PATHWAYS AT MANCHACA VILLAGE")!.properties;
    expect(real).toBeDefined();
    expect(() => recordText("hud-lihtc", real, String(real.PROJECT))).toThrow(/no public name/);
    expect(recordText("hud-lihtc", real)).toBeNull();
    const { features } = buildLihtc(rows as never);
    expect(features.length).toBeGreaterThan(0);
    for (const f of features) expect(receivedRecordText(f.properties), f.properties.id).toBeNull();
  });

  it("never embeds a person-like field: PAD-US owner, local owner and easement holder, NRHP RESNAME, Superfund SITE_NAME", () => {
    // PAD-US: the test's private easement row ("Smith Family Farm") carries no name; owner fields are not embedded even when present.
    const padus = recordFixtures().find((r) => r.card === "padus-units")!.features[0];
    const pt = receivedRecordText(padus.properties) ?? "";
    expect(pt).not.toMatch(/smith/i);
    expect(pt).not.toMatch(/; name: /);
    // NRHP: real DC rows; RESNAME never appears.
    const nrhpRows = (nrhpPoints as unknown as FC).features;
    const built = buildHistoric(nrhpRows as never, "point");
    let n = 0;
    for (const f of built) {
      const row = nrhpRows.find((r) => f.properties.id === `nrhp:pt:${r.properties.OBJECTID}`);
      const res = row ? String(row.properties.RESNAME ?? "") : "";
      const t = receivedRecordText(f.properties) ?? "";
      if (res.length > 4) {
        n++;
        expect(t, res).not.toContain(res);
      }
      expect(t).not.toMatch(/; name: /);
    }
    expect(n).toBeGreaterThan(10);
    // Superfund boundaries: city is embedded (a place), SITE_NAME never.
    const npl = recordFixtures().find((r) => r.card === "npl-boundaries")!.features;
    for (const f of npl) {
      const t = receivedRecordText(f.properties) ?? "";
      const site = String(f.properties.details?.["site (as EPA publishes it)"] ?? "");
      if (site.length > 4) expect(t, site).not.toContain(site);
      expect(t).not.toMatch(/; name: /);
    }
    expect(npl.some((f) => /; city: /.test(receivedRecordText(f.properties) ?? ""))).toBe(true);
    // WRC: the Census place name is excluded on its card, so it never rides in as a name.
    const wrc = buildWrcPlaces((wrcBoulder as unknown as { features: never[] }).features, 0, "national");
    for (const f of wrc) expect(receivedRecordText(f.properties) ?? "", f.properties.name).not.toContain(f.properties.name);
  });
});
