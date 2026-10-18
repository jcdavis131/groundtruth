// The notable-people store: SEC Form 3/4/5 reporting owners by issuer, read
// from lib/people/data/insiders.json (built offline by scripts/people-data.py;
// docs/PEOPLE.md, "The bundle").
//
// Server only. The file is read once per process, on first use, with
// node:fs, never imported: nothing under public/, no client module and no
// JSON import can carry it to a browser (lib/people/boundary.test.ts). The
// owner-to-issuers index is built from it at load.
//
// What the store guarantees, whatever its caller does with the answer:
//   - Lookups are by CIK, padded or not; a name is never a key (G8).
//   - A trust, estate or family vehicle comes back with no name, no CIK and
//     no title, and cannot be looked up as an owner (G9).
//   - A withheld owner (lib/people/suppressed.ts) is left out of every answer
//     with no count, so "withheld" and "never filed" read the same (G16).
//   - Positional rows are decoded only when the file's header matches the
//     layout this module expects, and every row is checked on load; a shifted
//     column fails the load instead of landing in a name.
//   - A missing file is an honest empty store (built: false), not a finding
//     that a company has no insiders.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { INSIDER_ROLES, normalizeCik, type InsiderRole } from "@/lib/fabric/parties";
import { withheldCheck } from "./suppressed";

export type OwnerClass = "individual" | "entity" | "vehicle" | "business";

/** One reporting owner of one issuer, over the bundle's window. */
export interface InsiderLink {
  /** 10-digit CIK of the issuer the owner files about. */
  issuerCik: string;
  /** 10-digit CIK of the owner; null for a vehicle, which is listed by role only. */
  ownerCik: string | null;
  ownerClass: OwnerClass;
  /** Name as filed in the latest filing; null for a vehicle. Shown, never a key. */
  name: string | null;
  /** Union of the relationships filed in the window, in form order. */
  roles: InsiderRole[];
  /** Officer title from the latest officer filing, as filed. */
  title: string | null;
  /** The filing points its title at the remarks, which are not read. */
  titleInFiling: boolean;
  firstFiled: string;
  lastFiled: string;
  lastPeriod: string;
  /** The latest filing's date when it has this owner alone and is marked not subject to Section 16. */
  nssFiled: string | null;
  /** "3", "4" or "5", with "/A" for an amendment. */
  lastForm: string;
  lastAccession: string;
  /** For an "other" relationship: one of OTHER_PHRASES. */
  otherText: string | null;
}

/** Everything one owner filed about, across issuers. */
export interface OwnerLinks {
  ownerCik: string;
  ownerClass: Exclude<OwnerClass, "vehicle">;
  /** By issuer CIK. */
  links: InsiderLink[];
}

export interface PeopleMeta {
  /** False when the bundle file is missing: answers are empty, which is not a finding. */
  built: boolean;
  source: "sec-form345";
  quarters: string[];
  periodFrom: string | null;
  periodTo: string | null;
  pulled: string | null;
}

export interface PeopleStore {
  readonly meta: PeopleMeta;
  /** The bundle holds filings about this issuer. Not affected by withholding. */
  isIssuer(cik: string | number): boolean;
  /** The issuer's reporting owners, withheld owners left out. Empty for an unknown issuer. */
  roster(issuerCik: string | number): InsiderLink[];
  /** Every issuer the owner filed about. Null for an unknown, withheld or vehicle CIK alike. */
  owner(ownerCik: string | number): OwnerLinks | null;
  /** One issuer-owner link. Null when there is none, or the owner is withheld or a vehicle. */
  link(issuerCik: string | number, ownerCik: string | number): InsiderLink | null;
  /**
   * True for any CIK the bundle holds as an individual, entity or vehicle
   * owner, withheld or not; false for a business and for an unknown CIK. For
   * refusing an EDGAR fetch of that CIK (G13) only, never for display.
   */
  isReportingOwner(cik: string | number): boolean;
}

// ---------------------------------------------------------------- bundle layout

export const ROW_FIELDS = [
  "ownerCik",
  "name",
  "class",
  "roles",
  "title",
  "titleInFiling",
  "firstFiled",
  "lastFiled",
  "lastPeriod",
  "nssFiled",
  "lastForm",
  "lastAccession",
  "otherText",
] as const;

const CLASS_CODES: Record<string, OwnerClass> = { i: "individual", e: "entity", v: "vehicle", b: "business" };

export const ROLE_BITS: Record<InsiderRole, number> = { director: 1, officer: 2, "ten-percent-owner": 4, other: 8 };

/** The only "other" relationship text the builder keeps (G3, D5). */
export const OTHER_PHRASES = [
  "Member of a Group",
  "Member of 10% owner group",
  "Trustee",
  "Former 10% Owner",
  "Portfolio Manager",
  "Chairman of the Board",
  "Other (see filing)",
] as const;

/** ownerCik, name, class, roles, title, titleInFiling, firstFiled, lastFiled, lastPeriod, nssFiled, lastForm, lastAccession, otherText; trailing nulls left off. */
export type BundleRow = [
  number,
  string | null,
  string,
  number,
  string | null,
  number,
  string,
  string,
  string,
  (string | null)?,
  string?,
  string?,
  (string | null)?,
];

export interface PeopleBundle {
  source: string;
  quarters: string[];
  periodFrom?: string;
  periodTo?: string;
  pulled: string | null;
  row: string[];
  classes: Record<string, string>;
  roleBits: Record<string, number>;
  otherPhrases: string[];
  issuers: Record<string, BundleRow[]>;
  [k: string]: unknown;
}

export class PeopleBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeopleBundleError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FORM_RE = /^[345](?:\/A)?$/;
const ACCESSION_RE = /^\d{10}-\d{2}-\d{6}$/;
const ISSUER_KEY_RE = /^\d{10}$/;
const ALL_ROLE_BITS = Object.values(ROLE_BITS).reduce((a, b) => a | b, 0);

function sameList(a: unknown, b: readonly unknown[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameRecord(a: unknown, b: Record<string, unknown>): boolean {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const keys = Object.keys(b);
  return Object.keys(a).length === keys.length && keys.every((k) => (a as Record<string, unknown>)[k] === b[k]);
}

function checkHeader(b: PeopleBundle): void {
  if (b.source !== "sec-form345") throw new PeopleBundleError("people bundle: source is not sec-form345");
  if (!sameList(b.row, ROW_FIELDS)) throw new PeopleBundleError("people bundle: the row layout differs from the one this reader decodes");
  if (!sameRecord(b.classes, CLASS_CODES)) throw new PeopleBundleError("people bundle: class codes differ");
  if (!sameRecord(b.roleBits, ROLE_BITS)) throw new PeopleBundleError("people bundle: role bits differ");
  if (!sameList(b.otherPhrases, OTHER_PHRASES)) throw new PeopleBundleError("people bundle: the 'other' phrase list differs");
  if (!Array.isArray(b.quarters) || !b.quarters.every((q) => /^\d{4}q[1-4]$/.test(q))) throw new PeopleBundleError("people bundle: bad quarters");
  if (!b.issuers || typeof b.issuers !== "object") throw new PeopleBundleError("people bundle: no issuers");
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNullableStr = (v: unknown) => v === null || v === undefined || typeof v === "string";

/** Throws on any row that is not exactly what the builder writes. */
function checkRow(issuer: string, r: unknown, i: number): asserts r is BundleRow {
  const where = `people bundle: issuer ${issuer} row ${i}`;
  if (!Array.isArray(r) || r.length < 12 || r.length > ROW_FIELDS.length) throw new PeopleBundleError(`${where}: wrong length`);
  const [owner, name, cls, roles, title, tif, first, last, period, nss, form, accession, other] = r as unknown[];
  if (typeof owner !== "number" || !Number.isSafeInteger(owner) || owner <= 0 || owner > 9_999_999_999) throw new PeopleBundleError(`${where}: bad owner CIK`);
  if (!isStr(cls) || !(cls in CLASS_CODES)) throw new PeopleBundleError(`${where}: bad class`);
  if (!(name === null || isStr(name)) || (name === null && cls !== "v")) throw new PeopleBundleError(`${where}: bad name`);
  if (typeof roles !== "number" || !Number.isInteger(roles) || roles <= 0 || (roles & ~ALL_ROLE_BITS) !== 0) throw new PeopleBundleError(`${where}: bad roles`);
  if (!isNullableStr(title)) throw new PeopleBundleError(`${where}: bad title`);
  if (tif !== 0 && tif !== 1) throw new PeopleBundleError(`${where}: bad titleInFiling`);
  if (![first, last, period].every((d) => isStr(d) && DATE_RE.test(d))) throw new PeopleBundleError(`${where}: bad date`);
  if (!(nss === null || (isStr(nss) && DATE_RE.test(nss)))) throw new PeopleBundleError(`${where}: bad nssFiled`);
  if (!isStr(form) || !FORM_RE.test(form)) throw new PeopleBundleError(`${where}: bad form`);
  if (!isStr(accession) || !ACCESSION_RE.test(accession)) throw new PeopleBundleError(`${where}: bad accession`);
  if (!(other === null || other === undefined || (OTHER_PHRASES as readonly unknown[]).includes(other))) throw new PeopleBundleError(`${where}: 'other' text outside the phrase list`);
}

function decodeRoles(bits: number): InsiderRole[] {
  return INSIDER_ROLES.filter((r) => (bits & ROLE_BITS[r]) !== 0);
}

function decode(issuerCik: string, r: BundleRow): InsiderLink {
  const ownerClass = CLASS_CODES[r[2]];
  const vehicle = ownerClass === "vehicle";
  return {
    issuerCik,
    ownerCik: vehicle ? null : normalizeCik(r[0]),
    ownerClass,
    name: vehicle ? null : r[1],
    roles: decodeRoles(r[3]),
    title: vehicle ? null : (r[4] ?? null),
    titleInFiling: vehicle ? false : r[5] === 1,
    firstFiled: r[6],
    lastFiled: r[7],
    lastPeriod: r[8],
    nssFiled: r[9] ?? null,
    lastForm: r[10] as string,
    lastAccession: r[11] as string,
    otherText: r[12] ?? null,
  };
}

// ---------------------------------------------------------------- the store

/** A store over a parsed bundle, or an empty one (built: false) for null. */
export function createPeopleStore(bundle: PeopleBundle | null): PeopleStore {
  const issuers = new Map<string, BundleRow[]>();
  /** owner CIK10 -> its class code and the issuers it filed about, with the row's index there. */
  const owners = new Map<string, { cls: string; at: Array<[string, number]> }>();

  if (bundle) {
    checkHeader(bundle);
    for (const [key, rows] of Object.entries(bundle.issuers)) {
      if (!ISSUER_KEY_RE.test(key) || !Array.isArray(rows)) throw new PeopleBundleError(`people bundle: bad issuer key ${JSON.stringify(key)}`);
      rows.forEach((r, i) => {
        checkRow(key, r, i);
        const owner = normalizeCik(r[0])!;
        const entry = owners.get(owner);
        if (!entry) owners.set(owner, { cls: r[2], at: [[key, i]] });
        else if (entry.cls !== r[2]) throw new PeopleBundleError(`people bundle: owner in issuer ${key} row ${i} has two classes`);
        else entry.at.push([key, i]);
      });
      issuers.set(key, rows);
    }
    for (const entry of owners.values()) entry.at.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  const meta: PeopleMeta = bundle
    ? {
        built: true,
        source: "sec-form345",
        quarters: [...bundle.quarters],
        periodFrom: bundle.periodFrom ?? null,
        periodTo: bundle.periodTo ?? null,
        pulled: bundle.pulled ?? null,
      }
    : { built: false, source: "sec-form345", quarters: [], periodFrom: null, periodTo: null, pulled: null };

  return {
    meta,

    isIssuer(cik) {
      const code = normalizeCik(cik);
      return code != null && issuers.has(code);
    },

    roster(issuerCik) {
      const withheld = withheldCheck();
      const code = normalizeCik(issuerCik);
      const rows = code ? issuers.get(code) : undefined;
      if (!code || !rows) return [];
      return rows.filter((r) => !withheld(r[0])).map((r) => decode(code, r));
    },

    owner(ownerCik) {
      const withheld = withheldCheck();
      const code = normalizeCik(ownerCik);
      const entry = code ? owners.get(code) : undefined;
      if (!code || !entry || entry.cls === "v" || withheld(code)) return null;
      return {
        ownerCik: code,
        ownerClass: CLASS_CODES[entry.cls] as OwnerLinks["ownerClass"],
        links: entry.at.map(([issuer, i]) => decode(issuer, issuers.get(issuer)![i])),
      };
    },

    link(issuerCik, ownerCik) {
      const withheld = withheldCheck();
      const issuer = normalizeCik(issuerCik);
      const owner = normalizeCik(ownerCik);
      const entry = owner ? owners.get(owner) : undefined;
      if (!issuer || !owner || !entry || entry.cls === "v" || withheld(owner)) return null;
      const hit = entry.at.find(([k]) => k === issuer);
      return hit ? decode(issuer, issuers.get(issuer)![hit[1]]) : null;
    },

    isReportingOwner(cik) {
      const code = normalizeCik(cik);
      const entry = code ? owners.get(code) : undefined;
      return entry != null && entry.cls !== "b";
    },
  };
}

/** Reads and indexes one bundle file. A missing file gives the empty store; anything else that fails throws. */
export async function loadPeopleStore(file: string): Promise<PeopleStore> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return createPeopleStore(null);
    throw err;
  }
  return createPeopleStore(JSON.parse(text) as PeopleBundle);
}

/** The committed bundle, relative to the app root. */
export function peopleBundlePath(): string {
  return path.join(process.cwd(), "lib", "people", "data", "insiders.json");
}

let store: Promise<PeopleStore> | null = null;

/** The process-wide store over the committed bundle, loaded on first use. A failed load is retried on the next call. */
export function getPeopleStore(): Promise<PeopleStore> {
  store ??= loadPeopleStore(peopleBundlePath()).catch((err: unknown) => {
    store = null;
    throw err;
  });
  return store;
}
