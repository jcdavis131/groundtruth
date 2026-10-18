// What the ⌘K palette (and nothing else) may match a query against.
//
// A feature is found by its name, its id, or one of the dossier fields on
// SEARCHABLE_DETAILS: published identifiers, categories and place names.
// Owner, operator, manager, easement-holder, bank, provider and recipient
// fields are never on the list, so the palette never goes from a person's
// name, or an owner's, to what they own through those fields. Institutions
// are found by the names their publishers give the feature, and some of
// those names carry the institution: an FDIC branch is "<bank> · <office>",
// so a bank's name lists the branches of it that are loaded (README, Ethics;
// CONTRIBUTING, ground rules). A new layer's identifier is added here
// explicitly; nothing is searchable by default. Pure, so the rule is tested
// without a globe.

import type { BaseProps } from "@/lib/layers/types";

/** Dossier keys (lower case) the palette searches besides a feature's name and id. */
export const SEARCHABLE_DETAILS: ReadonlySet<string> = new Set([
  // aircraft, ships, satellites
  "icao24",
  "callsign",
  "registration",
  "mmsi",
  "imo",
  "call sign",
  "norad id",
  "intl designator",
  "origin country",
  "destination",
  // launches
  "vehicle",
  "mission",
  "pad",
  "site",
  // sports: the feature name is the abbreviated score line ("DAL @ NYG"),
  // so the full team names and the league are what a query finds a game by
  "matchup",
  "league",
  // hazards, land, water, economy
  "fire id",
  // national heritage: NPS unit codes and World Heritage inscription numbers
  "unit code",
  "whs ref",
  "cowardin code",
  "zone",
  "port code",
  "locode",
  "local name",
  // infrastructure and geohazards: the registries' own identifiers and survey
  // numbers. Never a line's owner, a pipeline's operator, a railroad's
  // reporting marks or trackage rights, or a plant's reporting entity.
  "nid id",
  "faa location id",
  "icao code",
  "eia plant id",
  "wikidata item",
  "hifld id",
  "fra arc id",
  "usgs id",
  "fault number",
  "plss id",
  "first division id",
  "township",
  "range",
  "section",
  // parcels: the parcel id the county or state publishes. Never "owner",
  // "taxpayer", "mailing" or "owner address": no search from a name to land.
  "parcel id",
  // zoning: the district code a city publishes ("DOC1 U/450-U", "C6-4.5"); never the
  // ordinance, the city's prose or a record link
  "zoning",
  // permits, licences, environmental permits: the numbers and types their registries
  // publish; never the address, the contractor, a facility or project name, a licensee
  "permit number",
  "licence number",
  "licence type",
  "permit id",
  // historic places: NPS's NRIS reference number. Never the property's name (it can be
  // a person's: "Milam, Ben, Statue"); the feature is named by its number instead
  "nris refnum",
  // public schools: NCES's school id (the feature is labelled by the school's published
  // name). Hospitals' "HIFLD id" is matched by "hifld id" above, the key HIFLD's
  // transmission lines share; a hospital's county FIPS and city, state are on "county"
  // and "place" below
  "nces school id",
  // contaminated sites: EPA's program and FRS registry ids. Never the facility name
  // (EPA's primary_name can be a sole proprietor's own name or a street address)
  "program system id",
  "registry id",
  // Superfund site boundaries: EPA's site id. Never the site name (SITE_NAME can carry a
  // person's or a business's name); the feature is named by its EPA ID instead
  "epa id",
  // Formerly Used Defense Sites: USACE's property and project numbers. Never a property,
  // site or project name (they can be a person's: "BARTLETT PROPERTY")
  "fuds property number",
  "fuds project number",
  // impaired waters: EPA ATTAINS assessment unit ids (state-assigned codes); the unit's
  // name is a place name but is not searched in this round
  "assessment unit id",
  // trust land: BIA's land area id (the feature is labelled by BIA's land area name, a place's)
  "lar id",
  // housing tax credits (round 8): HUD's LIHTC project id and HUD's DDA code. No LIHTC project
  // name or address is searchable: a LIHTC point carries nameNotSearchable, so its label (HUD's
  // PROJECT as HUD publishes it, which can be a street address) is never matched, and PROJ_ADD is
  // never on this list. A LIHTC project is found by its HUD id only; its address appears on click
  "hud id",
  "hud dda code",
  // PFAS in drinking water: EPA's public water system id. Never the system's name (some
  // are apartment complexes, nursing homes or rental parks)
  "pwsid",
  // companies, banks, constructs: identifiers and categories their publishers assign
  "ticker",
  "cik",
  "sector",
  "sic",
  "fdic cert",
  "code",
  // places
  "place",
  "area",
  "county",
  "state",
  "country",
  "venue",
  // Left off on purpose: a branch's "bank", a launch's "provider" and an
  // aircraft's "operator" name who runs the thing, so searching them would go
  // from that name to what it operates; a company's "HQ" is a street address,
  // and companies are found by name, ticker, CIK, sector, SIC and county.
]);

export function searchableDetail(key: string): boolean {
  return SEARCHABLE_DETAILS.has(key.toLowerCase());
}

/**
 * How well a feature matches a lower-cased query: 3 for an exact name or id,
 * 2 for a prefix of either, 1 for a name that contains it or an allowlisted
 * dossier value that does, 0 for no match. The outline of the box a land
 * layer loaded is map furniture, never a match. A feature whose name is a
 * label only (nameNotSearchable: a LIHTC project's) is matched by its id and
 * allowlisted fields, never by its name.
 */
export function matchScore(p: BaseProps, needle: string): number {
  if (!needle || p.kind === "loaded-box") return 0;
  // A label-only name is "" here, which no (non-empty) needle equals, starts or is inside.
  const name = p.nameNotSearchable ? "" : p.name.toLowerCase();
  const id = p.id.toLowerCase();
  if (name === needle || id === needle) return 3;
  if (name.startsWith(needle) || id.startsWith(needle)) return 2;
  if (name.includes(needle)) return 1;
  for (const [k, v] of Object.entries(p.details ?? {})) {
    if (!searchableDetail(k)) continue;
    if ((typeof v === "string" || typeof v === "number") && String(v).toLowerCase().includes(needle)) return 1;
  }
  return 0;
}
