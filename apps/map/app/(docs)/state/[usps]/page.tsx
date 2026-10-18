// A state as a document.
//
// Two things make this page different from the county page, and both are
// honesty constraints rather than layout choices.
//
// There is no rent row and no price-to-rent row. app/api/screen/route.ts hands
// the state assembler Promise.resolve(null) for the state rent table, so those
// fields are structurally null at this scale — not missing this month, absent
// by construction — and printing an empty row would suggest a number that
// could arrive. The rows are omitted and the omission is stated in words.
//
// There is no water section. lib/water searches discs of 75 and 150 km around
// a point; a 75 km disc around a state's centroid is not a state water report
// and labelling it as one would be a false claim.
//
// The table of the twelve largest counties is the page's other job: it is the
// analyst's reason to visit and the internal-linking engine that keeps every
// county page within three clicks of the root.
//
// Ethics: places and institutions only.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FactTable from "@/components/doc/FactTable";
import FindingList from "@/components/doc/FindingList";
import JsonLd from "@/components/doc/JsonLd";
import MarketSectionView from "@/components/doc/MarketSectionView";
import PlaceLinks from "@/components/doc/PlaceLinks";
import ProvenanceFooter from "@/components/doc/ProvenanceFooter";
import Section from "@/components/doc/Section";
import Stat from "@/components/doc/Stat";
import StatGrid from "@/components/doc/StatGrid";

import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import type { Brief } from "@/lib/brief/types";
import { MISSING, num, pct, usd } from "@/lib/brief/format";
import { placeFacts, type PlaceFacts, type SectionState } from "@/lib/places/facts";
import { placeJsonLd } from "@/lib/places/jsonld";
import { linksFor } from "@/lib/places/links";
import { MANIFEST } from "@/lib/places/registry";
import { canonicalOf, placeSeo } from "@/lib/places/seo";
import { parseStateParam, type PlaceScope } from "@/lib/places/scope";
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

/** ISR regeneration is a serverless render like any other, and a cold state pays TIGERweb plus two Zillow CSVs plus a full-US QCEW quarter. */
export const maxDuration = 60;

type Params = { params: Promise<{ usps: string }> };

function scopeOf(usps: string): PlaceScope {
  // parseStateParam upper-cases, so /state/tx resolves and canonicalises to
  // /state/TX rather than 404ing on a lower-case link.
  const scope = parseStateParam(usps);
  if (!scope) notFound();
  return scope;
}

/**
 * Facts and brief for one state, read once. The clock is read here rather than
 * in the component body: a render must be pure, and generateMetadata and the
 * page body share the one in-flight producer inside cached() either way.
 */
async function load(usps: string): Promise<{ scope: PlaceScope; facts: PlaceFacts; brief: Brief }> {
  const scope = scopeOf(usps);
  const now = Date.now();
  const facts = await placeFacts(scope, { now });
  return { scope, facts, brief: buildBrief(briefInputFromFacts(facts, null), { now, generatedAt: facts.generatedAt }) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { usps } = await params;
  const { scope, facts } = await load(usps);
  const seo = placeSeo(facts);
  const canonical = canonicalOf(scope, "page");
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical,
      types: {
        "application/rss+xml": absoluteUrl(`/state/${scope.id}/feed.xml`),
        "application/feed+json": absoluteUrl(`/state/${scope.id}/feed.json`),
      },
    },
    openGraph: { title: seo.ogTitle, description: seo.ogDescription, url: canonical, type: "article" },
    twitter: { title: seo.ogTitle, description: seo.ogDescription },
  };
}

const COUNTY_COLUMNS = [
  { key: "name", label: "County" },
  { key: "jobs", label: "Jobs", align: "right" as const },
  { key: "fips", label: "FIPS", align: "right" as const },
];

const METRO_COLUMNS = [
  { key: "name", label: "Metropolitan area" },
  { key: "cbsa", label: "CBSA", align: "right" as const },
];

const SECTOR_COLUMNS = [
  { key: "title", label: "Sector" },
  { key: "emp", label: "Jobs", align: "right" as const },
  { key: "wage", label: "Average weekly wage", align: "right" as const },
  { key: "lq", label: "Location quotient", align: "right" as const },
];

function stated(status: SectionState["status"], reason: string, retrievedAt: string, asOf: string | null = null): SectionState {
  return { status, asOf, retrievedAt, ...(status === "fresh" ? {} : { reason }) };
}

/**
 * MarketSection.loaded says the layer was reached, not that it holds a row for
 * this state — Zillow publishes no index for several of them and QCEW can
 * withhold a whole state cell. So the chip is decided by whether the headline
 * number is actually there, and the section's own summary supplies the reason.
 */
/**
 * Trade and the national pulse carry their own `loaded` flag and an empty list
 * is a real answer there ("nothing within the radius"), so the section speaks
 * for itself unless the whole report is stale or missing.
 */
function reportState(facts: PlaceFacts): SectionState | undefined {
  return facts.market.state.status === "fresh" ? undefined : facts.market.state;
}

function marketState(facts: PlaceFacts, present: boolean, asOf: string | null): SectionState {
  if (facts.market.state.status !== "fresh") return facts.market.state;
  return present
    ? { status: "fresh", asOf, retrievedAt: facts.retrievedAt }
    : { status: "unavailable", asOf: null, retrievedAt: facts.retrievedAt, reason: "the publisher answered but has no row for this state in the release this page read" };
}

export default async function StatePage({ params }: Params) {
  const { usps } = await params;
  // generateMetadata made the same call; cached()'s inflight map collapses the
  // two onto one producer.
  const { scope, facts, brief } = await load(usps);
  const links = linksFor(
    scope,
    // Rank the in-state county links by employment, so the eight the block
    // shows are the eight a reader would have looked for.
    { ranked: new Map((facts.members?.counties ?? []).map((c) => [c.id, c.jobs ?? 0])) },
  );

  const report = facts.market.report;
  const members = facts.members;
  const peers = facts.peers;
  const afford = report?.affordability.estimate ?? null;

  return (
    <article>
      <JsonLd nodes={placeJsonLd(facts, links)} />
      <Breadcrumbs trail={links.breadcrumb} />

      <header className="mt-2">
        <h1 className="text-[30px] font-semibold leading-tight text-foreground">{facts.name}</h1>
        <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
          State, USPS <span className="tabular-nums">{scope.id}</span>
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
          label="Typical home value"
          display={usd(facts.values["home.latest"])}
          asOf={facts.periods.current["home.latest"] ?? null}
          peers={peers["home.latest"]}
          peerFormat={usd}
          basis="Zillow Home Value Index, state file: the middle third of the market, smoothed and seasonally adjusted."
        />
        <Stat
          label="Home value, 1-yr"
          display={pct(facts.values["home.yoyPct"])}
          asOf={facts.periods.current["home.yoyPct"] ?? null}
          peers={peers["home.yoyPct"]}
          peerFormat={pct}
          basis="Zillow's own twelve-month change on the state row."
        />
        <Stat
          label="Jobs"
          display={num(facts.values["jobs.emp"])}
          asOf={facts.periods.current["jobs.emp"] ?? null}
          peers={peers["jobs.emp"]}
          peerFormat={num}
          suppressed={facts.suppressed.includes("jobs.emp")}
          basis="BLS QCEW covered employment, third month of the quarter, all ownerships."
        />
        <Stat
          label="Average weekly wage"
          display={usd(facts.values["jobs.avgWeeklyWage"])}
          asOf={facts.periods.current["jobs.avgWeeklyWage"] ?? null}
          peers={peers["jobs.avgWeeklyWage"]}
          peerFormat={usd}
          suppressed={facts.suppressed.includes("jobs.avgWeeklyWage")}
          basis="Total quarterly wages divided by average employment and by thirteen weeks; one covered job, not a household."
        />
        <Stat
          label="Establishments"
          display={num(facts.values["jobs.estabs"])}
          asOf={facts.periods.current["jobs.estabs"] ?? null}
          peers={peers["jobs.estabs"]}
          peerFormat={num}
          basis="BLS QCEW reporting units, all ownerships."
        />
        <Stat
          label="Jobs, over the year"
          display={pct(facts.values["jobs.yoy.emp"])}
          asOf={facts.periods.current["jobs.yoy.emp"] ?? null}
          peers={peers["jobs.yoy.emp"]}
          peerFormat={pct}
          basis="BLS's own published over-the-year change. The newest QCEW file carries no year-earlier level, so this is their figure, not a subtraction of ours."
        />
      </StatGrid>

      {report ? (
        <>
          <MarketSectionView
            section={report.home}
            id="home"
            state={marketState(facts, report.home.data.latest != null, report.home.data.asOf)}
            retrievedAt={facts.retrievedAt}
            asOf={facts.periods.current["home.latest"] ?? null}
            peers={peers["home.latest"]}
            peerFormat={usd}
          />

          <Section
            id="rent"
            title="Rent"
            state={stated(
              "not-applicable",
              "Zillow's rent index is not read at state scale by this app: the state assembler is handed a null rent table, so typical rent and price-to-rent are structurally absent here rather than missing this month. Both are published per county and per metro area, and the county and metro pages print them.",
              facts.retrievedAt,
            )}
            basis="Rather than print an empty row that suggests a number could arrive, the rows are omitted and the reason is stated. The rent figures for this state's counties are on their own pages."
          />

          <MarketSectionView
            section={report.jobs}
            id="jobs"
            state={marketState(facts, report.jobs.data.emp != null, report.jobs.data.period)}
            retrievedAt={facts.retrievedAt}
            asOf={report.jobs.data.period}
            peers={peers["jobs.emp"]}
            peerFormat={num}
          >
            {report.jobs.data.sectors.length > 0 ? (
              <FactTable
                columns={SECTOR_COLUMNS}
                rows={report.jobs.data.sectors.map((s) => ({
                  key: s.code,
                  cells: [
                    s.title,
                    s.suppressed ? "withheld" : num(s.emp),
                    s.suppressed ? "withheld" : usd(s.avgWeeklyWage),
                    s.lq == null ? MISSING : num(s.lq, 2),
                  ],
                }))}
                caption={`NAICS sector mix, BLS QCEW ${report.jobs.data.period ?? MISSING}. A location quotient above 1 means the sector employs a larger share here than nationally. A withheld cell is absent, not zero.`}
              />
            ) : null}
          </MarketSectionView>

          <Section
            id="affordability"
            title="Affordability"
            state={
              afford
                ? stated("fresh", "", facts.retrievedAt)
                : stated("unavailable", report.affordability.basis, facts.retrievedAt)
            }
            summary={
              afford
                ? `A ${num(afford.termYears)}-year mortgage on the typical home at ${pct(afford.ratePct, 2)} costs about ${usd(afford.payment)} a month in principal and interest.`
                : undefined
            }
            basis={report.affordability.basis}
          >
            {afford ? (
              <ul className="mt-3 space-y-1">
                {afford.formula.map((line, i) => (
                  <li key={i} className="max-w-[48rem] font-mono text-[13px] leading-snug text-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          <MarketSectionView section={report.trade} id="trade" state={reportState(facts)} retrievedAt={facts.retrievedAt}>
            <p className="mt-3 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
              These are the gateways near the state&rsquo;s centroid, within the radii named above, not every port and crossing inside the state
              boundary. lib/economy searches a disc around a point; there is no clip-to-boundary path.
            </p>
          </MarketSectionView>
          <MarketSectionView section={report.pulse} id="pulse" state={reportState(facts)} retrievedAt={facts.retrievedAt} />
        </>
      ) : (
        <Section
          id="market"
          title="Housing and jobs"
          state={facts.market.state}
          basis="Zillow's state file and the BLS QCEW state row. Both are read live; neither is bundled."
        />
      )}

      <Section
        id="counties"
        title="Largest counties"
        state={
          members && members.counties.length > 0
            ? stated("fresh", "", facts.retrievedAt, facts.periods.current["jobs.emp"] ?? null)
            : stated("unavailable", facts.market.state.reason ?? "The nationwide county table did not answer, so the counties cannot be ranked by employment.", facts.retrievedAt)
        }
        summary={members && members.counties.length > 0 ? `The ${num(members.counties.length)} counties of ${facts.shortName} with the most covered jobs.` : undefined}
        basis="Ranked by BLS QCEW third-month covered employment from the same nationwide table the screener uses. A county whose cell BLS withheld is absent from the ranking, not last in it."
      >
        {members && members.counties.length > 0 ? (
          <FactTable
            columns={COUNTY_COLUMNS}
            rows={members.counties.map((c) => ({
              key: c.id,
              cells: [{ text: c.name, href: `/place/${c.id}` }, num(c.jobs), c.id],
            }))}
            caption={`The largest counties of ${facts.name} by covered employment.`}
          />
        ) : null}
      </Section>

      <Section
        id="metros"
        title="Metropolitan areas"
        state={
          members && members.metros.length > 0
            ? stated("fresh", "", facts.retrievedAt)
            : stated("unavailable", "The place manifest lists no metropolitan area in this state.", facts.retrievedAt)
        }
        summary={members && members.metros.length > 0 ? `${num(members.metros.length)} metropolitan statistical areas lie wholly or partly in ${facts.shortName}.` : undefined}
        basis="From the bundled place manifest, which derives its metro table offline from the committed BLS OEWS metro index. A metro that spans a state line appears on both states' pages."
      >
        {members && members.metros.length > 0 ? (
          <FactTable
            columns={METRO_COLUMNS}
            rows={members.metros.map((m) => ({ key: m.id, cells: [{ text: m.name, href: `/metro/${m.id}` }, m.id] }))}
            caption={`Metropolitan statistical areas in ${facts.name}.`}
          />
        ) : null}
      </Section>

      <Section
        id="water"
        title="Water"
        state={stated(
          "not-applicable",
          "There is no state water report here. lib/water searches discs of 75 km for gauges and wells and 150 km for reservoirs around a single point; a disc around a state's centroid is not a state, and presenting one as a state figure would be a false claim. The county pages carry the water sections, each labelled with its own radius.",
          facts.retrievedAt,
        )}
        basis="Drought, reservoirs, stream gauges and groundwater wells are reported around a point, with every row's distance printed. That is a county page's section, not a state's."
      />

      <Section
        id="indicators"
        title="National indicator context"
        state={facts.indicators.state}
        summary="None of these series is keyed to this state. They are national, gauge, single-state or port series, shown as context for the numbers above."
        basis="lib/indicators has no geographic selection: every registry entry is a United States, gauge, Texas, port, crossing or world series. Reading these as this state's own readings would be wrong."
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
        basis="Every sentence in the brief is written by a rule table in lib/brief, not generated, and each one can print the arithmetic behind its number."
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
