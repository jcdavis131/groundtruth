// schema.org nodes for the place pages, hand-typed.
//
// No schema-dts: it is not installed and phase 1 adds no dependency. The type
// safety it would have bought is replaced by a unit test that asserts the
// required keys of every node and, more importantly, asserts the key set
// against an allowlist — which is the ethics rule expressed as a test. A
// schema.org Place accepts `address`, and a LocalBusiness accepts `founder`
// and `employee`; this file emits neither and the test fails if one appears.
//
// The Dataset node is the part that has to be TRUE rather than decorative.
// Its distributions are real CSV endpoints this app already serves, its
// temporalCoverage is the Zillow month and the QCEW quarter actually loaded
// for this page, its isBasedOn entries are the upstream URLs recorded in the
// page's own provenance, and its licence and creators are the strings in
// lib/provenance/sources.ts rather than a hopeful "public domain". A Dataset
// node claiming a distribution that 404s is worse than no node.
//
// serializeJsonLd escapes every "<" as the six-character < form. That is
// the scrub the Next JSON-LD guide mandates for an inline script tag, and it
// is why the caller can render a native <script type="application/ld+json">
// rather than next/script: the existing CSP already carries 'unsafe-inline'
// in script-src, and next.config.ts is not edited by this work.

import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/seo/base";
import { metricCopy } from "@/lib/brief/sentence";
import type { Brief } from "@/lib/brief/types";
import type { Provenance } from "@/lib/provenance/types";
import { SOURCES } from "@/lib/provenance/sources";
import type { LinkSets } from "./links";
import { metroByCbsa, metroForCounty, stateByFips, stateByUsps } from "./registry";
import { scopeBriefPath, scopePath, type PlaceScope } from "./scope";
import type { PlaceFacts } from "./facts";

const CONTEXT = "https://schema.org";

/** The identity table is Census-derived, so this is the honest licence for a page with no upstream yet. */
const FALLBACK_LICENSE = SOURCES["census-tigerweb"].license;
const FALLBACK_CREATOR = SOURCES["census-tigerweb"];

/** Metrics worth stating as measured variables, in the order a reader meets them. */
const VARIABLES: Array<{ key: string; unitText: string }> = [
  { key: "home.latest", unitText: "USD" },
  { key: "rent.latest", unitText: "USD" },
  { key: "jobs.emp", unitText: "jobs" },
  { key: "jobs.avgWeeklyWage", unitText: "USD per week" },
];

// ---------------------------------------------------------------- small nodes

function organization(name: string, url: string): Record<string, unknown> {
  return { "@type": "Organization", name, url };
}

function propertyValue(propertyID: string, value: string | number): Record<string, unknown> {
  return { "@type": "PropertyValue", propertyID, value };
}

function countryNode(): Record<string, unknown> {
  return { "@type": "Country", name: "United States", url: absoluteUrl("/state") };
}

function placeId(scope: PlaceScope): string {
  return `${absoluteUrl(scopePath(scope))}#place`;
}

/**
 * county -> metro -> state -> country, nested. The chain is what tells a
 * consumer that /place/48453 and /metro/12420 are the same geography at two
 * scales rather than two unrelated pages with similar numbers.
 */
function containment(scope: PlaceScope): Record<string, unknown> | undefined {
  if (scope.kind === "state") return countryNode();

  if (scope.kind === "metro") {
    const states = scope.ref.states.map((u) => stateByUsps(u)).filter((s) => s !== null);
    const first = states[0];
    if (!first) return countryNode();
    return { "@type": "State", name: first.name, url: absoluteUrl(`/state/${first.usps}`), containedInPlace: countryNode() };
  }

  const state = scope.ref ? stateByFips(scope.ref.stateFips) : stateByFips(scope.id.slice(0, 2));
  const stateNode = state
    ? { "@type": "State", name: state.name, url: absoluteUrl(`/state/${state.usps}`), containedInPlace: countryNode() }
    : countryNode();

  const metro = scope.ref?.cbsa ? metroByCbsa(scope.ref.cbsa) : metroForCounty(scope.id);
  if (!metro) return stateNode;
  return { "@type": "Place", name: metro.name, url: absoluteUrl(`/metro/${metro.cbsa}`), containedInPlace: stateNode };
}

function identifierOf(scope: PlaceScope): Record<string, unknown> {
  if (scope.kind === "county") return propertyValue("FIPS", scope.id);
  if (scope.kind === "metro") return propertyValue("CBSA", scope.id);
  return propertyValue("USPS", scope.id);
}

function placeNode(f: PlaceFacts): Record<string, unknown> {
  const geo = f.lat != null && f.lon != null ? { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lon } : undefined;
  const containedInPlace = containment(f.scope);
  return {
    "@context": CONTEXT,
    "@type": "Place",
    "@id": placeId(f.scope),
    name: f.name,
    alternateName: f.shortName,
    url: absoluteUrl(scopePath(f.scope)),
    identifier: identifierOf(f.scope),
    ...(geo ? { geo } : {}),
    ...(containedInPlace ? { containedInPlace } : {}),
  };
}

// ---------------------------------------------------------------- the dataset

/** Real CSV endpoints, per scope. Every one of these is served today; none is aspirational. */
function distributions(f: PlaceFacts): Array<Record<string, unknown>> {
  const csv = (path: string, name: string) => ({
    "@type": "DataDownload",
    name,
    contentUrl: absoluteUrl(path),
    encodingFormat: "text/csv",
  });

  if (f.scope.kind === "county") {
    return [
      csv(`/api/economy?op=sectors&fips=${f.scope.id}&format=csv`, `Private-sector NAICS mix for ${f.name} (BLS QCEW)`),
      csv("/api/screen?kind=county&format=csv", "Every US county in the screener, with housing and jobs joins"),
    ];
  }
  if (f.scope.kind === "state") {
    return [
      csv(`/api/economy?op=sectors&fips=${f.scope.ref.fips}000&format=csv`, `Private-sector NAICS mix for ${f.name} (BLS QCEW)`),
      csv("/api/screen?kind=state&format=csv", "Every US state in the screener, with housing and jobs joins"),
    ];
  }
  // A metro has no CSV op of its own: /api/economy?op=sectors takes county
  // and state codes only, and the page itself is a county rollup, so the
  // member counties in the county table are the honest distribution.
  const state = stateByUsps(f.scope.ref.states[0] ?? "");
  return [
    csv("/api/screen?kind=county&format=csv", `Every US county in the screener, including the counties of ${f.name}`),
    ...(state ? [csv(`/api/economy?op=sectors&fips=${state.fips}000&format=csv`, `Private-sector NAICS mix for ${state.name} (BLS QCEW)`)] : []),
  ];
}

/** "2026-Q1" covers January to March; a bound has to say which end of it is meant. */
function monthBound(period: string, end: boolean): string | null {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) {
    const first = (Number(q[2]) - 1) * 3 + 1;
    const m = end ? first + 2 : first;
    return `${q[1]}-${String(m).padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}/.test(period)) return period.slice(0, 7);
  return null;
}

/** An ISO 8601 interval over the periods this page actually loaded, or nothing. */
function temporalCoverage(f: PlaceFacts): string | undefined {
  const periods = Object.values(f.periods.current);
  const lows = periods.map((p) => monthBound(p, false)).filter((x) => x !== null);
  const highs = periods.map((p) => monthBound(p, true)).filter((x) => x !== null);
  if (lows.length === 0 || highs.length === 0) return undefined;
  const from = lows.reduce((a, b) => (a < b ? a : b));
  const to = highs.reduce((a, b) => (a > b ? a : b));
  return from === to ? from : `${from}/${to}`;
}

/** The upstreams this page actually read, as Dataset nodes with their own licences. */
function isBasedOn(provenance: Provenance[]): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const p of provenance) {
    const url = p.upstreamUrl ?? p.source.url;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      "@type": "Dataset",
      name: p.source.name,
      url,
      license: p.source.license,
      creator: organization(p.source.publisher, p.source.url),
      ...(p.period ? { temporalCoverage: p.period } : {}),
    });
  }
  return out;
}

/**
 * One licence for the assembled page. The most frequent licence among the
 * sources actually used wins, ties broken alphabetically so the choice is
 * deterministic; the per-source licence stays on each isBasedOn node, so
 * nothing is lost by picking one for the whole.
 */
function licenseOf(provenance: Provenance[]): string {
  const counts = new Map<string, number>();
  for (const p of provenance) counts.set(p.source.license, (counts.get(p.source.license) ?? 0) + 1);
  if (counts.size === 0) return FALLBACK_LICENSE;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}

function creatorsOf(provenance: Provenance[]): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const p of provenance) {
    if (seen.has(p.source.publisher)) continue;
    seen.add(p.source.publisher);
    out.push(organization(p.source.publisher, p.source.url));
  }
  if (out.length === 0) out.push(organization(FALLBACK_CREATOR.publisher, FALLBACK_CREATOR.url));
  return out;
}

function variablesOf(f: PlaceFacts): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const v of VARIABLES) {
    const value = f.values[v.key];
    if (value == null || !Number.isFinite(value)) continue;
    out.push({
      "@type": "PropertyValue",
      name: metricCopy(v.key).noun,
      value,
      unitText: v.unitText,
      ...(f.periods.current[v.key] ? { measurementTechnique: `${metricCopy(v.key).source}, ${f.periods.current[v.key]}` } : {}),
    });
  }
  return out;
}

function datasetNode(f: PlaceFacts): Record<string, unknown> {
  const coverage = temporalCoverage(f);
  const variables = variablesOf(f);
  const based = isBasedOn(f.provenance);
  return {
    "@context": CONTEXT,
    "@type": "Dataset",
    "@id": `${absoluteUrl(scopePath(f.scope))}#dataset`,
    name: `${f.name}: housing, jobs and public finance`,
    description: `Published figures for ${f.name}, each with the source it was read from and the period it describes.`,
    url: absoluteUrl(scopePath(f.scope)),
    license: licenseOf(f.provenance),
    isAccessibleForFree: true,
    creator: creatorsOf(f.provenance),
    publisher: organization(SITE_NAME, SITE_URL),
    spatialCoverage: { "@id": placeId(f.scope) },
    ...(coverage ? { temporalCoverage: coverage } : {}),
    distribution: distributions(f),
    ...(based.length ? { isBasedOn: based } : {}),
    ...(variables.length ? { variableMeasured: variables } : {}),
    dateModified: f.generatedAt,
  };
}

// ---------------------------------------------------------------- public

export function breadcrumbJsonLd(trail: Array<{ name: string; url: string }>): unknown {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: absoluteUrl(step.url),
    })),
  };
}

/** Place, Dataset, BreadcrumbList — in that order, which is the order they matter in. */
export function placeJsonLd(f: PlaceFacts, links: LinkSets): unknown[] {
  return [placeNode(f), datasetNode(f), breadcrumbJsonLd(links.breadcrumb)];
}

/** The place nodes plus the brief itself as a Report, dated by the brief's own timestamps. */
export function briefJsonLd(b: Brief, f: PlaceFacts, links: LinkSets): unknown[] {
  const url = absoluteUrl(scopeBriefPath(f.scope));
  const report: Record<string, unknown> = {
    "@context": CONTEXT,
    "@type": "Report",
    "@id": `${url}#brief`,
    name: b.headline,
    headline: b.headline,
    url,
    // Both dates are the brief's own generatedAt: buildBrief is pure, so a
    // regeneration that changes nothing changes neither date.
    datePublished: b.generatedAt,
    dateModified: b.generatedAt,
    inLanguage: "en-US",
    isAccessibleForFree: true,
    abstract: b.digest.sentence,
    about: { "@id": placeId(f.scope) },
    publisher: organization(SITE_NAME, SITE_URL),
    ...(b.citations.length ? { citation: b.citations } : {}),
  };
  return [...placeJsonLd(f, links), report];
}

/**
 * The nodes as the body of an inline ld+json script. Every "<" becomes the
 * < escape so no string in the data can close the script element.
 */
export function serializeJsonLd(nodes: unknown[]): string {
  return JSON.stringify(nodes).replace(/</g, "\\u003c");
}
