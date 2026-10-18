// The party graph sits beside the place fabric, not in it: its kinds,
// domains and relations are not the fabric's, a PartyNode cannot stand in for
// a ConstructNode, and ids are canonical and padded whatever the input.
import { describe, expect, it } from "vitest";
import { DOMAINS, KINDS } from "./catalog";
import {
  INSIDER_ROLES,
  normalizeCik,
  PARTY_DOMAIN,
  PARTY_KINDS,
  PARTY_LABEL,
  parsePartyId,
  partyId,
  type PartyDomain,
  type PartyKind,
  type PartyNode,
  type PartyRelation,
} from "./parties";
import type { ConstructKind, ConstructNode, Domain, Relation } from "./types";

const person: PartyNode = {
  id: "person:0009000001",
  kind: "person",
  domain: "people",
  name: "[removed from this fixture: an officer]",
  code: "0009000001",
  facts: {},
  links: [],
  source: "sec-form345",
};

describe("party ids", () => {
  it("pads a CIK to 10 digits from a string or a number", () => {
    expect(normalizeCik("320193")).toBe("0000320193");
    expect(normalizeCik("0000320193")).toBe("0000320193");
    expect(normalizeCik(320193)).toBe("0000320193");
    expect(normalizeCik("9999999999")).toBe("9999999999");
  });

  it("refuses anything that is not 1 to 10 digits", () => {
    for (const bad of ["", " 320193", "320193 ", "+320193", "-1", "0", "0000000000", "12345678901", "3.2e5", "0x4E4E1", "CIK320193", "320193\n"]) {
      expect(normalizeCik(bad), JSON.stringify(bad)).toBeNull();
    }
    for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) expect(normalizeCik(bad), String(bad)).toBeNull();
    expect(normalizeCik(null)).toBeNull();
    expect(normalizeCik(undefined)).toBeNull();
  });

  it("builds canonical ids and reads them back, padded or not", () => {
    expect(partyId("business", 320193)).toBe("business:0000320193");
    expect(partyId("person", "9000001")).toBe("person:0009000001");
    expect(parsePartyId("person:9000001")).toEqual({ kind: "person", cik: "0009000001" });
    expect(parsePartyId("business:0000320193")).toEqual({ kind: "business", cik: "0000320193" });
    expect(parsePartyId("institution:9000005")).toEqual({ kind: "institution", cik: "0009000005" });
    expect(() => partyId("person", "doe")).toThrow();
  });

  it("reads no other id shape", () => {
    for (const bad of ["", "person", "person:", ":320193", "Person:320193", "county:48453", "person:doe", "person:320193:x", "320193", "person:12345678901"]) {
      expect(parsePartyId(bad), bad).toBeNull();
    }
    expect(parsePartyId(null)).toBeNull();
  });
});

describe("party kinds beside the place fabric", () => {
  it("are business, person and institution, with Cam's label for a person", () => {
    expect(PARTY_KINDS).toEqual(["business", "person", "institution"]);
    expect(PARTY_LABEL.person).toBe("Notable person");
    expect(PARTY_DOMAIN).toEqual({ business: "enterprise", person: "people", institution: "enterprise" });
    expect(INSIDER_ROLES).toEqual(["director", "officer", "ten-percent-owner", "other"]);
  });

  it("add no construct kind and no domain to the fabric catalog", () => {
    for (const k of PARTY_KINDS) expect(Object.keys(KINDS)).not.toContain(k);
    for (const d of Object.values(PARTY_DOMAIN)) expect(Object.keys(DOMAINS)).not.toContain(d);
  });

  it("cannot be passed where the fabric's types are expected", () => {
    // @ts-expect-error a party is not a construct: no area kind, no outline, no anchor
    const asConstruct: ConstructNode = person;
    // @ts-expect-error "person" is not a ConstructKind
    const kind: ConstructKind = person.kind;
    // @ts-expect-error "people" is not a fabric Domain
    const domain: Domain = person.domain;
    const insider: PartyRelation = "insider-of";
    // @ts-expect-error "insider-of" is not a fabric Relation
    const relation: Relation = insider;
    expect([asConstruct, kind, domain, relation]).toHaveLength(4);
  });

  it("carry no geometry", () => {
    // Checked by tsc: "absent" stops compiling if PartyNode gains any of these keys.
    type Absent<K extends string> = [K & keyof PartyNode] extends [never] ? "absent" : "present";
    const geometry: Absent<"areaKm2" | "areaBasis" | "anchor" | "rings" | "elevationM"> = "absent";
    expect(geometry).toBe("absent");
    expect(Object.keys(person)).not.toEqual(expect.arrayContaining(["areaKm2"]));
    const kinds: PartyKind[] = [...PARTY_KINDS];
    const domains: PartyDomain[] = ["enterprise", "people"];
    expect(kinds).toHaveLength(3);
    expect(domains).toHaveLength(2);
  });
});
