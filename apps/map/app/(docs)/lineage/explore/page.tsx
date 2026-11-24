// Explorer shell (SPEC C2). Phone-first, SSR frame + one client island
// (the graph canvas, loaded deferred). Five views, each a URL:
// C2.1 search   /lineage/explore?q=grouped-query attention
// C2.2 method   /lineage/method/[id] (separate page)
// C2.3 chain    /lineage/explore?from=attention-2017&to=gqa&direction=evolution
// C2.4 timeline /lineage/explore?view=timeline&year_start=2014&year_end=2024
// C2.5 graph    /lineage/explore?view=graph&id=arxiv:2305.13245&depth=1
// Every view works with JS off except the graph canvas itself, which needs
// the island. All state lives in the URL (GET forms), so every view is a link.

import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import { LineageGraphDeferred, type GraphEdge, type GraphNode } from "@/components/lineage/LineageGraph";
import { lineageCanonical, lineagePath, loadSeedGraph, neighbourhood, searchSeedGraph, timelineYears } from "@/lib/lineage/seo";

export const metadata: Metadata = {
  title: "Explore",
  description: "Search methods, trace lineage chains, browse the timeline, or explore the neighbourhood graph of the Method Lineage seed.",
  alternates: { canonical: lineageCanonical("/lineage/explore") },
  openGraph: {
    title: "Explore - Method Lineage",
    description: "Search methods, trace lineage chains, browse the timeline, or explore the neighbourhood graph.",
    url: lineageCanonical("/lineage/explore"),
    type: "website",
  },
  twitter: {
    title: "Explore - Method Lineage",
    description: "Search methods, trace lineage chains, browse the timeline, or explore the neighbourhood graph.",
  },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

const TYPES = ["auto", "keyword", "title", "method", "paper_id"] as const;
type SearchType = (typeof TYPES)[number];

const h2 = "mt-10 text-[22px] font-semibold leading-tight text-foreground";
const p = "mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground";
const input =
  "min-h-[44px] w-full rounded border border-border bg-background px-3 py-2 text-[15px] text-foreground";
const btn =
  "inline-flex min-h-[44px] items-center rounded border border-border bg-foreground px-4 py-2 text-[15px] font-semibold text-background";
const chip = (active: boolean) =>
  `inline-flex min-h-[44px] items-center rounded border px-3 py-2 text-[15px] font-semibold ${
    active ? "border-foreground bg-foreground text-background" : "border-border text-foreground"
  }`;

function MethodCard({ id, name, year, snippet }: { id: string; name: string; year: number; snippet: string }) {
  const { methodsById } = loadSeedGraph();
  const method = methodsById.get(id);
  return (
    <article className="mt-4 border-t border-border pt-4" data-method-card={id}>
      <h3 className="text-[18px] font-semibold leading-snug text-foreground">
        <Link href={`/lineage/method/${id}`} className="text-primary underline">
          {name}
        </Link>{" "}
        <span className="text-[13px] font-normal tabular-nums text-muted-foreground">{year}</span>
      </h3>
      <p className="mt-1 max-w-[48rem] text-[15px] leading-relaxed text-foreground">{snippet}</p>
      {method?.aliases.length ? (
        <p className="mt-1 text-[13px] text-muted-foreground">Also known as {method.aliases.join(", ")}.</p>
      ) : null}
    </article>
  );
}

function ViewNav({ view }: { view: string }) {
  const link = (href: string, label: string, active: boolean) => (
    <Link href={href} className={chip(active)} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Explorer views" className="mt-4 flex flex-wrap gap-2">
      {link("/lineage/explore", "Search", view === "search")}
      {link("/lineage/explore?from=attention-2017&to=gqa&direction=evolution", "Chain", view === "chain")}
      {link("/lineage/explore?view=timeline&year_start=2014&year_end=2024", "Timeline", view === "timeline")}
      {link("/lineage/explore?view=graph&id=arxiv:2305.13245&depth=1", "Graph", view === "graph")}
    </nav>
  );
}

function SearchView({ q, type }: { q: string; type: SearchType }) {
  const results = q ? searchSeedGraph(q, type, 20) : [];
  const { graph } = loadSeedGraph();
  const latest = [...graph.nodes]
    .filter((n) => n.kind === "method")
    .sort((a, b) => b.year - a.year || (a.name < b.name ? -1 : 1))
    .slice(0, 10);
  const qs = q ? `q=${encodeURIComponent(q)}` : "";
  return (
    <section aria-labelledby="search-heading">
      <h2 id="search-heading" className={h2}>
        Search
      </h2>
      <form method="get" action="/lineage/explore" className="mt-4">
        <label htmlFor="q" className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          Query
        </label>
        <input id="q" name="q" defaultValue={q} className={input} placeholder="grouped-query attention" />
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Search type">
          {TYPES.map((t) => (
            <Link key={t} href={`/lineage/explore?${qs}${qs ? "&" : ""}type=${t}`} className={chip(type === t)} aria-current={type === t ? "true" : undefined}>
              {t}
            </Link>
          ))}
        </div>
        <input type="hidden" name="type" value={type} />
        <p className="mt-3">
          <button type="submit" className={btn}>
            Search
          </button>
        </p>
      </form>
      {q ? (
        <>
          <p className={p} data-search-results={results.length}>
            {results.length} result{results.length === 1 ? "" : "s"} for &ldquo;{q}&rdquo; ({type}).
          </p>
          {results.map((r) => (
            <MethodCard key={r.id} id={r.id} name={r.name} year={r.year} snippet={r.snippet} />
          ))}
          {results.length === 0 ? <p className={p}>Nothing in this seed matches. Try a broader query.</p> : null}
        </>
      ) : (
        <>
          <p className={p}>Latest methods in the seed:</p>
          {latest.map((m) => (
            <MethodCard key={m.id} id={m.id} name={m.name} year={m.year} snippet={m.paper?.title ?? m.name} />
          ))}
        </>
      )}
    </section>
  );
}

function ChainView({ from, to, direction }: { from: string; to: string; direction: "evolution" | "ancestry" | "both" }) {
  const result = lineagePath(from, to, direction, 10);
  return (
    <section aria-labelledby="chain-heading">
      <h2 id="chain-heading" className={h2}>
        Lineage chain
      </h2>
      <form method="get" action="/lineage/explore" className="mt-4">
        <label htmlFor="from" className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          From
        </label>
        <input id="from" name="from" defaultValue={from} className={input} />
        <label htmlFor="to" className="mt-3 block text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          To
        </label>
        <input id="to" name="to" defaultValue={to} className={input} />
        <label htmlFor="direction" className="mt-3 block text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          Direction
        </label>
        <select id="direction" name="direction" defaultValue={direction} className={input}>
          <option value="evolution">evolution</option>
          <option value="ancestry">ancestry</option>
          <option value="both">both</option>
        </select>
        <p className="mt-3">
          <button type="submit" className={btn}>
            Trace chain
          </button>
        </p>
      </form>
      {result.found ? (
        <ol className="mt-4" data-chain-length={result.nodes.length}>
          {result.nodes.map((node, i) => (
            <li key={node.id} className="mt-4 border-t border-border pt-4">
              <p className="text-[18px] font-semibold leading-snug text-foreground">
                {i + 1}.{" "}
                <Link href={`/lineage/method/${node.id}`} className="text-primary underline">
                  {node.name}
                </Link>{" "}
                <span className="text-[13px] font-normal tabular-nums text-muted-foreground">{node.year}</span>
              </p>
              {i < result.edges.length ? (
                <p className="mt-1 text-[13px] text-muted-foreground" data-edge-type={result.edges[i].type}>
                  ↓ {result.edges[i].type} — {result.edges[i].axis}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className={p} data-chain-found="false">
          No {direction} chain from {from} to {to} within depth 12 in this seed.
        </p>
      )}
      <p className="mt-4 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
        Chains follow strong edges only (extends, improves, replaces, adapts), depth at most 12.
      </p>
    </section>
  );
}

function TimelineView({ yearStart, yearEnd }: { yearStart: number; yearEnd: number }) {
  const years = timelineYears(yearStart, yearEnd);
  const total = years.reduce((s, y) => s + y.methods.length, 0);
  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className={h2}>
        Timeline
      </h2>
      <form method="get" action="/lineage/explore" className="mt-4">
        <input type="hidden" name="view" value="timeline" />
        <label htmlFor="year_start" className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          From year
        </label>
        <input id="year_start" name="year_start" inputMode="numeric" defaultValue={yearStart} className={input} />
        <label htmlFor="year_end" className="mt-3 block text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          To year
        </label>
        <input id="year_end" name="year_end" inputMode="numeric" defaultValue={yearEnd} className={input} />
        <p className="mt-3">
          <button type="submit" className={btn}>
            Show timeline
          </button>
        </p>
      </form>
      <p className={p} data-timeline-methods={total}>
        {total} methods, {yearStart}–{yearEnd}.
      </p>
      {years.map(({ year, methods }) => (
        <section key={year} aria-label={`Year ${year}`} data-timeline-year={year} className="mt-4 border-t border-border pt-4">
          <h3 className="text-[18px] font-semibold tabular-nums text-foreground">{year}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {methods.map((m) => (
              <li key={m.id}>
                <Link href={`/lineage/method/${m.id}`} className="inline-flex min-h-[44px] items-center rounded border border-border px-3 py-2 text-[15px] text-primary underline">
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function GraphView({ id, depth }: { id: string; depth: number }) {
  const result = id ? neighbourhood(id, depth, 100) : null;
  const graphNodes: GraphNode[] = (result?.nodes ?? []).map((n) => ({
    id: n.id,
    label: n.name,
    year: n.year,
    kind: n.kind,
    href: n.kind === "method" ? `/lineage/method/${n.id}` : (n.paper?.url ?? `/lineage/explore?q=${encodeURIComponent(n.id)}`),
  }));
  const graphEdges: GraphEdge[] = (result?.edges ?? []).map((e) => ({ from: e.from, to: e.to, type: e.type }));
  return (
    <section aria-labelledby="graph-heading">
      <h2 id="graph-heading" className={h2}>
        Neighbourhood graph
      </h2>
      <form method="get" action="/lineage/explore" className="mt-4">
        <input type="hidden" name="view" value="graph" />
        <label htmlFor="graph-id" className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          Centre node id
        </label>
        <input id="graph-id" name="id" defaultValue={id} className={input} placeholder="arxiv:2305.13245" />
        <label htmlFor="depth" className="mt-3 block text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          Depth (0–4)
        </label>
        <input id="depth" name="depth" inputMode="numeric" defaultValue={depth} className={input} />
        <p className="mt-3">
          <button type="submit" className={btn}>
            Show neighbourhood
          </button>
        </p>
      </form>
      {!id ? (
        <p className={p}>Enter a method or paper id to see its neighbourhood.</p>
      ) : !result ? (
        <p className={p}>
          No node with id {id} in this seed.{" "}
          <Link href={`/lineage/explore?q=${encodeURIComponent(id)}`} className="text-primary underline">
            Search for it
          </Link>
          .
        </p>
      ) : (
        <div className="mt-4" data-graph-nodes={result.nodes.length} data-graph-truncated={result.truncated ? "true" : "false"}>
          <p className={p}>
            Neighbourhood of <strong>{result.center.name}</strong> ({result.center.year}), depth {depth}:{" "}
            {result.nodes.length} nodes, {result.edges.length} edges.
          </p>
          <LineageGraphDeferred nodes={graphNodes} edges={graphEdges} truncated={result.truncated} truncatedCount={result.truncatedCount} />
        </div>
      )}
    </section>
  );
}

export default async function ExplorePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const view = param(sp, "view") ?? "search";
  const q = param(sp, "q") ?? "";
  const rawType = param(sp, "type") ?? "auto";
  const type: SearchType = (TYPES as readonly string[]).includes(rawType) ? (rawType as SearchType) : "auto";
  const from = param(sp, "from");
  const to = param(sp, "to");
  const directionRaw = param(sp, "direction") ?? "evolution";
  const direction: "evolution" | "ancestry" | "both" =
    directionRaw === "ancestry" || directionRaw === "both" ? directionRaw : "evolution";
  const yearStart = Number(param(sp, "year_start") ?? 1951);
  const yearEnd = Number(param(sp, "year_end") ?? 2025);
  const graphId = param(sp, "id") ?? "";
  const depth = Math.max(0, Math.min(4, Number(param(sp, "depth") ?? 1) || 1));

  const activeView = from && to ? "chain" : view === "timeline" ? "timeline" : view === "graph" ? "graph" : "search";

  return (
    <article>
      <Breadcrumbs trail={[{ name: "Method Lineage", url: "/lineage" }, { name: "Explore", url: "/lineage/explore" }]} />
      <main>
        <header className="mt-2">
          <h1 className="text-[30px] font-semibold leading-tight text-foreground">Explore the lineage</h1>
          <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
            Search methods, trace a chain from one method to another, browse methods by year, or open a neighbourhood
            graph around one node.
          </p>
        </header>
        <ViewNav view={activeView} />
        {activeView === "chain" ? (
          <ChainView from={from!} to={to!} direction={direction} />
        ) : activeView === "timeline" ? (
          <TimelineView yearStart={Number.isFinite(yearStart) ? yearStart : 1951} yearEnd={Number.isFinite(yearEnd) ? yearEnd : 2025} />
        ) : activeView === "graph" ? (
          <GraphView id={graphId} depth={depth} />
        ) : (
          <SearchView q={q} type={type} />
        )}
      </main>
    </article>
  );
}
