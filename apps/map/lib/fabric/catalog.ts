// What each construct kind is, which point of view it belongs to, and where
// it sits in the stack when the upstream publishes no area for it.

import type { ConstructKind, Domain } from "./types";

export interface KindMeta {
  label: string;
  domain: Domain;
  /**
   * Ordering hint for kinds whose upstream publishes no area (time zones,
   * forecast zones, federal regions, flood zones). It only decides where the
   * stratum floats in the stack; it is never shown as a value.
   */
  orderKm2: number;
}

export const KINDS: Record<ConstructKind, KindMeta> = {
  flood: { label: "Flood zone", domain: "hazard", orderKm2: 0.5 },
  tract: { label: "Census tract", domain: "statistical", orderKm2: 10 },
  zcta: { label: "ZIP code area", domain: "statistical", orderKm2: 60 },
  huc12: { label: "Subwatershed (HUC-12)", domain: "hydrologic", orderKm2: 100 },
  place: { label: "City / town", domain: "civic", orderKm2: 200 },
  cdp: { label: "Census designated place", domain: "statistical", orderKm2: 200 },
  sldl: { label: "State house district", domain: "representation", orderKm2: 300 },
  "flood-community": { label: "NFIP community", domain: "hazard", orderKm2: 500 },
  "nws-alert": { label: "NWS warning", domain: "hazard", orderKm2: 5_000 },
  school: { label: "School district", domain: "service", orderKm2: 600 },
  huc10: { label: "Watershed (HUC-10)", domain: "hydrologic", orderKm2: 700 },
  urban: { label: "Urban area", domain: "statistical", orderKm2: 1_500 },
  tribal: { label: "Tribal land", domain: "civic", orderKm2: 2_000 },
  sldu: { label: "State senate district", domain: "representation", orderKm2: 2_000 },
  county: { label: "County", domain: "civic", orderKm2: 2_500 },
  "nws-zone": { label: "NWS forecast zone", domain: "service", orderKm2: 3_000 },
  huc8: { label: "Subbasin (HUC-8)", domain: "hydrologic", orderKm2: 3_500 },
  eco4: { label: "Ecoregion, level IV", domain: "ecological", orderKm2: 8_000 },
  cbsa: { label: "Metro / micro area", domain: "statistical", orderKm2: 10_000 },
  cd: { label: "Congressional district", domain: "representation", orderKm2: 20_000 },
  csa: { label: "Combined statistical area", domain: "statistical", orderKm2: 25_000 },
  huc6: { label: "Basin (HUC-6)", domain: "hydrologic", orderKm2: 25_000 },
  "nws-office": { label: "NWS forecast office", domain: "service", orderKm2: 60_000 },
  eco3: { label: "Ecoregion, level III", domain: "ecological", orderKm2: 70_000 },
  huc4: { label: "Subregion (HUC-4)", domain: "hydrologic", orderKm2: 75_000 },
  state: { label: "State", domain: "civic", orderKm2: 300_000 },
  huc2: { label: "Water region (HUC-2)", domain: "hydrologic", orderKm2: 450_000 },
  "census-division": { label: "Census division", domain: "statistical", orderKm2: 1_000_000 },
  "epa-region": { label: "EPA region", domain: "federal", orderKm2: 1_200_000 },
  "fema-region": { label: "FEMA region", domain: "federal", orderKm2: 1_200_000 },
  "fed-district": { label: "Federal Reserve district", domain: "federal", orderKm2: 1_500_000 },
  "census-region": { label: "Census region", domain: "statistical", orderKm2: 2_000_000 },
  timezone: { label: "Time zone", domain: "service", orderKm2: 4_000_000 },
  country: { label: "Country", domain: "world", orderKm2: 9_000_000 },
  continent: { label: "Continent", domain: "world", orderKm2: 30_000_000 },
};

export interface DomainMeta {
  label: string;
  /** The question this point of view answers about a place. */
  question: string;
  color: string;
}

/** Points of view, in the order the panel lists them. */
export const DOMAINS: Record<Domain, DomainMeta> = {
  civic: { label: "Civic", question: "Who governs it", color: "#F5C849" },
  representation: { label: "Representation", question: "Who speaks for it", color: "#F472B6" },
  service: { label: "Service", question: "Who serves it", color: "#7DD3FC" },
  statistical: { label: "Statistical", question: "How it is counted", color: "#C4B5FD" },
  hydrologic: { label: "Hydrologic", question: "Where its water goes", color: "#38BDF8" },
  ecological: { label: "Ecological", question: "What grows there", color: "#84CC16" },
  hazard: { label: "Hazard", question: "What threatens it", color: "#FB7185" },
  federal: { label: "Federal", question: "Which federal office answers for it", color: "#FB923C" },
  world: { label: "World", question: "Where on Earth", color: "#E5E7EB" },
};

export const DOMAIN_ORDER: readonly Domain[] = [
  "civic",
  "representation",
  "service",
  "statistical",
  "hydrologic",
  "ecological",
  "hazard",
  "federal",
  "world",
];

export function kindLabel(kind: ConstructKind): string {
  return KINDS[kind].label;
}

export function domainColor(domain: Domain): string {
  return DOMAINS[domain].color;
}
