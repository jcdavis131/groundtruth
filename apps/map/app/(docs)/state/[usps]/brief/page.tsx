// The default state brief: what changed, with the arithmetic.
//
// Never listed in a sitemap — the state page is the acquisition channel and
// this is the retention channel, reached by an in-content link that passes
// equity. A brief with no findings is served, linked and followed but not
// offered for indexing.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FindingList from "@/components/doc/FindingList";
import JsonLd from "@/components/doc/JsonLd";
import PlaceLinks from "@/components/doc/PlaceLinks";
import ProvenanceFooter from "@/components/doc/ProvenanceFooter";

import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import type { Brief } from "@/lib/brief/types";
import { placeFacts } from "@/lib/places/facts";
import { briefJsonLd } from "@/lib/places/jsonld";
import { linksFor } from "@/lib/places/links";
import { MANIFEST } from "@/lib/places/registry";
import { briefSeo, canonicalOf } from "@/lib/places/seo";
import { parseStateParam, scopePath, type PlaceScope } from "@/lib/places/scope";
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

export const maxDuration = 60;

type Params = { params: Promise<{ usps: string }> };

function scopeOf(usps: string): PlaceScope {
  const scope = parseStateParam(usps);
  if (!scope) notFound();
  return scope;
}

async function load(usps: string): Promise<{ scope: PlaceScope; facts: Awaited<ReturnType<typeof placeFacts>>; brief: Brief }> {
  const scope = scopeOf(usps);
  const now = Date.now();
  const facts = await placeFacts(scope, { now });
  return { scope, facts, brief: buildBrief(briefInputFromFacts(facts, null), { now, generatedAt: facts.generatedAt }) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { usps } = await params;
  const { scope, facts, brief } = await load(usps);
  const seo = briefSeo(brief, facts);
  const canonical = canonicalOf(scope, "brief");
  return {
    title: seo.title,
    description: seo.description,
    robots: seo.index ? undefined : { index: false, follow: true },
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

export default async function StateBriefPage({ params }: Params) {
  const { usps } = await params;
  const { scope, facts, brief } = await load(usps);
  const links = linksFor(scope);

  return (
    <article>
      <JsonLd nodes={briefJsonLd(brief, facts, links)} />
      <Breadcrumbs trail={[...links.breadcrumb, { name: "Brief", url: links.brief.href }]} />

      <header className="mt-2">
        <h1 className="text-[30px] font-semibold leading-tight text-foreground">{facts.name} brief</h1>
        <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
          Rule set version <span className="tabular-nums">{brief.rulesVersion}</span>, status {brief.status}
          {brief.coversPeriods.length > 0 ? <> · covering {brief.coversPeriods.join(", ")}</> : null}
        </p>
        <p className="mt-3 max-w-[48rem] text-[15px] leading-relaxed text-foreground">{brief.digest.sentence}</p>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed">
          <a href={scopePath(scope)} className="text-primary underline">
            The full {facts.shortName} page
          </a>
          , with its largest counties and every section&rsquo;s source.
        </p>
      </header>

      <section id="findings" className="mt-8 border-t border-border pt-5">
        <h2 className="text-[19px] font-semibold leading-tight text-foreground">{brief.headline}</h2>
        <FindingList findings={brief.findings} />
      </section>

      {brief.nextRelease ? (
        <section id="next-release" className="mt-8 border-t border-border pt-5">
          <h2 className="text-[19px] font-semibold leading-tight text-foreground">Next release</h2>
          <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
            {brief.nextRelease.title}, between <span className="tabular-nums">{brief.nextRelease.earliest}</span> and{" "}
            <span className="tabular-nums">{brief.nextRelease.latest}</span> ({brief.nextRelease.precision}).
          </p>
        </section>
      ) : null}

      <PlaceLinks links={links} />

      <ProvenanceFooter
        provenance={brief.provenance}
        citations={brief.citations}
        caveats={brief.caveats}
        generatedAt={brief.generatedAt}
        manifestPulled={MANIFEST.pulled}
      />
    </article>
  );
}
