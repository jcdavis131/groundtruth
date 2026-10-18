// The internal link graph. Without it every place page is a sitemap-only
// orphan: a URL a crawler is told about and nothing on the site points at,
// which is the shape of a doorway farm rather than a reference work.
//
// The graph is built so that no place is more than three hops from the home
// page — / to /state to /state/TX to /place/48453 — and so that each page
// links sideways as well as up: neighbouring counties, the rest of the metro,
// the largest counties of the state, the metro and state pages, the place's
// own brief and a compare page per neighbour. That is roughly twenty
// in-content links, all server-rendered, all site-relative.
//
// Every group degrades on its own. A seed manifest has no adjacency and no
// CBSA membership, so `neighbours` and `sameMetro` come back empty and the
// page omits those headings; `sameState` still fills from the state table,
// which is complete offline, so the link block NEVER disappears entirely.
// `ranked` orders the in-state list by whatever the caller has measured
// (jobs.emp, in practice); with no ranking the manifest's own name order is
// used, because an unordered list of real counties beats no list at all.
//
// A county appears in at most one group: neighbours first, then the metro,
// then the state. Two links to the same page under two headings is a worse
// page and a worse crawl.
//
// Ethics: places only. Every href is a place, a comparison of two places or a
// place's brief. Nothing here addresses a person, a parcel or a building.

import {
  MANIFEST,
  countiesInMetro,
  countiesInState,
  countyByFips,
  countyLabel,
  metroByCbsa,
  metroForCounty,
  metrosInState,
  stateByFips,
  stateByUsps,
  type CountyRef,
  type MetroRef,
  type StateRef,
} from "./registry";
import { scopeBriefPath, scopePath, scopeShortName, type PlaceScope } from "./scope";

export interface PlaceLink {
  /** Site-relative, always with a leading slash. */
  href: string;
  label: string;
  /** What the link is, in two or three words. Rendered as the smaller line. */
  sub?: string;
  rel: "up" | "sibling" | "down" | "compare" | "self";
}

export interface LinkSets {
  breadcrumb: Array<{ name: string; url: string }>;
  up: PlaceLink[];
  neighbours: PlaceLink[];
  sameState: PlaceLink[];
  sameMetro: PlaceLink[];
  compare: PlaceLink[];
  brief: PlaceLink;
  feeds: { rss: string; json: string };
}

export interface LinkOptions {
  /** id (GEOID or CBSA) to a size measure; bigger sorts first. Missing ids keep manifest order behind the ranked ones. */
  ranked?: Map<string, number>;
  /** Cap for the in-state and in-metro lists. */
  max?: number;
}

/** How many in-state siblings a page links. Eight is a block a reader scans, not a directory. */
export const SAME_STATE_MAX = 8;

/** The national index is the list of states: that is what "United States" means as a crawl node. */
export const COUNTRY_LABEL = "United States";
export const COUNTRY_URL = "/state";

// ---------------------------------------------------------------- link makers

function countyHref(geoid: string): string {
  return `/place/${geoid}`;
}

function countyLink(c: CountyRef, rel: PlaceLink["rel"], opts: { full?: boolean; sub?: string } = {}): PlaceLink {
  return { href: countyHref(c.geoid), label: opts.full ? countyLabel(c) : c.name, ...(opts.sub ? { sub: opts.sub } : {}), rel };
}

function metroLink(m: MetroRef, rel: PlaceLink["rel"]): PlaceLink {
  return { href: `/metro/${m.cbsa}`, label: m.name, sub: "metro area", rel };
}

function stateLink(s: StateRef, rel: PlaceLink["rel"]): PlaceLink {
  return { href: `/state/${s.usps}`, label: s.name, sub: "state", rel };
}

/**
 * One side of a compare pair. A county is a bare five-digit code because
 * lib/places/scope.ts reads a bare code as a county; a metro and a state carry
 * their prefix, because the CBSA and county code spaces overlap.
 *
 * The prefix is joined with a DOT, not the colon `scopeId` uses. A colon inside
 * a path segment is rejected by the router before the page is reached, so
 * emitting one here would make every metro and state compare link a 404.
 */
function sideToken(kind: PlaceScope["kind"], id: string): string {
  return kind === "county" ? id : `${kind}.${id}`;
}

function compareLink(
  self: { kind: PlaceScope["kind"]; id: string; label: string },
  other: { kind: PlaceScope["kind"]; id: string; label: string },
): PlaceLink {
  return {
    href: `/compare/${sideToken(self.kind, self.id)}-vs-${sideToken(other.kind, other.id)}`,
    label: `${self.label} vs ${other.label}`,
    sub: "side by side",
    rel: "compare",
  };
}

/**
 * Biggest first when the caller has a measure, manifest order otherwise. The
 * unranked tail keeps its incoming order rather than being dropped: a page
 * with a partial ranking still lists every sibling it knows.
 */
function byRank<T>(items: T[], id: (t: T) => string, ranked: Map<string, number> | undefined): T[] {
  if (!ranked || ranked.size === 0) return items;
  return items
    .map((item, i) => ({ item, i, v: ranked.get(id(item)) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      return b.v - a.v || a.i - b.i;
    })
    .map((x) => x.item);
}

// ---------------------------------------------------------------- the graph

function countyLinks(scope: Extract<PlaceScope, { kind: "county" }>, opts: LinkOptions): LinkSets {
  const max = opts.max ?? SAME_STATE_MAX;
  const ref = scope.ref;
  const state = ref ? stateByFips(ref.stateFips) : stateByFips(scope.id.slice(0, 2));
  // The scope's own ref is the manifest row when it came from the manifest, so
  // reading adjacency and CBSA off it is the same answer as a second lookup -
  // and it is the only answer a caller-built ref can give.
  const metro = ref?.cbsa ? metroByCbsa(ref.cbsa) : metroForCounty(scope.id);

  const neighbourRefs = (ref?.adj ?? []).map((g) => countyByFips(g)).filter((c): c is CountyRef => c !== null);
  const claimed = new Set<string>([scope.id, ...neighbourRefs.map((c) => c.geoid)]);

  const metroRefs = metro ? countiesInMetro(metro.cbsa).filter((c) => !claimed.has(c.geoid)) : [];
  for (const c of metroRefs) claimed.add(c.geoid);

  const stateRefs = state ? countiesInState(state.usps).filter((c) => !claimed.has(c.geoid)) : [];

  const shortSelf = ref ? ref.name : `FIPS ${scope.id}`;
  const self = { kind: "county" as const, id: scope.id, label: shortSelf };

  // A compare link per neighbour, and when adjacency has not been pulled, per
  // in-state sibling instead - the comparison is the same kind of page either
  // way and an empty group would strand the reader.
  const compareAgainst = neighbourRefs.length ? neighbourRefs : stateRefs.slice(0, 3);

  const breadcrumb = [
    { name: COUNTRY_LABEL, url: COUNTRY_URL },
    ...(state ? [{ name: state.name, url: `/state/${state.usps}` }] : []),
    ...(metro ? [{ name: metro.name, url: `/metro/${metro.cbsa}` }] : []),
    { name: shortSelf, url: countyHref(scope.id) },
  ];

  return {
    breadcrumb,
    up: [
      ...(metro ? [metroLink(metro, "up")] : []),
      ...(state ? [stateLink(state, "up")] : []),
      { href: COUNTRY_URL, label: COUNTRY_LABEL, sub: "every state", rel: "up" },
    ],
    neighbours: neighbourRefs.map((c) => countyLink(c, "sibling", { full: true, sub: "shares a border" })),
    sameMetro: byRank(metroRefs, (c) => c.geoid, opts.ranked)
      .slice(0, opts.max ?? metroRefs.length)
      .map((c) => countyLink(c, "sibling", { sub: metro ? `in the ${metro.name} metro` : undefined })),
    sameState: byRank(stateRefs, (c) => c.geoid, opts.ranked)
      .slice(0, max)
      .map((c) => countyLink(c, "sibling", { sub: state ? `in ${state.name}` : undefined })),
    compare: compareAgainst.map((c) => compareLink(self, { kind: "county", id: c.geoid, label: c.name })),
    brief: briefLink(scope),
    feeds: feedsFor(scope),
  };
}

function metroLinks(scope: Extract<PlaceScope, { kind: "metro" }>, opts: LinkOptions): LinkSets {
  const max = opts.max ?? SAME_STATE_MAX;
  const ref = scope.ref;
  const states = ref.states.map((u) => stateByUsps(u)).filter((s): s is StateRef => s !== null);
  const members = countiesInMetro(ref.cbsa);
  const siblings = states.length
    ? metrosInState(states[0].usps).filter((m) => m.cbsa !== ref.cbsa)
    : [];
  const self = { kind: "metro" as const, id: ref.cbsa, label: scopeShortName(scope) };

  return {
    breadcrumb: [
      { name: COUNTRY_LABEL, url: COUNTRY_URL },
      ...(states.length === 1 ? [{ name: states[0].name, url: `/state/${states[0].usps}` }] : []),
      { name: ref.name, url: `/metro/${ref.cbsa}` },
    ],
    up: [...states.map((s) => stateLink(s, "up")), { href: COUNTRY_URL, label: COUNTRY_LABEL, sub: "every state", rel: "up" }],
    neighbours: [],
    sameMetro: byRank(members, (c) => c.geoid, opts.ranked)
      .slice(0, opts.max ?? members.length)
      .map((c) => countyLink(c, "down", { full: true, sub: "member county" })),
    sameState: byRank(siblings, (m) => m.cbsa, opts.ranked)
      .slice(0, max)
      .map((m) => metroLink(m, "sibling")),
    compare: siblings.slice(0, 3).map((m) => compareLink(self, { kind: "metro", id: m.cbsa, label: m.name.split(",")[0] })),
    brief: briefLink(scope),
    feeds: feedsFor(scope),
  };
}

function stateLinks(scope: Extract<PlaceScope, { kind: "state" }>, opts: LinkOptions): LinkSets {
  const max = opts.max ?? SAME_STATE_MAX;
  const ref = scope.ref;
  const counties = countiesInState(ref.usps);
  const metros = metrosInState(ref.usps);
  const self = { kind: "state" as const, id: ref.usps, label: ref.name };

  return {
    breadcrumb: [
      { name: COUNTRY_LABEL, url: COUNTRY_URL },
      { name: ref.name, url: `/state/${ref.usps}` },
    ],
    up: [{ href: COUNTRY_URL, label: COUNTRY_LABEL, sub: "every state", rel: "up" }],
    neighbours: [],
    sameMetro: byRank(metros, (m) => m.cbsa, opts.ranked)
      .slice(0, max)
      .map((m) => metroLink(m, "down")),
    sameState: byRank(counties, (c) => c.geoid, opts.ranked)
      .slice(0, max)
      .map((c) => countyLink(c, "down", { sub: `in ${ref.name}` })),
    // A state compares against its own largest counties: the cohort tables
    // already hold both sides, so the page costs two Map lookups.
    compare: byRank(counties, (c) => c.geoid, opts.ranked)
      .slice(0, 3)
      .map((c) => compareLink(self, { kind: "county", id: c.geoid, label: c.name })),
    brief: briefLink(scope),
    feeds: feedsFor(scope),
  };
}

function briefLink(scope: PlaceScope): PlaceLink {
  return { href: scopeBriefPath(scope), label: `${scopeShortName(scope)} brief`, sub: "what changed, with the arithmetic", rel: "self" };
}

function feedsFor(scope: PlaceScope): { rss: string; json: string } {
  const base = scopePath(scope);
  return { rss: `${base}/feed.xml`, json: `${base}/feed.json` };
}

/**
 * Every internal link one place page emits. Pure and synchronous: the manifest
 * is the only input besides the optional ranking, so the link block renders
 * identically with no egress.
 */
export function linksFor(scope: PlaceScope, opts: LinkOptions = {}): LinkSets {
  if (scope.kind === "county") return countyLinks(scope, opts);
  if (scope.kind === "metro") return metroLinks(scope, opts);
  return stateLinks(scope, opts);
}

/** Whether the manifest can answer the two groups that need the network pull. */
export function graphCompleteness(): { adjacency: boolean; membership: boolean; note: string } {
  const complete = MANIFEST.countiesComplete;
  return {
    adjacency: complete,
    membership: complete,
    note: complete
      ? `County adjacency and CBSA membership come from the ${MANIFEST.pulled ?? "current"} manifest pull.`
      : "County adjacency and CBSA membership have not been pulled, so the neighbour and metro link groups are omitted rather than shown empty.",
  };
}
