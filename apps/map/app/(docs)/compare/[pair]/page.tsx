// Two places, the same rows, side by side.
//
// This page is cheap on purpose. It reads nothing but the cohort percentile
// tables, which are two Map lookups into a table the county and state pages
// have already paid for and cached — so a compare costs zero additional
// upstream calls. A full-dossier compare would need two geometry queries, two
// water discs that cannot be shared, two bank lookups and two spending calls,
// which is roughly double a place page with none of the national sharing. The
// basis line says so, and the page links to both full documents rather than
// trying to be them.
//
// It is ALWAYS noindex, follow. There is a compare URL for every ordered pair
// of places — on the order of ten million addresses — and an indexable one is
// a crawl trap that would dilute the ~3,680 pages that matter. follow keeps
// the link equity flowing inward to the two documents. No compare URL appears
// in any sitemap, and app/robots.ts disallows the prefix outright.
//
// The polarity table below is deliberately local. lib/screener/fields.ts is
// byte-diffed against docs/SCREENER.md by lib/screener/docs.test.ts, so a new
// field property there would mean regenerating a committed document; and
// "which direction is better" is a reader-facing editorial judgement, not a
// property of the field. Price-to-rent and years-of-wages are the reason it
// exists: both are ratios where the larger number is the worse outcome, and a
// bare "+2.4" beside them would be read as an improvement.
//
// Ethics: places only.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FactTable from "@/components/doc/FactTable";
import Section from "@/components/doc/Section";

import { MISSING, countOf, num, ordinal, pct, usd } from "@/lib/brief/format";
import type { SectionState } from "@/lib/places/facts";
import { COUNTRY_LABEL, COUNTRY_URL } from "@/lib/places/links";
import { peerStats, percentileBasisNote, type PeerStat } from "@/lib/places/percentiles";
import { parseComparePair, scopeName, scopePath, scopeShortName, type PlaceScope } from "@/lib/places/scope";

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

/** ISR regeneration is a serverless render like any other, and a cold cohort table pays two Zillow files and a full-US QCEW quarter. */
export const maxDuration = 60;

type Params = { params: Promise<{ pair: string }> };

type Polarity = "higher" | "lower" | "neither";

/** What the sign of a difference means for a reader. Local by design; see the module note. */
const POLARITY_NOTE: Record<Polarity, string> = {
  higher: "higher is the stronger figure",
  lower: "lower is the stronger figure",
  neither: "neither direction is better",
};

type Formatter = (v: number | null | undefined) => string;

interface CompareRow {
  metric: string;
  label: string;
  /** How the level prints. */
  value: Formatter;
  /** How the difference prints, always carrying its sign. */
  delta: (v: number) => string;
  polarity: Polarity;
}

const sign = (v: number) => (v > 0 ? "+" : "");
const deltaUsd = (v: number) => `${sign(v)}${usd(v)}`;
const deltaNum = (digits: number) => (v: number) => `${sign(v)}${num(v, digits)}`;
/** A difference between two percentages is percentage points, not a percentage. */
const deltaPoints = (v: number) => `${sign(v)}${num(v, 1)} points`;

const ROWS: CompareRow[] = [
  { metric: "home.latest", label: "Typical home value", value: usd, delta: deltaUsd, polarity: "neither" },
  { metric: "home.yoyPct", label: "Home value, 1-yr", value: (v) => pct(v), delta: deltaPoints, polarity: "neither" },
  { metric: "home.y5Pct", label: "Home value, 5-yr", value: (v) => pct(v), delta: deltaPoints, polarity: "neither" },
  { metric: "rent.latest", label: "Typical rent", value: usd, delta: deltaUsd, polarity: "neither" },
  { metric: "rent.yoyPct", label: "Rent, 1-yr", value: (v) => pct(v), delta: deltaPoints, polarity: "neither" },
  { metric: "priceToRent", label: "Price-to-rent", value: (v) => num(v, 2), delta: deltaNum(2), polarity: "lower" },
  { metric: "yearsOfWages", label: "Years of wages to buy", value: (v) => num(v, 1), delta: deltaNum(1), polarity: "lower" },
  { metric: "jobs.emp", label: "Jobs", value: (v) => num(v), delta: deltaNum(0), polarity: "higher" },
  { metric: "jobs.estabs", label: "Establishments", value: (v) => num(v), delta: deltaNum(0), polarity: "higher" },
  { metric: "jobs.avgWeeklyWage", label: "Average weekly wage", value: usd, delta: deltaUsd, polarity: "higher" },
  { metric: "jobs.yoy.emp", label: "Jobs, over the year", value: (v) => pct(v), delta: deltaPoints, polarity: "higher" },
  { metric: "emp", label: "Surveyed jobs", value: (v) => num(v), delta: deltaNum(0), polarity: "higher" },
];

const COLUMNS = (left: string, right: string) => [
  { key: "metric", label: "Measure" },
  { key: "left", label: left, align: "right" as const },
  { key: "right", label: right, align: "right" as const },
  { key: "delta", label: "Difference", align: "right" as const },
];

function pairPath(pair: string): string {
  return `/compare/${pair}`;
}

function scopesOf(pair: string): [PlaceScope, PlaceScope] {
  // parseComparePair rejects a bad side and a self-pair alike: comparing a
  // place with itself is a page of zeroes and a duplicate of its own document.
  const parsed = parseComparePair(pair);
  if (!parsed) notFound();
  return parsed;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { pair } = await params;
  const [left, right] = scopesOf(pair);
  const title = `${scopeName(left)} vs ${scopeName(right)}`;
  const description = `${scopeName(left)} and ${scopeName(right)} side by side: home values, rent, jobs and wages, each with its position among its own peers.`;
  return {
    title,
    description,
    // Never a canonical target, never in a sitemap, always followable so the
    // two documents it links keep the equity.
    robots: { index: false, follow: true },
    openGraph: { title, description, url: pairPath(pair), type: "article" },
    twitter: { title, description },
  };
}

/** One side's cell: the level, with its position among its own peers underneath. */
function cell(row: CompareRow, peer: PeerStat | undefined) {
  if (!peer) return MISSING;
  const text = row.value(peer.value);
  if (peer.pct == null || peer.rank == null) {
    return { text, sub: peer.reason ? `(${peer.reason})` : undefined };
  }
  return { text, sub: `${ordinal(peer.pct)} pct, ${countOf(peer.rank, peer.n)}` };
}

function first(peers: Record<string, PeerStat[]>, metric: string): PeerStat | undefined {
  return peers[metric]?.[0];
}

export default async function ComparePage({ params }: Params) {
  const { pair } = await params;
  const [left, right] = scopesOf(pair);

  // One national cohort per side, each of the side's own kind — a county is
  // ranked among counties and a metro among metro areas. The two percentile
  // columns of a mixed pair are therefore NOT comparable to each other, which
  // the basis line says out loud.
  const [leftPeers, rightPeers] = await Promise.all([
    peerStats(left.kind, left.id, [{ kind: "national", of: left.kind }]),
    peerStats(right.kind, right.id, [{ kind: "national", of: right.kind }]),
  ]);

  const rows = ROWS.filter((r) => r.metric in leftPeers && r.metric in rightPeers);

  const leftLabel = scopeShortName(left);
  const rightLabel = scopeShortName(right);

  const anyRanked = rows.some((r) => first(leftPeers, r.metric)?.pct != null || first(rightPeers, r.metric)?.pct != null);

  const state: SectionState = anyRanked
    ? { status: "fresh", asOf: null, retrievedAt: "" }
    : {
        status: "unavailable",
        asOf: null,
        retrievedAt: "",
        reason:
          first(leftPeers, rows[0]?.metric ?? "")?.reason ??
          "the nationwide tables these rows are ranked against did not answer, so both sides print what they have without a position",
      };

  const mixed = left.kind !== right.kind;

  return (
    <article>
      <Breadcrumbs
        trail={[
          { name: COUNTRY_LABEL, url: COUNTRY_URL },
          { name: `${leftLabel} vs ${rightLabel}`, url: pairPath(pair) },
        ]}
      />

      <header className="mt-2">
        <h1 className="text-[30px] font-semibold leading-tight text-foreground">
          {scopeName(left)} vs {scopeName(right)}
        </h1>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-muted-foreground">
          The headline rows of both places, with each side&rsquo;s position among its own peers and the
          difference between them. This is a comparison, not a dossier: the water, banking, spending and
          occupation sections live on the two full documents.
        </p>
      </header>

      <Section
        id="side-by-side"
        title="Side by side"
        state={state}
        summary={`${num(rows.length)} measures both places publish, each read from the same nationwide table the screener uses.`}
        basis={`This page adds no upstream call of its own: it reads the cached cohort tables and nothing else, which is why it can exist for every pair without a crawl budget. A row neither place published is omitted rather than printed empty.${mixed ? " The two places are of different kinds, so each percentile is a position within its OWN population — a county among counties and a metro area among metro areas — and the two percentile figures must not be read against each other." : ""} ${percentileBasisNote()}`}
      >
        <FactTable
          columns={COLUMNS(leftLabel, rightLabel)}
          rows={rows.map((r) => {
            const l = first(leftPeers, r.metric);
            const rr = first(rightPeers, r.metric);
            const diff = l?.value != null && rr?.value != null ? l.value - rr.value : null;
            return {
              key: r.metric,
              cells: [
                { text: r.label, sub: diff == null ? undefined : POLARITY_NOTE[r.polarity] },
                cell(r, l),
                cell(r, rr),
                diff == null ? MISSING : r.delta(diff),
              ],
            };
          })}
          caption={`${leftLabel} minus ${rightLabel}. A difference between two percentages is stated in percentage points.`}
        />
      </Section>

      <Section
        id="full"
        title="The full documents"
        state={{ status: "fresh", asOf: null, retrievedAt: "" }}
        summary="Everything this page leaves out is on the two place pages, each with its own sources, periods and arithmetic."
        basis="A compare page is intentionally thin. It is noindex and follow: the links below are the point of it."
      >
        <ul className="mt-3 space-y-1 text-[15px] leading-relaxed">
          <li>
            <Link href={scopePath(left)} className="text-primary underline">
              {scopeName(left)}
            </Link>
          </li>
          <li>
            <Link href={scopePath(right)} className="text-primary underline">
              {scopeName(right)}
            </Link>
          </li>
        </ul>
      </Section>
    </article>
  );
}
