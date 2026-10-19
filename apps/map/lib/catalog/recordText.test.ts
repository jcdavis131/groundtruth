// Record text, the one door to the embedder. The leak test writes a marker
// into every name, owner, address, contact, free-text and id field of real
// captured rows (it mutates real fixtures; it does not invent records) and
// checks the marker never reaches a feature's record text. The private-holding
// rows ("Blue Wing Lake Dam", "Smith Family Farm") are the existing
// label-by-id fixtures.

import { describe, expect, it } from "vitest";
import { buildDams } from "@/lib/infra/features";
import dams from "@/lib/infra/fixtures/dams-sanantonio.json";
import { recordFixtures } from "@/lib/embed/__fixtures__/records";
import { COLLECTIONS } from "./collections";
import { allCardTexts, cardText } from "./cardText";
import { CARD_FIELD_LABEL, DENY_FIELD, EMBED_TEXT, FIELD_LABEL, NAME_FIELDS_ALLOWED, NO_RECORD_VECTORS, PUBLIC_NAME_RULE, RECORD_VECTOR_CARDS, embeddableField, fieldLabel, type CollectionId } from "./embedFields";
import { buildWrcPlaces } from "@/lib/hazards/wrc";
import wrcBoulder from "@/lib/hazards/fixtures/wrc-place-boulder-box.json";
import { queryText, receivedRecordText, recordText, withEmbedText } from "./recordText";

const MARK = "ZZLEAK";
/** Upstream fields the leak test marks besides DENY_FIELD: names, free text and ids that must stay out of the vectors. */
const MARKED = /name|_nm$|desc|citation|owner|holder|^esmthldr$|address|contact|phone|email|^nidid$|^nris_refnum$|^epa_id$|^site_epa_id$|^fudsuniquepropertynumber$|^fudspropertyid$|^projectnumber$|^fudssiteid$|^assessmentunitidentifier$|^registry_id$|^pgm_sys_id$|^dfirm_id$|^fld_ar_id$|^objectid$|url|link/i;

const markRow = <R extends { properties: Record<string, unknown> }>(r: R): R => {
  const p = { ...r.properties };
  for (const k of Object.keys(p)) {
    if (NAME_FIELDS_ALLOWED.has(k)) continue;
    if (DENY_FIELD.test(k) || MARKED.test(k)) p[k] = `${MARK} ${String(p[k] ?? "")}`;
  }
  return { ...r, properties: p };
};

/**
 * Cards whose feature is named by a field that is embedded, and the field. Names are never embedded
 * (recordText.ts) with one reviewed exception: BIA land area names (LARNAME), all 335 read and none a
 * person's, embedded on Cam's call (2026-10-17). The field must be on NAME_FIELDS_ALLOWED.
 */
const NAMED_BY_EMBEDDED_PLACE_FIELD: Record<string, string> = { "bia-lar": "LARNAME" };

/** A record text without its "name: " segment (B0's public-name door, checked on its own below). */
const withoutPublicName = (t: string) => t.split("; ").filter((s) => !s.startsWith("name: ")).join("; ");

describe("record text", () => {
  it("never carries a marked name, owner, address, contact, free-text or id field into a record vector", () => {
    let checked = 0;
    for (const { card, features } of recordFixtures(markRow)) {
      expect(features.length, card).toBeGreaterThan(0);
      for (const f of features) {
        const t = receivedRecordText(f.properties);
        if (t == null) continue;
        checked++;
        // Only a PUBLIC_NAME_RULE card may carry a marked name, and only in its "name: " segment.
        const rest = card in PUBLIC_NAME_RULE ? withoutPublicName(t) : t;
        expect(rest.toUpperCase(), `${card} ${f.properties.id}`).not.toContain(MARK);
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("embeds a public name only as the feature's own label, once, and only on a PUBLIC_NAME_RULE card (B0)", () => {
    let named = 0;
    for (const { card, features } of recordFixtures()) {
      for (const f of features) {
        const t = receivedRecordText(f.properties);
        if (!t) continue;
        const names = t.split("; ").filter((s) => s.startsWith("name: "));
        if (!(card in PUBLIC_NAME_RULE)) {
          expect(names, `${card} ${f.properties.id}`).toEqual([]);
          continue;
        }
        expect(names.length, `${card} ${f.properties.id}`).toBeLessThanOrEqual(1);
        if (names.length) {
          named++;
          expect(names[0], `${card} ${f.properties.id}`).toBe(`name: ${f.properties.name}`);
        }
      }
    }
    expect(named).toBeGreaterThan(20);
  });

  it("gives every record-vector card's features record text from real fixtures, and never a feature's name", () => {
    for (const { card, features } of recordFixtures()) {
      expect(RECORD_VECTOR_CARDS.has(card), card).toBe(true);
      const texts = features.map((f) => receivedRecordText(f.properties));
      expect(texts.some((t) => t != null), card).toBe(true);
      const field = NAMED_BY_EMBEDDED_PLACE_FIELD[card];
      for (const f of features) {
        const full = receivedRecordText(f.properties);
        // A PUBLIC_NAME_RULE card's "name: " segment is checked in its own test above; nowhere else.
        const t = full && card in PUBLIC_NAME_RULE ? withoutPublicName(full) : full;
        if (!t || f.properties.name.length <= 4) continue;
        if (!field) {
          expect(t, card).not.toContain(f.properties.name);
          continue;
        }
        // The reviewed exception: the name appears once, as that field's labelled value, and nowhere
        // else, except as the whole value of another of the card's categorical fields (BIA's land area
        // "Navajo" is in BIA's "Navajo" region).
        const labelled = `${fieldLabel(card, field)}: ${f.properties.name}`;
        expect(t, `${card} ${f.properties.id}`).toContain(labelled);
        const sameWord = new Set(EMBED_TEXT[card].filter((g) => g !== field).map((g) => `${fieldLabel(card, g)}: ${f.properties.name}`));
        for (const part of t.replace(labelled, "").split("; ")) {
          if (sameWord.has(part)) continue;
          expect(part, `${card} ${f.properties.id}`).not.toContain(f.properties.name);
        }
      }
    }
    expect(new Set(recordFixtures().map((r) => r.card))).toEqual(RECORD_VECTOR_CARDS);
  });

  it("reads every embedText field of a record-vector card in its builder (the label appears in some fixture's text)", () => {
    // Fields the captured fixtures happen to leave empty, so their builder line is checked by reading, not here.
    const notInFixtures: Record<string, string[]> = {
      "nwi-wetlands": [],
      "padus-units": ["Mang_Type", "Des_Tp", "State_Nm", "GAP_Sts", "IUCN_Cat"],
      "fema-nfhl-zones": ["ZONE_SUBTY", "STUDY_TYP"],
      "fuds-mrs": ["RELATIVEPRIORITY"],
    };
    for (const { card, features } of recordFixtures()) {
      const all = features.map((f) => receivedRecordText(f.properties) ?? "").join("\n");
      for (const field of EMBED_TEXT[card]) {
        if (notInFixtures[card]?.includes(field)) continue;
        expect(all, `${card} ${field}`).toContain(`${fieldLabel(card, field)}: `);
      }
    }
  });

  it("keeps a private dam's and a private PAD-US unit's published name out; a public dam's name only as its label", () => {
    const rows = (dams as { features: Array<{ properties: Record<string, unknown> }> }).features;
    const built = buildDams(rows as never);
    const blueWing = built.find((f) => f.properties.details?.["published name"] === "Blue Wing Lake Dam");
    expect(blueWing).toBeDefined();
    expect(receivedRecordText(blueWing!.properties)).not.toMatch(/blue wing/i);
    let privates = 0;
    for (const [i, f] of built.entries()) {
      const row = rows.find((r) => `nid:${r.properties.NIDID}` === f.properties.id)!.properties;
      const name = String(row.NAME ?? `no name ${i}`);
      const t = receivedRecordText(f.properties) ?? "";
      if (String(row.PRIMARY_OWNER_TYPE).toLowerCase() === "private") {
        privates++;
        expect(t, name).not.toContain(name);
      } else {
        expect(withoutPublicName(t), name).not.toContain(name);
        expect(t, name).toContain(`name: ${name}`);
      }
    }
    expect(privates).toBe(2);
    const padus = recordFixtures().find((r) => r.card === "padus-units")!.features[0];
    expect(padus.properties.details?.["published name"]).toBe("Smith Family Farm");
    expect(receivedRecordText(padus.properties)).not.toMatch(/smith/i);
  });

  it("allows the feature-name exception only for the reviewed card and field", () => {
    expect(Object.keys(NAMED_BY_EMBEDDED_PLACE_FIELD)).toEqual(["bia-lar"]);
    for (const [card, field] of Object.entries(NAMED_BY_EMBEDDED_PLACE_FIELD)) {
      expect(NAME_FIELDS_ALLOWED.has(field), field).toBe(true);
      const fields: readonly string[] = EMBED_TEXT[card as CollectionId];
      expect(fields, card).toContain(field);
      // Every other field of the card is categorical: no second name rides on the exception.
      for (const g of fields) if (g !== field) expect(/name$/i.test(g) || NAME_FIELDS_ALLOWED.has(g), `${card}: ${g}`).toBe(false);
    }
  });

  it("says what a BIA land area and a WRC community are in their record text (DESIGN 7.3a)", () => {
    const lar = recordFixtures().find((r) => r.card === "bia-lar")!.features;
    const wind = lar.find((f) => f.properties.name === "Wind River");
    expect(receivedRecordText(wind!.properties)).toBe(
      "collection: Trust land, Land Area Representation; agency: Bureau of Indian Affairs (BIA); BIA land area: Wind River; BIA trust land area, BIA region: Rocky Mountain",
    );
    const wrc = buildWrcPlaces((wrcBoulder as unknown as { features: never[] }).features, 0, "national");
    const texts = new Set(wrc.map((f) => receivedRecordText(f.properties)));
    const head = "collection: Wildfire risk to communities; agency: USDA Forest Service; ";
    expect(texts).toContain(`${head}state: CO; wildfire risk community, national risk rank: 95 or more percentile; wildfire likelihood (burn probability), national rank: 95 or more percentile`);
    // The excluded community: not ranked, never low, with USFS's reason.
    expect(texts).toContain(`${head}state: CO; wildfire risk community, national risk rank: not ranked by USFS; wildfire likelihood (burn probability), national rank: not ranked by USFS; not ranked by USFS because: no people (pop = 0);`);
    for (const f of wrc) expect(receivedRecordText(f.properties) ?? "", f.properties.id).not.toMatch(/\d+\.\d+%/);
  });

  it("is null when no field has a value, and labels each value", () => {
    expect(recordText("nid-dams", {})).toBeNull();
    const head = "collection: Dams, National Inventory of Dams; agency: U.S. Army Corps of Engineers; ";
    // A NAME in the row is never read: only the publicName argument, which the builder passes for a public dam.
    expect(recordText("nid-dams", { HAZARD_POTENTIAL: "High", NAME: "Somebody Pond Dam", NID_HEIGHT: 40 })).toBe(`${head}hazard potential: High`);
    expect(recordText("nid-dams", { YEAR_COMPLETED: 0 })).toBe(`${head}year completed: 0`);
    expect(recordText("nid-dams", {}, "Victor Braunig Dam")).toBeNull();
    expect(withEmbedText({ a: 1 }, null)).toEqual({ a: 1 });
  });

  it("refuses a query outside 2..200 characters", () => {
    expect(queryText(" a ")).toBeNull();
    expect(queryText("x".repeat(201))).toBeNull();
    expect(queryText("  wetland   habitat ")).toBe("wetland habitat");
  });
});

describe("what the catalogue lets be embedded", () => {
  it("lists every card's fields in EMBED_TEXT and the card reads them from there", () => {
    expect(Object.keys(EMBED_TEXT)).toEqual(COLLECTIONS.map((c) => c.id));
    for (const c of COLLECTIONS) expect(c.embedText, c.id).toBe(EMBED_TEXT[c.id as keyof typeof EMBED_TEXT]);
  });

  it("shares a field's one label across cards only for a place word or within one source's family", () => {
    // FIELD_LABEL is keyed by the bare field name, so a second card embedding a field gets the
    // first card's label (STATUS is "FUDS status"). A field on more than one card must either
    // carry a place word, which means the same on every card, or stay inside one family of
    // cards read from the same source. A new card reusing another source's field fails here
    // until it is given a field of its own or a family is reviewed.
    const PLACE_LABELS = new Set(["state", "county", "city"]);
    const FAMILIES: string[][] = [
      ["nrhp-listed", "nhl-listed"],
      ["emef-sems", "emef-tri", "emef-rcra", "emef-acres"],
      ["fuds-properties", "fuds-projects", "fuds-mrs"],
      ["nri-counties", "nri-tracts"],
      ["places-county", "places-tract"],
    ];
    // A card-scoped label (CARD_FIELD_LABEL) makes the field the card's own: it is grouped by the
    // label it is actually embedded under, so BIA's REGION is not NPS's.
    const cardsOf = new Map<string, string[]>();
    for (const [card, fields] of Object.entries(EMBED_TEXT))
      for (const f of fields) {
        const k = JSON.stringify([f, fieldLabel(card as CollectionId, f)]);
        cardsOf.set(k, [...(cardsOf.get(k) ?? []), card]);
      }
    const shared = [...cardsOf].filter(([, cards]) => cards.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const [k, cards] of shared) {
      const [f, label] = JSON.parse(k) as [string, string];
      if (PLACE_LABELS.has(label)) continue;
      expect(
        FAMILIES.some((fam) => cards.every((c) => fam.includes(c))),
        `${f} ("${label}") is embedded by ${cards.join(", ")}`,
      ).toBe(true);
    }
    // A card-scoped label differs from every other card's label for the field, and is a real override.
    for (const [card, labels] of Object.entries(CARD_FIELD_LABEL)) {
      for (const [f, label] of Object.entries(labels ?? {})) {
        expect(EMBED_TEXT[card as CollectionId], `${card}: ${f}`).toContain(f);
        expect(label, `${card}: ${f}`).not.toBe(FIELD_LABEL[f]);
        for (const [other, fields] of Object.entries(EMBED_TEXT))
          if (other !== card && (fields as readonly string[]).includes(f)) expect(fieldLabel(other as CollectionId, f), `${other}: ${f}`).not.toBe(label);
      }
    }
    expect(fieldLabel("nps-units", "REGION")).toBe("NPS region");
    expect(fieldLabel("bia-lar", "REGION")).not.toMatch(/NPS/);
    // The check bites: hospitals embedding FUDS's STATUS would be labelled "FUDS status".
    const withStatus = [...(cardsOf.get("STATUS") ?? []), "hifld-hospitals"];
    expect(PLACE_LABELS.has(FIELD_LABEL.STATUS)).toBe(false);
    expect(FAMILIES.some((fam) => withStatus.every((c) => fam.includes(c)))).toBe(false);
  });

  it("labels every embedText field, and lets no field end in 'name' outside the reviewed list", () => {
    for (const c of COLLECTIONS) {
      for (const f of c.embedText) {
        expect(embeddableField(f), `${c.id}: ${f}`).toBe(true);
        expect(fieldLabel(c.id as CollectionId, f), `${c.id}: ${f}`).toBeTruthy();
        if (/name$/i.test(f)) expect(NAME_FIELDS_ALLOWED.has(f), `${c.id}: ${f}`).toBe(true);
      }
    }
    for (const bad of ["published name", "Unit_Name", "Own_Name", "assessmentunitname", "organizationname", "NAME"]) expect(embeddableField(bad), bad).toBe(false);
  });

  it("embeds no id, free-text or measured field the round's rules keep out", () => {
    const out = ["NRIS_Refnum", "assessmentunitidentifier", "assessmentunitname", "organizationname", "cas_registry_number", "DFIRM_ID", "UNIT", "FR", "fedreg", "pgm_sys_id", "registry_id", "Citation", "NICE_DESC", "SRC_RES", "NID_HEIGHT", "STATIC_BFE", "Population_Served", "Release_Count", "Open_Count", "Facility_Count"];
    for (const c of COLLECTIONS) for (const f of out) expect(c.embedText, `${c.id}: ${f}`).not.toContain(f);
  });

  it("keeps records-eval's pinned corpus: 18 record-vector cards, none of round 8's four among them", () => {
    expect(RECORD_VECTOR_CARDS.size).toBe(18);
    for (const id of ["ncei-storm-events-county", "hud-dda", "hud-lihtc", "cms-hospital-ratings"]) expect(RECORD_VECTOR_CARDS.has(id), id).toBe(false);
  });

  it("says for every card whether its builder attaches record text, and why not", () => {
    for (const c of COLLECTIONS) {
      const has = RECORD_VECTOR_CARDS.has(c.id);
      expect(has !== c.id in NO_RECORD_VECTORS, c.id).toBe(true);
      if (has) expect(c.embedText.length, c.id).toBeGreaterThan(0);
    }
  });

  it("embeds a card's prose, never its sensitivity line, caveats or exclusions", () => {
    const texts = allCardTexts();
    expect(texts).toHaveLength(COLLECTIONS.length);
    const nid = COLLECTIONS.find((c) => c.id === "nid-dams")!;
    const t = cardText(nid);
    expect(t).toContain(nid.title);
    expect(t).toContain("Shelf: Infrastructure.");
    expect(t).not.toContain(nid.sensitivity);
    for (const x of nid.excluded) expect(t).not.toContain(x.why);
  });
});
