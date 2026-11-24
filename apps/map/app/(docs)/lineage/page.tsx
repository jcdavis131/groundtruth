// Method Lineage landing (SPEC C1, Appendix A).
// Server-rendered, English, no client JavaScript beyond the analytics
// island in the docs root layout. Counters and the developer-block response
// are computed at build time from lib/lineage/graph.json — never fetched
// client-side, never hardcoded, never pasted.

import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import { lineageCanonical, lineageCounters, searchSeedGraph } from "@/lib/lineage/seo";
import { absoluteUrl } from "@/lib/seo/base";

const counts = lineageCounters();

const TITLE = "Method Lineage — a causal map of how AI methods evolve";

const DESCRIPTION =
  `A causal map of how AI methods evolve: ${counts.methods} methods, ` +
  `${counts.papers} papers, ${counts.causalEdges} cited causal edges, ${counts.span}.`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: lineageCanonical("/lineage") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: lineageCanonical("/lineage"), type: "website" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

// Developer block (SPEC C1): a real request against our API and its true
// response, generated at build time from the seed with the SPEC ranking
// (exact alias match > title substring > abstract token overlap).
const DEV_REQUEST = {
  query: "grouped-query attention",
  type: "auto",
  limit: 5,
} as const;
const DEV_RESPONSE = {
  query: DEV_REQUEST.query,
  type: DEV_REQUEST.type,
  results: searchSeedGraph(DEV_REQUEST.query, DEV_REQUEST.type, DEV_REQUEST.limit),
};

const MAILTO =
  "mailto:jcdavis131@gmail.com?subject=Method%20Lineage%20waitlist&body=Please%20let%20me%20know%20when%20the%20Method%20Lineage%20graph%20grows.";

const REPO = "https://github.com/jcdavis131/groundtruth";
const SEED_FILE = `${REPO}/blob/lineage/v1/apps/map/lib/lineage/graph.json`;

const h2 = "mt-12 text-[22px] font-semibold leading-tight text-foreground";
const p = "mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground";
const card = "mt-4 border-t border-border pt-4";
const cardH = "text-[18px] font-semibold leading-snug text-foreground";
const cardP = "mt-1 max-w-[48rem] text-[15px] leading-relaxed text-foreground";
const btn =
  "inline-flex min-h-[44px] items-center rounded border border-border bg-foreground px-4 py-2 text-[15px] font-semibold text-background";
const btnGhost =
  "inline-flex min-h-[44px] items-center rounded border border-border px-4 py-2 text-[15px] font-semibold text-foreground";

export default function LineagePage() {
  return (
    <article>
      <a href="#main" className="text-primary underline">
        Skip to main content
      </a>
      <div className="mt-2">
        <Breadcrumbs trail={[{ name: "Globe", url: "/" }, { name: "Method Lineage", url: "/lineage" }]} />
      </div>

      <main id="main">
        <header className="mt-2">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            Built for research agents
          </p>
          <h1 className="mt-1 text-[30px] font-semibold leading-tight text-foreground">Method Lineage</h1>
          <p className="mt-2 max-w-[48rem] text-[18px] leading-relaxed text-foreground">
            A causal map of how AI methods evolve
          </p>
          <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
            The causal chain of method evolution, structured as a graph you can compute on. {counts.spanYears} years
            of methods, every edge cited verbatim.
          </p>
          <p className="mt-2 text-[15px] font-semibold text-foreground">Queryable · Traceable · Callable</p>
          <p className="mt-4 flex flex-wrap gap-3">
            <Link href="/lineage/explore" className={btn}>
              Open the explorer
            </Link>
            <a href="#developers" className={btnGhost}>
              Read the API docs
            </a>
          </p>
        </header>

        <section aria-label="Live seed graph" className="mt-10 border-t border-border pt-4">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            Live seed graph
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-[13px] text-muted-foreground">Methods</dt>
              <dd className="text-[28px] font-semibold tabular-nums text-foreground" data-counter="methods">
                {counts.methods}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted-foreground">Papers</dt>
              <dd className="text-[28px] font-semibold tabular-nums text-foreground" data-counter="papers">
                {counts.papers}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted-foreground">Causal edges</dt>
              <dd className="text-[28px] font-semibold tabular-nums text-foreground" data-counter="causal-edges">
                {counts.causalEdges}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted-foreground">Years of method evolution</dt>
              <dd className="text-[28px] font-semibold tabular-nums text-foreground" data-counter="span">
                {counts.span}
              </dd>
            </div>
          </dl>
          <p className="mt-2 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
            Intern-Atlas covers 60 years (1965–2025); this seed covers {counts.spanYears} years. Counts are read
            from the seed graph at build time.
          </p>
        </section>

        <section aria-labelledby="why">
          <h2 id="why" className={h2}>
            Why
          </h2>
          <p className={p}>Research agents are flying blind.</p>
          <p className={p}>
            Every automated research system improvises its own picture of the field. Nobody can say <strong>why</strong>{" "}
            a method evolved, <strong>which</strong> constraint it removed, or <strong>where</strong> the real frontier
            is.
          </p>
          <div className={card}>
            <h3 className={cardH}>Lossy memory</h3>
            <p className={cardP}>
              Model weights are a biased snapshot. Rare but decisive method transitions sit in the long tail and vanish.
            </p>
          </div>
          <div className={card}>
            <h3 className={cardH}>Unknown unknowns</h3>
            <p className={cardP}>
              &ldquo;Nobody tried it&rdquo; and &ldquo;someone tried and it failed&rdquo; look identical inside a parameter
              space.
            </p>
          </div>
          <div className={card}>
            <h3 className={cardH}>No topology</h3>
            <p className={cardP}>
              &ldquo;A traded accuracy for B&rsquo;s efficiency; C tried to keep both and failed&rdquo; is recorded nowhere.
            </p>
          </div>
          <div className={card}>
            <h3 className={cardH}>Flat retrieval</h3>
            <p className={cardP}>
              Scholar, Semantic Scholar and Connected Papers stop at the document. None traces how a method changed.
            </p>
          </div>
        </section>

        <section aria-labelledby="how">
          <h2 id="how" className={h2}>
            How it is built
          </h2>
          <p className={p}>
            How the graph is built — A short pipeline turns cited papers into a computable causal topology.
          </p>
          <h3 className="mt-6 text-[18px] font-semibold leading-snug text-foreground">Stage 1 — Build</h3>
          <div className={card}>
            <h4 className={cardH}>Curated seed</h4>
            <p className={cardP}>
              Methods and their defining papers are chosen by hand and fetched from arXiv&rsquo;s public metadata API.
            </p>
          </div>
          <div className={card}>
            <h4 className={cardH}>Typed edges</h4>
            <p className={cardP}>
              Each link is one of seven types; the four strong types (extends, improves, replaces, adapts) carry a
              bottleneck, a mechanism and a trade-off.
            </p>
          </div>
          <div className={card}>
            <h4 className={cardH}>Entity normalisation</h4>
            <p className={cardP}>
              &ldquo;GQA&rdquo;, &ldquo;grouped-query attention&rdquo; and &ldquo;Ainslie et al.&rdquo; resolve to one node with
              aliases.
            </p>
          </div>
          <h3 className="mt-6 text-[18px] font-semibold leading-snug text-foreground">Stage 2 — Quality</h3>
          <div className={card}>
            <h4 className={cardH}>Method granularity</h4>
            <p className={cardP}>
              Parent/child levels: Attention → Multi-Head Attention → Grouped-Query Attention.
            </p>
          </div>
          <div className={card}>
            <h4 className={cardH}>Paper identity</h4>
            <p className={cardP}>
              One internal id plus external ids (arXiv, DOI). A journal version merges into its arXiv record; no
              duplicates.
            </p>
          </div>
          <div className={card}>
            <h4 className={cardH}>Quality tiers</h4>
            <p className={cardP}>Tier 1: published at a top venue. Tier 2: arXiv-only. (No Tier 3; no placeholders.)</p>
          </div>
          <div className={card}>
            <h4 className={cardH}>Verbatim validator</h4>
            <p className={cardP}>
              Every quote must be a substring of the cited abstract; years must run forward; no edge may exist in both
              directions. Failures are dropped and listed, never patched.
            </p>
          </div>
        </section>

        <section aria-labelledby="lanes">
          <h2 id="lanes" className={h2}>
            What it does
          </h2>
          <div className={card}>
            <h3 className={cardH}>Explorer</h3>
            <p className={cardP}>Search methods, trace lineage chains, export a bounded subgraph.</p>
            <p className="mt-2">
              <Link href="/lineage/explore" className="inline-flex min-h-[44px] items-center text-primary underline">
                Open the explorer
              </Link>
            </p>
          </div>
          <div className={card}>
            <h3 className={cardH}>Ideas</h3>
            <p className={cardP}>
              Proposals constrained by graph topology, each with a verbatim evidence certificate.
            </p>
          </div>
          <div className={card}>
            <h3 className={cardH}>Eval</h3>
            <p className={cardP}>
              Five-dimension scoring (novelty, feasibility, significance, validity, clarity) from graph statistics only.
            </p>
          </div>
          <div className={card}>
            <h3 className={cardH}>API</h3>
            <p className={cardP}>
              Structured method memory for agents: /api/lineage, /search, /query, /path, /eval. JSON throughout.
            </p>
          </div>
          <p className="mt-4 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
            Source: the seed graph file in the{" "}
            <a href={SEED_FILE} className="text-primary underline">
              repository
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="developers-heading" id="developers">
          <h2 id="developers-heading" className={h2}>
            For developers and agents
          </h2>
          <p className={p}>
            Give any AI system a structured query surface. Manifest, OpenAPI, context and health are open:
            /api/lineage, /api/lineage/openapi.json, /api/lineage/assist/context, /api/lineage/health.
          </p>
          <h3 className="mt-6 text-[18px] font-semibold leading-snug text-foreground">Request</h3>
          <pre className="mt-2 overflow-x-auto border border-border bg-background p-4 text-[13px] leading-relaxed text-foreground">
            <code>
              POST /api/lineage/search
              {"\n"}
              {JSON.stringify(DEV_REQUEST, null, 2)}
            </code>
          </pre>
          <h3 className="mt-6 text-[18px] font-semibold leading-snug text-foreground">Response</h3>
          <pre className="mt-2 overflow-x-auto border border-border bg-background p-4 text-[13px] leading-relaxed text-foreground">
            <code>{JSON.stringify(DEV_RESPONSE, null, 2)}</code>
          </pre>
          <p className="mt-2 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
            The response above is generated at build time from the seed graph with the documented ranking (exact alias
            match, then title substring, then abstract token overlap). The first result is{" "}
            <Link href="/lineage/method/gqa" className="text-primary underline">
              grouped-query attention
            </Link>
            .
          </p>
          <div className={card}>
            <h3 className={cardH}>AI for AI</h3>
            <p className={cardP}>
              Discover capabilities at /api/lineage, then read the full schema at /api/lineage/openapi.json.
            </p>
          </div>
          <div className={card}>
            <h3 className={cardH}>AI for Science</h3>
            <p className={cardP}>
              /search, /query, /path and /assist/context return paged, traceable graph evidence.
            </p>
          </div>
          <div className={card}>
            <h3 className={cardH}>AI Scientist</h3>
            <p className={cardP}>
              /ideas and /eval return evidence citations, a structured review and a score that only graph facts can
              raise.
            </p>
          </div>
        </section>

        <section aria-labelledby="roadmap">
          <h2 id="roadmap" className={h2}>
            Roadmap
          </h2>
          <p className={p}>
            Seed graph v1 (shipped) · API v1 (shipped) · Knowledge-map import (when the source is named)
          </p>
          <h3 className="mt-6 text-[18px] font-semibold leading-snug text-foreground">
            Give your agent a structured scientific memory
          </h3>
          <p className={p}>
            The API is live on this seed. Write to us to follow the graph as it grows.
          </p>
          <p className="mt-4">
            <a href={MAILTO} className={btn}>
              Write to us
            </a>
          </p>
        </section>
      </main>

      <footer className="mt-12 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">
        <p className="text-[15px] font-semibold text-foreground">Built for the research community</p>
        <p className="mt-2">
          Method Lineage — A causal record of method evolution, built for agents. Structured, queryable, callable.
        </p>
        <p className="mt-2">
          Papers indexed <span className="tabular-nums">{counts.papers}</span> · Open · Code and seed graph (
          <a href={REPO} className="text-primary underline">
            repository
          </a>
          )
        </p>
        <nav aria-label="Method Lineage" className="mt-4">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            <li>
              <Link href="/lineage/explore" className="inline-flex min-h-[44px] items-center text-primary underline">
                Explore
              </Link>
            </li>
            <li>
              <a href="#lanes" className="inline-flex min-h-[44px] items-center text-primary underline">
                Ideas
              </a>
            </li>
            <li>
              <a href="#lanes" className="inline-flex min-h-[44px] items-center text-primary underline">
                Eval
              </a>
            </li>
            <li>
              <a href="#developers" className="inline-flex min-h-[44px] items-center text-primary underline">
                API
              </a>
            </li>
            <li>
              <a href="#developers" className="inline-flex min-h-[44px] items-center text-primary underline">
                API docs
              </a>
            </li>
            <li>
              <a href={REPO} className="inline-flex min-h-[44px] items-center text-primary underline">
                GitHub
              </a>
            </li>
            <li>
              <a href={MAILTO} className="inline-flex min-h-[44px] items-center text-primary underline">
                Contact
              </a>
            </li>
          </ul>
        </nav>
        <p className="mt-4 max-w-[48rem]">
          © 2026 Method Lineage, part of the Embedding Atlas sites. Pattern after Intern-Atlas (Shanghai AI Lab,
          arXiv 2604.28158); data and code are our own.
        </p>
        <p className="mt-2">
          <a href={absoluteUrl("/")} className="text-primary underline">
            Embedding Atlas
          </a>
        </p>
      </footer>
    </article>
  );
}
