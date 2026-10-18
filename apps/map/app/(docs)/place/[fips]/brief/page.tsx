// The county brief: what changed, in sentences a reader can check, with the
// arithmetic behind each one a click away.
//
// This is the retention page. The county page carries the query intent ("San
// Antonio rent trend") and is the acquisition channel; the brief is what
// somebody opens every Monday, and it is reached by an in-content link from the
// page rather than by being listed in a sitemap. Briefs are never in any
// sitemap for exactly that reason: 3,680 places of near-identical structure is
// the doorway pattern, and listing them would cost the pages that matter.
//
// A brief with no findings is still served, still linked and still followed —
// "nothing crossed a line this period" is a true and useful thing to tell a
// subscriber — but it is not offered for indexing, because a crawler reading it
// sees a thin page. briefSeo already decides that; this file only honours it.
//
// One hour rather than the page's six: the brief is the thing people refresh.
//
// Nothing here reads searchParams or headers(). Both are Request-time APIs and
// touching either opts the route out of prerendering; the lens lives in the URL
// path, at brief/[lens], precisely so this page never needs a query string.

import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FindingList from "@/components/doc/FindingList";
import JsonLd from "@/components/doc/JsonLd";
import PlaceLinks from "@/components/doc/PlaceLinks";
import ProvenanceFooter from "@/components/doc/ProvenanceFooter";
import Section from "@/components/doc/Section";
import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import type { Brief } from "@/lib/brief/types";
import { num } from "@/lib/brief/format";
import { notFound } from "next/navigation";
import type { PlaceFacts } from "@/lib/places/facts";
import { placeFacts } from "@/lib/places/facts";
import { briefJsonLd } from "@/lib/places/jsonld";
import { linksFor } from "@/lib/places/links";
import { MANIFEST } from "@/lib/places/registry";
import { parseCountyParam, scopePath, type PlaceScope } from "@/lib/places/scope";
import { briefSeo, canonicalOf } from "@/lib/places/seo";
import { PERSONAS } from "@/lib/personas/registry";

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

/** ISR regeneration is a serverless render and pays the same cold cost the county page does. */
export const maxDuration = 60;

interface PageProps {
  params: Promise<{ fips: string }>;
}

// Page metadata replaces the layout's openGraph rather than merging into it, so
// the shared card image is repeated here. Per-place og images are out of scope.
const OG_IMAGES = [{ url: "/og.jpg", width: 1200, height: 630, alt: "The Embedding Atlas globe" }];

/**
 * Facts and brief in one call. buildBrief is pure and takes both timestamps
 * from the facts, so the metadata pass and the body pass produce the same
 * brief — the same sentences, the same finding ids — without coordinating.
 */
async function load(raw: string): Promise<{ scope: PlaceScope; facts: PlaceFacts; brief: Brief }> {
  const scope = parseCountyParam(raw);
  if (!scope) notFound();
  const now = Date.now();
  const facts = await placeFacts(scope, { now });
  const brief = buildBrief(briefInputFromFacts(facts, null), { now, generatedAt: facts.generatedAt });
  return { scope, facts, brief };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { fips } = await params;
  const { scope, facts, brief } = await load(fips);
  const seo = briefSeo(brief, facts);
  const canonical = canonicalOf(scope, "brief");
  const base = scopePath(scope);
  return {
    title: { absolute: seo.title },
    description: seo.description,
    // index is false exactly when the brief found nothing. Followed either
    // way: the links out of a quiet brief are still the link graph.
    robots: { index: seo.index, follow: true },
    alternates: {
      canonical,
      types: {
        "application/rss+xml": `${base}/feed.xml`,
        "application/feed+json": `${base}/feed.json`,
      },
    },
    openGraph: { type: "article", title: seo.ogTitle, description: seo.ogDescription, url: canonical, images: OG_IMAGES },
    twitter: { card: "summary_large_image", title: seo.ogTitle, description: seo.ogDescription, images: ["/og.jpg"] },
  };
}

export default async function CountyBriefPage({ params }: PageProps) {
  const { fips } = await params;
  const { scope, facts, brief } = await load(fips);
  const links = linksFor(scope);
  const base = scopePath(scope);

  return (
    <article>
      <JsonLd nodes={briefJsonLd(brief, facts, links)} />
      <Breadcrumbs trail={[...links.breadcrumb, { name: "Brief", url: `${base}/brief` }]} />

      <header className="mt-3">
        <h1 className="text-[32px] font-semibold leading-tight text-foreground">{brief.headline}</h1>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">{brief.digest.sentence}</p>
        <p className="mt-2 text-[13px] leading-relaxed tabular-nums text-muted-foreground">
          Rules version {brief.rulesVersion}. Assembled {brief.generatedAt.slice(0, 10)}.{" "}
          <Link href={base} className="text-primary underline">
            Back to {facts.name}
          </Link>
          .
        </p>
      </header>

      <Section
        id="findings"
        title={brief.findings.length === 1 ? "One finding" : `${num(brief.findings.length)} findings`}
        state={{ status: "fresh", asOf: null, retrievedAt: facts.retrievedAt }}
        basis={
          "Findings come from a fixed rule table and a fixed sentence per rule. There is no model in this path: the " +
          "numbers are detected, ordered and worded by code, and every one of them prints the operation that produced it."
        }
      >
        <FindingList findings={brief.findings} />
      </Section>

      {brief.nextRelease ? (
        <Section
          id="next-release"
          title="Next release"
          state={{ status: "fresh", asOf: null, retrievedAt: facts.retrievedAt }}
          summary={`${brief.nextRelease.title}, expected between ${brief.nextRelease.earliest} and ${brief.nextRelease.latest}.`}
          basis={
            brief.nextRelease.precision === "official"
              ? "The window comes from the publisher's own release calendar."
              : "The window is approximate: the publisher has not posted a date for this release, so it is inferred from the cadence of previous ones."
          }
        />
      ) : null}

      <Section
        id="lenses"
        title="The same brief, narrowed"
        state={{ status: "fresh", asOf: null, retrievedAt: facts.retrievedAt }}
        summary="A lens keeps the findings whose subject matches one reader's interest and hides the rest. Every lens brief points its canonical here."
      >
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {PERSONAS.map((p) => (
            <li key={p.id} className="text-[14px] leading-snug">
              <Link href={`${base}/brief/${p.id}`} className="text-primary underline">
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="subscribe"
        title="Subscribe"
        state={{ status: "fresh", asOf: null, retrievedAt: facts.retrievedAt }}
        summary="The same findings as a feed. Entry ids are content hashes with no clock in them, so an unchanged finding is never sent twice."
      >
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <li className="text-[14px] leading-snug">
            <a href={`${base}/feed.xml`} className="text-primary underline">
              RSS
            </a>
          </li>
          <li className="text-[14px] leading-snug">
            <a href={`${base}/feed.xml?format=atom`} className="text-primary underline">
              Atom
            </a>
          </li>
          <li className="text-[14px] leading-snug">
            <a href={`${base}/feed.json`} className="text-primary underline">
              JSON Feed
            </a>
          </li>
        </ul>
      </Section>

      <PlaceLinks links={links} />

      <ProvenanceFooter
        provenance={brief.provenance}
        citations={brief.citations}
        caveats={[...brief.caveats, ...facts.caveats.filter((c) => !brief.caveats.includes(c))]}
        generatedAt={brief.generatedAt}
        manifestPulled={MANIFEST.pulled}
      />
    </article>
  );
}
