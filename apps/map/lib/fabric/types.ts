// Place fabric: the constructs a point sits inside.
//
// The physical layers (aircraft, gauges, wells, harbours) are things you can
// point at. The constructs are the human and scientific frames laid over the
// same ground: the county that governs it, the district that votes for it,
// the watershed it drains through, the ecoregion it belongs to, the flood zone
// it was mapped into, the weather office that forecasts it, the federal
// region that administers it. A point is where all of those meet, so the
// point is the join key: every point of view on the globe is tied to every
// other through the constructs they share.
//
// Everything here is pure data shapes; lib/fabric/parse.ts fills them from
// the upstreams and lib/fabric/graph.ts orders and links them.

import type { SourceId } from "@/lib/provenance/sources";

/**
 * The point of view a construct belongs to. One lens on the same ground:
 * who governs it, who represents it, how it is counted, who serves it, where
 * its water goes, what grows there, what threatens it, which federal office
 * answers for it, which country it is in.
 */
export type Domain =
  | "civic"
  | "representation"
  | "statistical"
  | "service"
  | "hydrologic"
  | "ecological"
  | "hazard"
  | "federal"
  | "world";

export type ConstructKind =
  | "country"
  | "continent"
  | "state"
  | "county"
  | "place"
  | "cdp"
  | "tribal"
  | "cd"
  | "sldu"
  | "sldl"
  | "tract"
  | "zcta"
  | "cbsa"
  | "csa"
  | "urban"
  | "census-division"
  | "census-region"
  | "school"
  | "nws-office"
  | "nws-zone"
  | "timezone"
  | "huc2"
  | "huc4"
  | "huc6"
  | "huc8"
  | "huc10"
  | "huc12"
  | "eco3"
  | "eco4"
  | "flood"
  | "flood-community"
  | "nws-alert"
  | "epa-region"
  | "fema-region"
  | "fed-district";

export interface ConstructLink {
  label: string;
  /** Absolute URL, or a path on this site ("/place/48453"). */
  url: string;
}

export interface ConstructNode {
  /** Stable id, "<kind>:<code>", e.g. "county:48453", "huc8:12090205", "cd:4810". */
  id: string;
  kind: ConstructKind;
  domain: Domain;
  name: string;
  /** Upstream identifier (GEOID, HUC, zone id, ecoregion code). */
  code?: string;
  /** Area as the upstream publishes it, km². TIGERweb is land area; WBD is total area. */
  areaKm2?: number;
  /** Which area the number is ("land" from TIGERweb, "total" from WBD). */
  areaBasis?: "land" | "total";
  /** Internal point of the unit as published, [lon, lat]. */
  anchor?: [number, number];
  /** Generalised outline, rings of [lon, lat]. Present only when geometry was asked for. */
  rings?: number[][][];
  /** Further published attributes, rendered verbatim. */
  facts: Record<string, string | number | null>;
  links: ConstructLink[];
  source: SourceId;
}

export type Relation =
  /** A is part of B by the definition of the unit system (tract in county, HUC-12 in HUC-10). */
  | "nests-in"
  /** A's water flows into B (WBD ToHUC). B may be outside the stack. */
  | "drains-to"
  /** A is assigned to B by the agency that runs B (NWS zone to its forecast office, state to its EPA region). */
  | "assigned-to";

export interface ConstructEdge {
  from: string;
  to: string;
  relation: Relation;
  /** Where the relation comes from, in a few words. */
  basis: string;
  /** true when `to` is not a node in this stack (a downstream HUC-12). */
  external?: boolean;
}

export interface FabricPoint {
  lon: number;
  lat: number;
  /** Ground elevation in metres from USGS 3DEP, when the point is covered. */
  elevationM?: number;
}

export interface Fabric {
  point: FabricPoint;
  /** Smallest construct first. */
  nodes: ConstructNode[];
  edges: ConstructEdge[];
  /** Upstreams that answered, and ones that failed with the reason. */
  answered: SourceId[];
  failed: { source: SourceId; error: string }[];
  /** Plain-language coverage note ("US constructs need a point inside the United States"). */
  coverage: string;
  /** Nearest geotagged Wikipedia articles to the point (lib/fabric/wiki.ts), when Wikipedia answered. */
  wikiNearby?: Array<{ title: string; distM: number; url: string }>;
}

/** Layer-side payload carried on every constructs feature. */
export interface ConstructExtra {
  node?: ConstructNode;
  /** Altitude of this construct's stratum, metres. */
  alt: number;
  /** 0 = nearest the ground. */
  tier: number;
  /** The point the stack was asked about, [lon, lat]; every stratum is tethered to it. */
  ground: [number, number];
  /** Wall-clock ms the stratum was created; the style raises it out of the ground from here. */
  born?: number;
  /** The immediate parent and child of this construct (lib/fabric/strata.ts focusSet), ghosted when it is focused. */
  parent?: ConstructNode;
  child?: ConstructNode;
  /** For the "here" anchor: the whole stack and its edges. */
  fabric?: Fabric;
}
