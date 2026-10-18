// The county page: one URL per county, everything the app knows about it, and
// the source of every figure at the bottom.
//
// Three things about this file are deliberate and load-bearing.
//
// First, the page is dynamic, not incrementally static. There are ~3,235
// counties and a cold render of one pays TIGERweb, two multi-tens-of-MB Zillow
// files, a full-US QCEW quarter, FDIC and USAspending — none of which a build
// host without egress can reach, so prerendering would bake "upstream did not
// answer" into the HTML a crawler sees first. Deferring with an empty
// generateStaticParams looked like the answer and is not: it defers *when* a
// path renders, not *how*, and a statically-rendered page may not issue the
// no-store fetches every one of those sources uses. force-dynamic is the shape
// that matches the data. The caching moved a layer down rather than away — see
// the note on the segment config below.
//
// Second, nothing here reads searchParams or headers(). Both are Request-time
// APIs: touching either opts the page out of prerendering entirely, and under a
// force-static segment headers() quietly returns empty values, which is a
// wrong-answer trap rather than an error. The globe route keeps its mobile hint
// from headers(); a document does not need one.
//
// Third, generateMetadata and the body both call the same loader. Next runs
// them concurrently, and every section inside placeFacts goes through cached(),
// whose inflight map collapses the two callers onto one producer — so the title
// and the page cost one pull between them, not two.
//
// With no egress the page still renders: identity, breadcrumb, links, JSON-LD
// and every data section marked "unavailable" with the reason in words. A blank
// section, a missing section or a 500 would each be a failure of the contract.
//
// Places and institutions only. Nothing on this page addresses a parcel, an
// address, an owner, an officer or an insider.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FactTable, { type FactRow } from "@/components/doc/FactTable";
import FindingList from "@/components/doc/FindingList";
import JsonLd from "@/components/doc/JsonLd";
import MarketSectionView from "@/components/doc/MarketSectionView";
import PlaceLinks from "@/components/doc/PlaceLinks";
import ProvenanceFooter from "@/components/doc/ProvenanceFooter";
import Section from "@/components/doc/Section";
import Stat from "@/components/doc/Stat";
import StatGrid from "@/components/doc/StatGrid";
import WaterSectionView from "@/components/doc/WaterSectionView";
import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import { month, num, pct, signedPct, usd } from "@/lib/brief/format";
import type { PlaceFacts, SectionState } from "@/lib/places/facts";
import { placeFacts } from "@/lib/places/facts";
import { placeJsonLd } from "@/lib/places/jsonld";
import { linksFor } from "@/lib/places/links";
import { MANIFEST } from "@/lib/places/registry";
import { parseCountyParam, scopeBriefPath, scopePath, type PlaceScope } from "@/lib/places/scope";
import { canonicalOf, placeSeo } from "@/lib/places/seo";

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
 * ISR regeneration runs inside a serverless function with the same ceiling as
 * any other render, and a cold county render is the most expensive page in the
 * app. Sixty seconds is the budget, not a suggestion.
 */
export const maxDuration = 60;

interface PageProps {
  // Explicit rather than the generated PageProps<'/place/[fips]'> helper:
  // tsconfig includes .next/types, so that helper only exists after a typegen
  // run, and a type that depends on build ordering is a type that breaks CI.
  params: Promise<{ fips: string }>;
}

/** How many findings the page shows before sending the reader to the brief. */
const PREVIEW_FINDINGS = 5;

/** How many NAICS sectors and spending rows a table prints. */
const TABLE_ROWS = 12;

// The layout's openGraph is replaced, not merged, by anything a page sets —
// metadata is merged shallowly and duplicate keys are replaced — so the shared
// card image has to be repeated here or a place page would ship none. Per-place
// og images are out of scope: ImageResponse needs a font, and fetching one at
// build time is exactly the network the build does not have.
const OG_IMAGES = [{ url: "/og.jpg", width: 1200, height: 630, alt: "The Embedding Atlas globe" }];

/**
 * The scope and the facts. notFound() is reached only for a FIPS the offline
 * grammar rejects — placeFacts itself never throws for an upstream failure, so
 * a dead publisher costs a section, never the page.
 */
async function load(raw: string): Promise<{ scope: PlaceScope; facts: PlaceFacts; now: number }> {
  const scope = parseCountyParam(raw);
  if (!scope) notFound();
  const now = Date.now();
  const facts = await placeFacts(scope, { now });
  return { scope, facts, now };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { fips } = await params;
  const { scope, facts } = await load(fips);
  const seo = placeSeo(facts);
  const canonical = canonicalOf(scope, "page");
  const base = scopePath(scope);
  return {
    // absolute: the title was already composed and clipped to what a result
    // list shows; appending the site template would push the fact off the end.
    title: { absolute: seo.title },
    description: seo.description,
    alternates: {
      // syncDeskUrl writes ?mode=desk into the address bar with
      // history.replaceState, so without this every shared link is a second
      // indexable URL for the same county.
      canonical,
      types: {
        "application/rss+xml": `${base}/feed.xml`,
        "application/feed+json": `${base}/feed.json`,
      },
    },
    openGraph: {
      type: "article",
      title: seo.ogTitle,
      description: seo.ogDescription,
      url: canonical,
      images: OG_IMAGES,
    },
    twitter: { card: "summary_large_image", title: seo.ogTitle, description: seo.ogDescription, images: ["/og.jpg"] },
  };
}

// ---------------------------------------------------------------- pieces

/**
 * Which SectionState a report sub-section should show.
 *
 * The loader's state describes the FETCH — it is the only thing that can tell a
 * stale cache hit from a cold failure, so it wins wherever it has something to
 * say. But a MarketReport assembles even when its inputs did not arrive, and
 * its sub-sections then carry loaded:false with their own wording. A fetch that
 * "succeeded" into an empty home-value section must not print a "current" chip
 * over the words "no Zillow home value index for this area", so in exactly that
 * case the section's own boolean is left to speak.
 */
function stateFor(loaded: boolean, s: SectionState): SectionState | undefined {
  return s.status === "fresh" && !loaded ? undefined : s;
}

function periodOf(facts: PlaceFacts, key: string): string | null {
  const p = facts.periods.current[key];
  return p ? (p.length === 7 ? month(`${p}-01`) : p) : null;
}

/** The sector mix, with the location quotient that says what the county does more of than the nation. */
function SectorTable({ facts }: { facts: PlaceFacts }) {
  const sectors = facts.market.report?.jobs.data.sectors ?? [];
  if (sectors.length === 0) return null;
  const rows: FactRow[] = sectors.slice(0, TABLE_ROWS).map((s) => ({
    key: s.code,
    cells: [
      s.title,
      s.suppressed ? "withheld" : num(s.emp),
      s.suppressed ? "" : usd(s.avgWeeklyWage),
      s.suppressed ? "" : num(s.lq, 2),
      s.suppressed ? "" : signedPct(s.yoyEmp),
    ],
  }));
  return (
    <FactTable
      columns={[
        { key: "title", label: "NAICS sector" },
        { key: "emp", label: "Jobs", align: "right" },
        { key: "wage", label: "Avg weekly wage", align: "right" },
        { key: "lq", label: "Location quotient", align: "right" },
        { key: "yoy", label: "Jobs over the year", align: "right" },
      ]}
      rows={rows}
      caption={
        "BLS QCEW, all ownerships, third month of the quarter. A location quotient of 1.00 means this county has the " +
        "national share of its jobs in that sector; 2.00 means twice it. A withheld row is a BLS disclosure code N: the " +
        "cell is absent, not zero."
      }
    />
  );
}

/** The mortgage arithmetic, printed line for line as the estimate computed it. */
function Affordability({ facts }: { facts: PlaceFacts }) {
  const a = facts.market.report?.affordability;
  if (!a) return null;
  const state: SectionState = a.estimate
    ? { status: "fresh", asOf: null, retrievedAt: facts.retrievedAt }
    : { status: "unavailable", asOf: null, retrievedAt: facts.retrievedAt, reason: "There is no home value, mortgage rate or wage figure to put in the formula." };
  return (
    <Section id="affordability" title="What the typical home costs to carry" state={state} basis={a.basis}>
      {a.estimate ? (
        <>
          <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
            Principal and interest of {usd(a.estimate.payment)} a month on {usd(a.estimate.price)} at {pct(a.estimate.ratePct, 2)}, against an
            average weekly wage worth {usd(a.estimate.wageMonthly)} a month: {pct(a.estimate.wageSharePct)} of one job&rsquo;s pay.
          </p>
          <ul className="mt-3 space-y-0.5">
            {a.estimate.formula.map((line, i) => (
              <li key={i} className="font-mono text-[13px] leading-snug text-foreground">
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
            The wage is one covered job&rsquo;s average, not a household&rsquo;s income, so this is the share of a single
            paycheque and not a mortgage underwriting ratio.
          </p>
        </>
      ) : null}
    </Section>
  );
}

/** Deposits, the banks holding them, and the concentration screen with its formula. */
function Finance({ facts }: { facts: PlaceFacts }) {
  const section = facts.finance.section;
  if (!section) return <Section id="banks-federal-dollars" title="Banks and federal dollars" state={facts.finance.state} />;
  const d = section.data.deposits;
  const rows: FactRow[] = (d?.top ?? []).slice(0, TABLE_ROWS).map((b) => ({
    key: String(b.cert),
    cells: [b.name, usd(b.deposits), `${pct(b.sharePct)}`, num(b.branches)],
  }));
  return (
    <MarketSectionView section={section} id="banks-federal-dollars" state={stateFor(section.loaded, facts.finance.state)} retrievedAt={facts.retrievedAt}>
      {rows.length > 0 ? (
        <FactTable
          columns={[
            { key: "bank", label: "Institution" },
            { key: "deposits", label: "Deposits", align: "right" },
            { key: "share", label: "Share", align: "right" },
            { key: "offices", label: "Offices", align: "right" },
          ]}
          rows={rows}
          caption={`FDIC Summary of Deposits, June ${d?.year ?? ""}. These are institution offices, not people: the row is a bank's presence in the county.`}
        />
      ) : null}
      {d?.hhi ? (
        <>
          <p className="mt-3 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
            Deposit concentration is {num(d.hhi.value)} across {num(d.hhi.banks)} banks, which the 1995 Department of Justice
            bank merger screen calls {d.hhi.label}.
          </p>
          <p className="mt-1 font-mono text-[13px] leading-snug text-foreground">{d.hhi.formula}</p>
        </>
      ) : null}
    </MarketSectionView>
  );
}

/** Federal obligations, where they landed, and the per-job estimate with its own formula. */
function Spending({ facts }: { facts: PlaceFacts }) {
  const perJob = facts.finance.section?.data.spending?.perJob ?? null;
  const detail = facts.spending.detail;
  const rows: FactRow[] = (detail?.agencies ?? []).slice(0, TABLE_ROWS).map((r) => ({
    key: r.id ?? r.name,
    cells: [r.name, usd(r.amount)],
  }));
  return (
    <Section
      id="federal-spending"
      title="Federal obligations"
      state={facts.spending.state}
      summary={detail ? `USAspending place-of-performance obligations for FY${detail.fy}, by awarding agency.` : undefined}
      basis={
        "USAspending obligations are recorded where the work is performed, so a prime award performed here is counted here " +
        "even when the recipient is headquartered elsewhere. Recipients are legal entities, never people."
      }
    >
      {rows.length > 0 ? (
        <FactTable
          columns={[
            { key: "agency", label: "Awarding agency" },
            { key: "amount", label: "Obligations", align: "right" },
          ]}
          rows={rows}
          caption={`USAspending, FY${detail?.fy ?? ""}, place of performance in this county.`}
        />
      ) : null}
      {perJob ? (
        <>
          <p className="mt-3 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
            That is {usd(perJob.value)} per covered job, against {num(perJob.jobs)} jobs in the {perJob.jobsPeriod} QCEW quarter.
          </p>
          <p className="mt-1 font-mono text-[13px] leading-snug text-foreground">{perJob.formula}</p>
        </>
      ) : null}
    </Section>
  );
}

/** Public filers with a registered business address in the county. Omitted entirely when there are none. */
function Companies({ facts }: { facts: PlaceFacts }) {
  const section = facts.companies.section;
  if (!section) return null;
  return (
    <MarketSectionView section={section} id="public-companies" state={stateFor(section.loaded, facts.companies.state)} retrievedAt={facts.retrievedAt}>
      <p className="mt-2 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
        {section.data.bundlePulled
          ? `Snapshot pulled ${section.data.bundlePulled}: ${num(section.data.n)} filers, ${num(section.data.withFacts)} with financial facts.`
          : `This is a committed fixture, not a pull: ${num(section.data.n)} filers are named and their financial facts are empty until the snapshot is refreshed. An absent company is not evidence that none is headquartered here.`}
      </p>
    </MarketSectionView>
  );
}

/** The national indicator set, labelled as national in the heading itself. */
function Indicators({ facts }: { facts: PlaceFacts }) {
  const items = facts.indicators.items;
  const rows: FactRow[] = items.map((i) => ({
    key: i.meta.id,
    cells: [
      { text: i.meta.title, sub: `· ${i.meta.unit}` },
      i.evaluation.latest == null ? (i.error ? "unavailable" : "not published") : num(i.evaluation.latest, 2),
      i.evaluation.latestAt ? i.evaluation.latestAt.slice(0, 10) : "",
      signedPct(i.evaluation.changePct),
    ],
  }));
  return (
    <Section
      id="national-context"
      title="National context, not this county"
      state={facts.indicators.state}
      summary="These are United States, single-gauge, single-state and port series. None of them is keyed to this county."
      basis={
        "The indicator registry has no county-keyed series and no geographic selection: every entry is national, a named " +
        "gauge, a single state or a port. They are here as the backdrop the county's own numbers move against, and they " +
        "are never this county's readings."
      }
    >
      {rows.length > 0 ? (
        <FactTable
          columns={[
            { key: "title", label: "Series" },
            { key: "latest", label: "Latest", align: "right" },
            { key: "at", label: "As of", align: "right" },
            { key: "change", label: "Change", align: "right" },
          ]}
          rows={rows}
          caption="The national indicator set, unfiltered by place."
        />
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------- the page

export default async function CountyPage({ params }: PageProps) {
  const { fips } = await params;
  const { scope, facts, now } = await load(fips);

  const links = linksFor(scope);
  const brief = buildBrief(briefInputFromFacts(facts, null), { now, generatedAt: facts.generatedAt });
  const report = facts.market.report;

  return (
    <article>
      <JsonLd nodes={placeJsonLd(facts, links)} />
      <Breadcrumbs trail={links.breadcrumb} />

      <header className="mt-3">
        <h1 className="text-[32px] font-semibold leading-tight text-foreground">{facts.name}</h1>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-muted-foreground">
          Housing, jobs, water, deposits and federal obligations for this county, each figure with the release it came from.
          {facts.lon != null && facts.lat != null
            ? ` Internal point ${facts.lat.toFixed(2)}, ${facts.lon.toFixed(2)}.`
            : " The offline place manifest has no centroid for this county yet, so anything measured from a point is missing rather than guessed."}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed tabular-nums text-muted-foreground">
          Assembled {facts.generatedAt.slice(0, 10)}. <Link className="text-primary underline" href={scopeBriefPath(scope)}>Read the brief</Link>.
        </p>
      </header>

      <StatGrid>
        <Stat
          label="Typical home value"
          display={usd(facts.values["home.latest"])}
          asOf={periodOf(facts, "home.latest")}
          peers={facts.peers["home.latest"]}
          peerFormat={usd}
        />
        <Stat
          label="Home value, one year"
          display={signedPct(facts.values["home.yoyPct"])}
          asOf={periodOf(facts, "home.yoyPct")}
          peers={facts.peers["home.yoyPct"]}
          peerFormat={signedPct}
        />
        <Stat
          label="Typical rent"
          display={usd(facts.values["rent.latest"])}
          asOf={periodOf(facts, "rent.latest")}
          peers={facts.peers["rent.latest"]}
          peerFormat={usd}
        />
        <Stat
          label="Jobs"
          display={num(facts.values["jobs.emp"])}
          asOf={periodOf(facts, "jobs.emp")}
          peers={facts.peers["jobs.emp"]}
          peerFormat={num}
          suppressed={facts.suppressed.includes("jobs.emp")}
        />
        <Stat
          label="Average weekly wage"
          display={usd(facts.values["jobs.avgWeeklyWage"])}
          asOf={periodOf(facts, "jobs.avgWeeklyWage")}
          peers={facts.peers["jobs.avgWeeklyWage"]}
          peerFormat={usd}
          suppressed={facts.suppressed.includes("jobs.avgWeeklyWage")}
        />
        <Stat
          label="Years of wages per home"
          display={num(facts.values["yearsOfWages"], 1)}
          peers={facts.peers["yearsOfWages"]}
          peerFormat={(v) => num(v, 1)}
          basis="Typical home value divided by the average annual wage of one covered job."
        />
      </StatGrid>

      {report ? (
        <>
          <MarketSectionView section={report.home} id="home-values" state={stateFor(report.home.loaded, facts.market.state)} retrievedAt={facts.retrievedAt} peers={facts.peers["home.latest"]} peerFormat={usd} />
          <MarketSectionView section={report.rent} id="rents" state={stateFor(report.rent.loaded, facts.market.state)} retrievedAt={facts.retrievedAt} peers={facts.peers["rent.latest"]} peerFormat={usd} />
          <Affordability facts={facts} />
          <MarketSectionView section={report.jobs} id="jobs" state={stateFor(report.jobs.loaded, facts.market.state)} retrievedAt={facts.retrievedAt} peers={facts.peers["jobs.emp"]} peerFormat={num}>
            <SectorTable facts={facts} />
          </MarketSectionView>
        </>
      ) : (
        <>
          <Section id="home-values" title="Home values" state={facts.market.state} />
          <Section id="rents" title="Rents" state={facts.market.state} />
          <Section id="jobs" title="Jobs and wages" state={facts.market.state} />
        </>
      )}

      {facts.water.report ? (
        <>
          <WaterSectionView section={facts.water.report.drought} id="drought" state={stateFor(facts.water.report.drought.loaded, facts.water.state)} retrievedAt={facts.retrievedAt} />
          <WaterSectionView section={facts.water.report.reservoirs} id="reservoirs" state={stateFor(facts.water.report.reservoirs.loaded, facts.water.state)} retrievedAt={facts.retrievedAt} />
          <WaterSectionView section={facts.water.report.gauges} id="streamflow" state={stateFor(facts.water.report.gauges.loaded, facts.water.state)} retrievedAt={facts.retrievedAt} />
          <WaterSectionView section={facts.water.report.wells} id="groundwater" state={stateFor(facts.water.report.wells.loaded, facts.water.state)} retrievedAt={facts.retrievedAt} />
          <Section
            id="water-stress"
            title="Water stress"
            state={
              facts.water.report.stress.score == null
                ? {
                    status: "unavailable",
                    asOf: null,
                    retrievedAt: facts.retrievedAt,
                    reason: "None of the four stress terms returned a reading, so there is nothing to renormalise over.",
                  }
                : facts.water.state
            }
            summary={`${facts.water.report.stress.label}${facts.water.report.stress.score == null ? "" : ` (${num(facts.water.report.stress.score, 2)})`}`}
            basis={facts.water.report.stress.formula}
          />
        </>
      ) : (
        <Section id="water" title="Water" state={facts.water.state} />
      )}

      <Finance facts={facts} />
      <Spending facts={facts} />
      <Companies facts={facts} />
      <Indicators facts={facts} />

      <Section
        id="brief"
        title="What changed"
        state={{ status: "fresh", asOf: null, retrievedAt: facts.retrievedAt }}
        summary={brief.headline}
        basis="Every finding is produced by a fixed rule table and a fixed sentence for each rule. Nothing here is generated prose."
      >
        <FindingList findings={brief.findings.slice(0, PREVIEW_FINDINGS)} />
        <p className="mt-3 text-[15px] leading-relaxed">
          <Link href={scopeBriefPath(scope)} className="text-primary underline">
            {brief.findings.length > PREVIEW_FINDINGS
              ? `Read all ${num(brief.findings.length)} findings in the full brief`
              : "Read the full brief"}
          </Link>
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
