// The same county brief, narrowed to one reader's subject.
//
// This page is ALWAYS noindex, follow, and that is the whole point of it
// existing as its own file rather than as a query string on the default brief.
// Seven lenses across 3,680 places is 25,760 URLs that differ from each other
// by which findings were dropped — the textbook doorway pattern, and the fastest
// way to have the ~3,680 pages that carry the actual query intent demoted. So
// every lens brief is served, followed, linked from the default brief, and
// points its canonical back at the default brief, which is the page that is
// allowed to rank.
//
// The lens is a path segment rather than a search parameter because
// searchParams is a Request-time API: reading it would opt the route out of
// prerendering and, under a static segment, would hand back empty values
// without an error. A path segment is just a param, and params are awaited.
//
// isPersonaId is pure data with no client directive, so validating here costs
// nothing and an unknown lens is a real 404 rather than an unfiltered brief
// served under a name that means nothing.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FindingList from "@/components/doc/FindingList";
import JsonLd from "@/components/doc/JsonLd";
import PlaceLinks from "@/components/doc/PlaceLinks";
import ProvenanceFooter from "@/components/doc/ProvenanceFooter";
import Section from "@/components/doc/Section";
import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import { num } from "@/lib/brief/format";
import type { Brief } from "@/lib/brief/types";
import type { IndicatorCategory } from "@/lib/indicators/types";
import { PERSONA_BY_ID, isPersonaId, type PersonaId } from "@/lib/personas/registry";
import type { PlaceFacts } from "@/lib/places/facts";
import { placeFacts } from "@/lib/places/facts";
import { briefJsonLd } from "@/lib/places/jsonld";
import { linksFor } from "@/lib/places/links";
import { MANIFEST } from "@/lib/places/registry";
import { parseCountyParam, scopePath, type PlaceScope } from "@/lib/places/scope";
import { briefSeo, canonicalOf } from "@/lib/places/seo";

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

export const maxDuration = 60;

interface PageProps {
  params: Promise<{ fips: string; lens: string }>;
}

const OG_IMAGES = [{ url: "/og.jpg", width: 1200, height: 630, alt: "The Embedding Atlas globe" }];

/** The national indicator set a lens narrows to; "explorer" and an "all" category narrow nothing. */
function categoryFor(lens: PersonaId): IndicatorCategory | undefined {
  const c = PERSONA_BY_ID[lens].indicatorCategory;
  return c && c !== "all" ? c : undefined;
}

async function load(rawFips: string, rawLens: string): Promise<{ scope: PlaceScope; lens: PersonaId; facts: PlaceFacts; brief: Brief }> {
  const scope = parseCountyParam(rawFips);
  if (!scope) notFound();
  if (!isPersonaId(rawLens)) notFound();
  const lens: PersonaId = rawLens;
  const now = Date.now();
  const facts = await placeFacts(scope, { now, indicatorCategory: categoryFor(lens) });
  const brief = buildBrief(briefInputFromFacts(facts, lens), { now, generatedAt: facts.generatedAt });
  return { scope, lens, facts, brief };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { fips, lens: rawLens } = await params;
  const { scope, facts, brief } = await load(fips, rawLens);
  const seo = briefSeo(brief, facts);
  // canonicalOf refuses a "lens" target by design: a near-duplicate is never
  // the canonical URL of anything. The default brief is.
  const canonical = canonicalOf(scope, "brief");
  const base = scopePath(scope);
  return {
    title: { absolute: seo.title },
    description: seo.description,
    // Never index, always follow. Not conditional on the finding count: the
    // duplication is structural, so the answer cannot depend on the data.
    robots: { index: false, follow: true },
    alternates: {
      canonical,
      types: {
        "application/rss+xml": `${base}/feed.xml?lens=${rawLens}`,
        "application/feed+json": `${base}/feed.json?lens=${rawLens}`,
      },
    },
    openGraph: { type: "article", title: seo.ogTitle, description: seo.ogDescription, url: canonical, images: OG_IMAGES },
    twitter: { card: "summary_large_image", title: seo.ogTitle, description: seo.ogDescription, images: ["/og.jpg"] },
  };
}

export default async function CountyLensBriefPage({ params }: PageProps) {
  const { fips, lens: rawLens } = await params;
  const { scope, lens, facts, brief } = await load(fips, rawLens);
  const persona = PERSONA_BY_ID[lens];
  const links = linksFor(scope);
  const base = scopePath(scope);

  return (
    <article>
      <JsonLd nodes={briefJsonLd(brief, facts, links)} />
      <Breadcrumbs
        trail={[...links.breadcrumb, { name: "Brief", url: `${base}/brief` }, { name: persona.title, url: `${base}/brief/${lens}` }]}
      />

      <header className="mt-3">
        <h1 className="text-[32px] font-semibold leading-tight text-foreground">{brief.headline}</h1>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">{brief.digest.sentence}</p>
        <p className="mt-2 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
          This is the {persona.title.toLowerCase()} lens: {persona.who} It keeps the findings whose subject matches that
          interest and drops the rest, so it is a subset of the full brief and never a different set of numbers. The{" "}
          <Link href={`${base}/brief`} className="text-primary underline">
            full brief
          </Link>{" "}
          is the canonical version of this page.
        </p>
      </header>

      <Section
        id="findings"
        title={brief.findings.length === 1 ? "One finding" : `${num(brief.findings.length)} findings`}
        state={{ status: "fresh", asOf: null, retrievedAt: facts.retrievedAt }}
        basis={
          "A lens narrows which numbers are shown, not which holes are admitted to: a withheld figure or a pending " +
          "release survives every lens, because a gap is a fact about the place rather than about one reader's subject."
        }
      >
        <FindingList findings={brief.findings} />
      </Section>

      <Section
        id="subscribe"
        title="Subscribe to this lens"
        state={{ status: "fresh", asOf: null, retrievedAt: facts.retrievedAt }}
        summary="The same narrowed findings as a feed."
      >
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <li className="text-[14px] leading-snug">
            <a href={`${base}/feed.xml?lens=${lens}`} className="text-primary underline">
              RSS
            </a>
          </li>
          <li className="text-[14px] leading-snug">
            <a href={`${base}/feed.xml?format=atom&lens=${lens}`} className="text-primary underline">
              Atom
            </a>
          </li>
          <li className="text-[14px] leading-snug">
            <a href={`${base}/feed.json?lens=${lens}`} className="text-primary underline">
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
