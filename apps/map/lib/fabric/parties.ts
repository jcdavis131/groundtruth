// Parties: the businesses, people and institutions tied to a company, kept in
// a graph of their own beside the place fabric.
//
// The place fabric (lib/fabric/types.ts) is areas: every ConstructNode has a
// kind with an order of size, an outline or an anchor, and a place in the
// strata. A company or a person has none of those, and putting one in
// Fabric.nodes would make it searchable by name in the command palette and a
// feature on the globe. So parties get their own kinds, domains and relations
// here, and ConstructKind, Domain, Relation and Fabric stay as they are.
//
//   business      a listed issuer, id "business:<cik10>"
//   person        a notable person: an individual who files Forms 3, 4 and 5
//                 about a business ("Notable person" is Cam's term,
//                 2026-10-01), id "person:<cik10>"
//   institution   a fund or company that files as an owner and is not a listed
//                 issuer, id "institution:<cik10>"; listed under the business,
//                 no view of its own
//
// A PartyNode has no areaKm2, rings or anchor, so the type system refuses it
// wherever a ConstructNode is expected. Identity is the CIK, never the name
// (docs/PEOPLE.md, G8). Pure shapes and id helpers only: this module imports
// nothing, and lib/people reads it, never the other way round.
//
// Named "party" because lib/screener/fields.ts already exports EntityKind.

export type PartyKind = "business" | "person" | "institution";

/** Not added to the place fabric's Domain. */
export type PartyDomain = "enterprise" | "people";

export type InsiderRole = "director" | "officer" | "ten-percent-owner" | "other";

export type PartyRelation =
  /** A person, or a business, files Forms 3, 4 and 5 as a reporting owner of the business. */
  | "insider-of"
  /** A business to the county of its registered business address (lib/fabric M7; none emitted yet). */
  | "headquartered-in";

export const PARTY_KINDS: readonly PartyKind[] = ["business", "person", "institution"];

/** Relationship order as the forms list it, which is also the bundle's role-bit order. */
export const INSIDER_ROLES: readonly InsiderRole[] = ["director", "officer", "ten-percent-owner", "other"];

export const PARTY_DOMAIN: Record<PartyKind, PartyDomain> = {
  business: "enterprise",
  person: "people",
  institution: "enterprise",
};

export const PARTY_LABEL: Record<PartyKind, string> = {
  business: "Business",
  person: "Notable person",
  institution: "Institutional or entity owner",
};

export interface PartyLink {
  label: string;
  url: string;
}

export interface PartyPlace {
  countyFips: string | null;
  zip: string | null;
  precision: "zcta-centroid" | "city-centroid" | null;
  basis: string;
}

export interface PartyNode {
  /** `${kind}:${cik10}`, e.g. "business:0000320193". */
  id: string;
  kind: PartyKind;
  domain: PartyDomain;
  /** As filed; shown, never a merge or join key. */
  name: string;
  /** The 10-digit CIK. */
  code: string;
  /** Business only: where the company is placed, and how. */
  place?: PartyPlace;
  facts: Record<string, string | number | null>;
  links: PartyLink[];
  source: string;
}

export interface PartyEvidence {
  accession: string;
  form: string;
  filed: string;
}

export interface PartyEdge {
  from: string;
  to: string;
  relation: PartyRelation;
  /** Where the relation comes from, in a few words ("SEC Form 3/4/5 reporting owner"). */
  basis: string;
  source: string;
  roles?: InsiderRole[];
  title?: string | null;
  /** The filing puts the title in its remarks, which are not read. */
  titleInFiling?: boolean;
  otherText?: string | null;
  firstFiled?: string;
  lastFiled?: string;
  lastPeriod?: string;
  /** The date of a filing marked "not subject to Section 16", as filed; never read as "left". */
  nssFiled?: string | null;
  evidence?: PartyEvidence[];
}

/** A place frame the business sits in, reached by code (M7). */
export interface PartyFrame {
  id: string;
  kind: string;
  name: string;
  code: string;
  relation: string;
  basis: string;
}

/** An institution or entity owner, listed under the business by filed name. */
export interface EntityOwner {
  id: string;
  name: string;
  roles: InsiderRole[];
  firstFiled: string;
  lastFiled: string;
  evidence: PartyEvidence[];
}

/** A trust, estate or family vehicle: listed by role only, with no name and no CIK. */
export interface VehicleOwner {
  roles: InsiderRole[];
  firstFiled: string;
  lastFiled: string;
  evidence: PartyEvidence[];
}

export interface PartyAsOf {
  source: string;
  quarters: string[];
  pulled: string | null;
}

export interface PartyGraph {
  focus: PartyNode;
  nodes: PartyNode[];
  edges: PartyEdge[];
  frames: PartyFrame[];
  /** Listed under the business, not as nodes. */
  owners: {
    entities: EntityOwner[];
    vehicles: VehicleOwner[];
  };
  asOf: PartyAsOf[];
}

const CIK_RE = /^\d{1,10}$/;

/**
 * The 10-digit, zero-padded form of a CIK given padded, unpadded or as a
 * number. Null for anything else: signs, spaces, letters, more than 10 digits,
 * or zero.
 */
export function normalizeCik(input: string | number | null | undefined): string | null {
  if (input == null) return null;
  const s = typeof input === "number" ? (Number.isSafeInteger(input) && input > 0 ? String(input) : "") : input;
  if (!CIK_RE.test(s)) return null;
  const padded = s.padStart(10, "0");
  return padded === "0000000000" ? null : padded;
}

export function partyId(kind: PartyKind, cik: string | number): string {
  const code = normalizeCik(cik);
  if (!code) throw new Error("partyId needs a CIK of 1 to 10 digits");
  return `${kind}:${code}`;
}

/** "person:1552050" or "person:0001552050" to its kind and padded CIK; null for any other shape. */
export function parsePartyId(id: string | null | undefined): { kind: PartyKind; cik: string } | null {
  if (typeof id !== "string") return null;
  const i = id.indexOf(":");
  if (i < 0) return null;
  const kind = id.slice(0, i) as PartyKind;
  if (!PARTY_KINDS.includes(kind)) return null;
  const cik = normalizeCik(id.slice(i + 1));
  return cik ? { kind, cik } : null;
}
