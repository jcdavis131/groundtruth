// A metropolitan statistical area as a document.
//
// The substantial offline core of this page is the occupation mix. BLS OEWS
// publishes its occupation tables per CBSA and lib/economy/oews.ts holds them
// as committed JSON, so the top 30 detailed occupations and all 22 SOC major
// groups render in full with no egress at all. That is why the page is worth
// serving even when every live upstream is unreachable.
//
// Everything that does need the network says so in words. Zillow's metro files
// are keyed by RegionID and the manifest may not have resolved one, in which
// case the housing section reads "unavailable" with that reason rather than
// guessing a row by name. And the employment figure is an explicit county
// rollup that prints its own arithmetic and NAMES the counties it could not
// count instead of treating them as zero. BLS does publish a metro total
// (agglvl 40, which qcewLatest keeps), but its boundaries follow each year's
// delineation, so the page sums the member counties instead.
//
// Ethics: places and institutions only. Nothing here addresses a parcel, an
// address, an owner, an officer or an insider.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FactTable, { type FactRow } from "@/components/doc/FactTable";
import FindingList from "@/components/doc/FindingList";
import JsonLd from "@/components/doc/JsonLd";
import PlaceLinks from "@/components/doc/PlaceLinks";
import ProvenanceFooter from "@/components/doc/ProvenanceFooter";
import Section from "@/components/doc/Section";
import Sparkline from "@/components/doc/Sparkline";
import Stat from "@/components/doc/Stat";
import StatGrid from "@/components/doc/StatGrid";

import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import type { Brief } from "@/lib/brief/types";
import { MISSING, month, num, pct, usd } from "@/lib/brief/format";
import { placeFacts, type PlaceFacts, type SectionState } from "@/lib/places/facts";
import { placeJsonLd } from "@/lib/places/jsonld";
import { linksFor } from "@/lib/places/links";
import { PEER_MIN_N } from "@/lib/places/percentiles";
import { MANIFEST, allCbsa, countiesInMetro } from "@/lib/places/registry";
import { canonicalOf, placeSeo } from "@/lib/places/seo";
import { parseMetroParam, type PlaceScope } from "@/lib/places/scope";
import { absoluteUrl } from "@/lib/seo/base";

/**
 * Rendered per request. Every figure on this page comes through the fetchers in
 * lib/economy, lib/water and lib/finance, which all pass `cache: "no-store"` —
 * and a no-store fetch inside a static render is a hard error, not a fallback
 * ("Page changed from static to dynamic at runtime"). ISR was the wrong shape
 * here: `generateStaticParams` returning [] defers a path to request time but
 * still renders it *statically*, so the whole surface 500ed. Caching is not
 * lost, it just lives a layer down — lib/server/cache.ts memoises each upstream
 * for its own TTL (24 h for TIGER geometry, 1 h for the screener cohorts), so a
 * warm process serves these from memory without a second pull.
 */
export const dynamic = "force-dynamic";

/**
 * ISR regeneration runs inside a serverless function with the same timeout as
 * any other render, and a cold metro pays Zillow's two metro CSVs plus a
 * full-US QCEW quarter.
 */
export const maxDuration = 60;

type Params = { params: Promise<{ cbsa: string }> };

function scopeOf(cbsa: string): PlaceScope {
  const scope = parseMetroParam(cbsa);
  // Metros ship complete in the offline manifest, so an unknown CBSA is a real
  // 404 rather than a gap the pull has not filled.
  if (!scope) notFound();
  return scope;
}

/**
 * Facts and brief for one metro, read once. The clock is read here rather than
 * in the component body: a render must be pure, and generateMetadata and the
 * page body share the one in-flight producer inside cached() either way.
 */
async function load(cbsa: string): Promise<{ scope: PlaceScope; facts: PlaceFacts; brief: Brief }> {
  const scope = scopeOf(cbsa);
  const now = Date.now();
  const facts = await placeFacts(scope, { now });
  return { scope, facts, brief: buildBrief(briefInputFromFacts(facts, null), { now, generatedAt: facts.generatedAt }) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { cbsa } = await params;
  const { scope, facts } = await load(cbsa);
  const seo = placeSeo(facts);
  const canonical = canonicalOf(scope, "page");
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical,
      types: {
        "application/rss+xml": absoluteUrl(`/metro/${cbsa}/feed.xml`),
        "application/feed+json": absoluteUrl(`/metro/${cbsa}/feed.json`),
      },
    },
    openGraph: { title: seo.ogTitle, description: seo.ogDescription, url: canonical, type: "article" },
    twitter: { title: seo.ogTitle, description: seo.ogDescription },
  };
}

// ---------------------------------------------------------------- table shapes

const OCCUPATION_COLUMNS = [
  { key: "soc", label: "SOC" },
  { key: "title", label: "Occupation" },
  { key: "emp", label: "Jobs", align: "right" as const },
  { key: "wage", label: "Mean annual wage", align: "right" as const },
  { key: "lq", label: "Location quotient", align: "right" as const },
];

function occupationRows(rows: Array<{ c: string; t: string; e: number; w: number | null; lq: number | null }>): FactRow[] {
  return rows.map((o) => ({
    key: o.c,
    cells: [o.c, o.t, num(o.e), usd(o.w), o.lq == null ? MISSING : num(o.lq, 2)],
  }));
}

const MEMBER_COLUMNS = [
  { key: "name", label: "County" },
  { key: "fips", label: "FIPS", align: "right" as const },
];

/** The state a section gets when the loader produced nothing and the reason is structural. */
function stated(status: SectionState["status"], reason: string, retrievedAt: string, asOf: string | null = null): SectionState {
  return { status, asOf, retrievedAt, ...(status === "fresh" ? {} : { reason }) };
}

function rollupState(f: PlaceFacts): SectionState {
  const r = f.rollup;
  if (!r) return stated("not-applicable", "Employment is rolled up from member counties; this scope has none.", f.retrievedAt);
  if (r.jobs == null) {
    return stated(
      "unavailable",
      r.counties === 0 && countiesInMetro(f.scope.id).length === 0
        ? "The offline place manifest does not list this metro's member counties yet, so there is nothing to sum. Running scripts/places-data.mjs on a host with egress fills it in."
        : "BLS QCEW did not answer, so no member county could be summed.",
      f.retrievedAt,
    );
  }
  return stated("fresh", "", f.retrievedAt, f.periods.current["jobs.emp"] ?? null);
}

// ---------------------------------------------------------------- the page

export default async function MetroPage({ params }: Params) {
  const { cbsa } = await params;
  // The same call generateMetadata made: cached()'s inflight map collapses the
  // two onto one producer, so the page costs one pull rather than two.
  const { scope, facts, brief } = await load(cbsa);
  const links = linksFor(scope);
  const nodes = placeJsonLd(facts, links);

  const jobs = facts.occupations.jobs;
  const housing = facts.housing;
  const rollup = facts.rollup;
  const members = countiesInMetro(scope.id);
  const peers = facts.peers;

  return (
    <article>
      <JsonLd nodes={nodes} />
      <Breadcrumbs trail={links.breadcrumb} />

      <header className="mt-2">
        <h1 className="text-[30px] font-semibold leading-tight text-foreground">{facts.name}</h1>
        <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
          Metropolitan statistical area, CBSA <span className="tabular-nums">{scope.id}</span>
          {facts.lat != null && facts.lon != null ? (
            <>
              {" · "}
              <span className="tabular-nums">
                {num(facts.lat, 2)}, {num(facts.lon, 2)}
              </span>
            </>
          ) : null}
        </p>
        <p className="mt-3 max-w-[48rem] text-[15px] leading-relaxed text-foreground">{brief.digest.sentence}</p>
      </header>

      <StatGrid>
        <Stat
          label="Jobs, OEWS"
          display={num(facts.values.emp)}
          asOf={facts.occupations.asOf}
          peers={peers.emp}
          peerFormat={num}
          basis="Total employment in the BLS OEWS occupational tables for this metro area. It is an occupational survey total, not the QCEW payroll count below."
        />
        <Stat
          label="Jobs, county rollup"
          display={num(rollup?.jobs ?? null)}
          asOf={facts.periods.current["jobs.emp"] ?? null}
          basis="An estimate: the sum of the member counties BLS publishes, not BLS's own metro row, whose boundaries follow each year's delineation. The arithmetic is printed below."
        />
        <Stat
          label="Typical home value"
          display={usd(facts.values["home.latest"])}
          asOf={facts.periods.current["home.latest"] ?? null}
          peers={peers["home.latest"]}
          peerFormat={usd}
          basis="Zillow Home Value Index, metro file, smoothed and seasonally adjusted."
        />
        <Stat
          label="Typical rent"
          display={usd(facts.values["rent.latest"])}
          asOf={facts.periods.current["rent.latest"] ?? null}
          peers={peers["rent.latest"]}
          peerFormat={usd}
          basis="Zillow Observed Rent Index, metro file."
        />
        <Stat
          label="Price-to-rent"
          display={num(facts.values.priceToRent, 1)}
          unit="years of rent"
          asOf={facts.periods.current.priceToRent ?? null}
          peers={peers.priceToRent}
          peerFormat={(v) => num(v, 1)}
          basis="typical home value / (typical rent × 12); Zillow ZHVI over ZORI, same month."
        />
        <Stat
          label="Home value, 1-yr"
          display={pct(facts.values["home.yoyPct"])}
          asOf={facts.periods.current["home.yoyPct"] ?? null}
          peers={peers["home.yoyPct"]}
          peerFormat={pct}
          basis="Zillow's own twelve-month change on the metro row."
        />
      </StatGrid>

      <Section
        id="occupations"
        title="Occupation mix"
        state={facts.occupations.state}
        summary={
          jobs
            ? `The ${num(jobs.top.length)} largest detailed occupations and all ${num(jobs.major.length)} SOC major groups in ${jobs.name}, from the bundled BLS OEWS release.`
            : undefined
        }
        basis="BLS Occupational Employment and Wage Statistics, metropolitan area tables, committed to this repository rather than fetched. A location quotient above 1 means the occupation is more concentrated here than in the United States as a whole; wages are means, not medians, and BLS suppresses a wage where its sample is too thin."
      >
        {jobs ? (
          <>
            <FactTable
              columns={OCCUPATION_COLUMNS}
              rows={occupationRows(jobs.top)}
              caption={`Top ${num(jobs.top.length)} detailed occupations by employment, ${jobs.name}, OEWS ${facts.occupations.asOf}.`}
            />
            <FactTable
              columns={OCCUPATION_COLUMNS}
              rows={occupationRows(jobs.major)}
              caption={`All ${num(jobs.major.length)} SOC major groups, ${jobs.name}, OEWS ${facts.occupations.asOf}.`}
            />
          </>
        ) : null}
      </Section>

      <Section
        id="housing"
        title="Housing"
        state={housing?.state ?? stated("not-applicable", "Zillow's metro files describe a metro area; this scope is not one.", facts.retrievedAt)}
        summary={
          housing?.home
            ? `The typical home in the ${facts.shortName} metro was worth ${usd(housing.home.latest)} in ${month(housing.home.asOf)}.`
            : undefined
        }
        basis={
          housing?.matchedBy === "short"
            ? "Zillow's metro row was matched to this CBSA BY NAME, not by a shared code: Zillow titles metros short (\"Austin, TX\") where the Census titles them long. Both series are Zillow's own smoothed indices of the middle third of the market, not sale prices."
            : housing?.matchedBy === "counties"
              ? "Zillow's metro row was matched to this CBSA BY ITS COUNTIES, not by name or code: Zillow still titles the area by an older delineation, and its county file puts exactly this metro's counties under that row. Both series are Zillow's own smoothed indices of the middle third of the market, not sale prices."
              : "Zillow Home Value Index and Observed Rent Index, metro files, joined by the RegionID recorded in the place manifest. Both are smoothed indices of the middle third of the market, not sale prices."
        }
      >
        {housing?.home ? (
          <div className="mt-3">
            <Sparkline
              points={housing.home.monthly.map(([, v]) => v)}
              label={`Typical home value in the ${facts.shortName} metro over the last ${num(housing.home.monthly.length)} months, ending ${month(housing.home.asOf)}.`}
            />
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
              {num(housing.home.monthly.length)} months to {month(housing.home.asOf)}. Rent:{" "}
              {housing.rent ? `${usd(housing.rent.latest)} in ${month(housing.rent.asOf)}` : MISSING}.
            </p>
          </div>
        ) : null}
      </Section>

      <Section
        id="jobs"
        title="Employment, rolled up from member counties"
        state={rollupState(facts)}
        summary={
          rollup?.jobs != null
            ? `About ${num(rollup.jobs)} covered jobs across the ${num(rollup.counties)} member ${rollup.counties === 1 ? "county" : "counties"} BLS published.`
            : undefined
        }
        basis="There are no QCEW metro employment totals here, and that is a property of the data rather than an omission: BLS does publish MSA area codes (C####), but lib/economy's QCEW reader handles only county (SSCCC), state (SS000) and national (US000) rows at aggregation levels 74, 54 and 14, and the /api/economy route regex rejects anything else. So this figure is a sum of member counties, labelled an estimate, with every county it could not count named."
      >
        {rollup ? (
          <ul className="mt-3 space-y-1">
            {rollup.formula.map((line, i) => (
              <li key={i} className="max-w-[48rem] font-mono text-[13px] leading-snug text-foreground">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {members.length > 0 ? (
          <FactTable
            columns={MEMBER_COLUMNS}
            rows={members.map((c) => ({ key: c.geoid, cells: [{ text: `${c.name}, ${c.stusab}`, href: `/place/${c.geoid}` }, c.geoid] }))}
            caption={`The ${num(members.length)} counties the place manifest assigns to CBSA ${scope.id}.`}
          />
        ) : null}
        {members.length < PEER_MIN_N ? (
          <p className="mt-3 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
            The place manifest names {num(members.length)} member {members.length === 1 ? "county" : "counties"} for this metro, fewer than the{" "}
            {num(PEER_MIN_N)} a cohort needs before a percentile means anything, so no within-metro position is offered for its counties. The
            positions above are against the other {num(allCbsa().length - 1)} metropolitan areas, which is a cohort that does not depend on the county pull.
          </p>
        ) : null}
      </Section>

      <Section
        id="indicators"
        title="National indicator context"
        state={facts.indicators.state}
        summary="None of these series is keyed to this metro area. They are national, gauge, single-state or port series, shown as context for the numbers above."
        basis="lib/indicators has no geographic selection: every registry entry is a United States, gauge, Texas, port, crossing or world series, and no entry is metro-keyed. Reading these as this metro's own readings would be wrong."
      >
        {facts.indicators.items.length > 0 ? (
          <FactTable
            columns={[
              { key: "title", label: "Indicator" },
              { key: "latest", label: "Latest", align: "right" as const },
              { key: "unit", label: "Unit" },
              { key: "status", label: "Status" },
            ]}
            rows={facts.indicators.items.map((it) => ({
              key: it.meta.id,
              cells: [it.meta.title, num(it.evaluation.latest, 2), it.meta.unit, it.evaluation.status],
            }))}
            caption="The national indicator set, filtered by lens only."
          />
        ) : null}
      </Section>

      <Section
        id="brief"
        title="What changed"
        state={stated(brief.findings.length > 0 ? "fresh" : "not-applicable", "Nothing crossed a line in this period.", facts.retrievedAt)}
        summary={brief.headline}
        basis="Metro briefs are thinner by construction: with no QCEW metro path, their findings come from Zillow's metro home value and rent rows, the county rollup, and nearby crossings and ports."
      >
        <FindingList findings={brief.findings.slice(0, 5)} />
        <p className="mt-3 text-[15px] leading-relaxed">
          <a href={links.brief.href} className="text-primary underline">
            The full {facts.shortName} brief
          </a>
          , with the arithmetic behind every sentence.
        </p>
      </Section>

      <PlaceLinks links={links} />

      <ProvenanceFooter
        provenance={facts.provenance}
        citations={facts.citations}
        caveats={facts.caveats}
        generatedAt={facts.generatedAt}
        manifestPulled={MANIFEST.pulled}
      />
    </article>
  );
}
