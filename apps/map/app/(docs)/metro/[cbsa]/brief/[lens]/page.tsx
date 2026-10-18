// The same metro brief, filtered to one persona's concerns.
//
// ALWAYS noindex, follow, and canonical to the default brief. 3,680 places
// times seven lenses is 25,760 near-duplicate URLs, which is exactly the
// doorway-page pattern that would demote the pages that matter. The lens is a
// reader's convenience and a feed parameter, not a separate document, so it is
// served and followed and never offered for indexing.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import FindingList from "@/components/doc/FindingList";
import PlaceLinks from "@/components/doc/PlaceLinks";
import ProvenanceFooter from "@/components/doc/ProvenanceFooter";

import { briefInputFromFacts, buildBrief } from "@/lib/brief/build";
import type { Brief } from "@/lib/brief/types";
import { isPersonaId, PERSONA_BY_ID, type PersonaId } from "@/lib/personas/registry";
import { placeFacts } from "@/lib/places/facts";
import { linksFor } from "@/lib/places/links";
import { MANIFEST } from "@/lib/places/registry";
import { briefSeo, canonicalOf } from "@/lib/places/seo";
import { parseMetroParam, scopeBriefPath, scopePath, type PlaceScope } from "@/lib/places/scope";
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

type Params = { params: Promise<{ cbsa: string; lens: string }> };

function scopeOf(cbsa: string): PlaceScope {
  const scope = parseMetroParam(cbsa);
  if (!scope) notFound();
  return scope;
}

function lensOf(raw: string): PersonaId {
  // isPersonaId is pure data from lib/personas/registry — no client directive,
  // so it is safe in a server component.
  if (!isPersonaId(raw)) notFound();
  return raw;
}

async function load(cbsa: string, raw: string): Promise<{ scope: PlaceScope; lens: PersonaId; facts: Awaited<ReturnType<typeof placeFacts>>; brief: Brief }> {
  const scope = scopeOf(cbsa);
  const lens = lensOf(raw);
  const now = Date.now();
  // The indicator block is national either way; the lens only narrows which
  // category of it is shown. "all" is not a category, so it is left off.
  const category = PERSONA_BY_ID[lens].indicatorCategory;
  const facts = await placeFacts(scope, { now, ...(category && category !== "all" ? { indicatorCategory: category } : {}) });
  return { scope, lens, facts, brief: buildBrief(briefInputFromFacts(facts, lens), { now, generatedAt: facts.generatedAt }) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { cbsa, lens: raw } = await params;
  const { scope, facts, brief } = await load(cbsa, raw);
  const seo = briefSeo(brief, facts);
  return {
    title: seo.title,
    description: seo.description,
    robots: { index: false, follow: true },
    alternates: {
      // The default brief, never this URL.
      canonical: canonicalOf(scope, "brief"),
      types: {
        "application/rss+xml": absoluteUrl(`/metro/${cbsa}/feed.xml?lens=${raw}`),
        "application/feed+json": absoluteUrl(`/metro/${cbsa}/feed.json?lens=${raw}`),
      },
    },
    openGraph: { title: seo.ogTitle, description: seo.ogDescription, url: canonicalOf(scope, "brief"), type: "article" },
  };
}

export default async function MetroLensBriefPage({ params }: Params) {
  const { cbsa, lens: raw } = await params;
  const { scope, lens, facts, brief } = await load(cbsa, raw);
  const links = linksFor(scope);
  const persona = PERSONA_BY_ID[lens];

  return (
    <article>
      <Breadcrumbs trail={[...links.breadcrumb, { name: "Brief", url: scopeBriefPath(scope) }, { name: persona.title, url: `${scopeBriefPath(scope)}/${lens}` }]} />

      <header className="mt-2">
        <h1 className="text-[30px] font-semibold leading-tight text-foreground">
          {facts.name} brief: {persona.title}
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
          A filtered view of the same findings. The canonical version of this brief is{" "}
          <a href={scopeBriefPath(scope)} className="text-primary underline">
            the unfiltered one
          </a>
          .
        </p>
        <p className="mt-3 max-w-[48rem] text-[15px] leading-relaxed text-foreground">{brief.digest.sentence}</p>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed">
          <a href={scopePath(scope)} className="text-primary underline">
            The full {facts.shortName} page
          </a>
          .
        </p>
      </header>

      <section id="findings" className="mt-8 border-t border-border pt-5">
        <h2 className="text-[19px] font-semibold leading-tight text-foreground">{brief.headline}</h2>
        <FindingList findings={brief.findings} />
      </section>

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
