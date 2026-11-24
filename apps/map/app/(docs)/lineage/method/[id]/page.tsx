// Method page (SPEC C2.2). Server-rendered from the seed graph:
// name, aliases, definition quote with paper link, parents, children,
// incoming/outgoing edges each showing bottleneck/mechanism/trade-off
// verbatim with quote source.

import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumbs from "@/components/doc/Breadcrumbs";
import { edgesFromId, edgesToId, getMethod, lineageCanonical, loadSeedGraph } from "@/lib/lineage/seo";
import type { LineageEdge } from "@/lib/lineage/schema";

export async function generateStaticParams() {
  const { methodsById } = loadSeedGraph();
  return [...methodsById.keys()].map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const method = getMethod(id);
  const title = method ? `${method.name} - Method Lineage` : "Method not found - Method Lineage";
  const description = method
    ? `${method.name} (${method.year}): ${method.paper?.title ?? "method in the Method Lineage seed graph"}.`
    : "No method with this id in the Method Lineage seed graph.";
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: lineageCanonical(`/lineage/method/${id}`) },
    openGraph: { title, description, url: lineageCanonical(`/lineage/method/${id}`), type: "website" },
    twitter: { title, description },
  };
}

const h2 = "mt-10 text-[22px] font-semibold leading-tight text-foreground";
const p = "mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground";

function QuoteSource({ sourceId }: { sourceId: string }) {
  const { nodesById } = loadSeedGraph();
  const source = nodesById.get(sourceId);
  if (!source) return <span className="text-muted-foreground">Source: {sourceId}</span>;
  const url = source.paper?.url ?? (source.kind === "paper" ? source.paper?.url : undefined);
  const label = source.paper?.title ?? source.name;
  return (
    <span className="text-muted-foreground">
      Source:{" "}
      {url ? (
        <a href={url} className="text-primary underline">
          {label}
        </a>
      ) : (
        label
      )}
    </span>
  );
}

function EdgeCard({ edge, otherId, direction }: { edge: LineageEdge; otherId: string; direction: "incoming" | "outgoing" }) {
  const { nodesById } = loadSeedGraph();
  const other = nodesById.get(otherId);
  const ev = edge.evidence;
  return (
    <section className="mt-4 border-t border-border pt-4" aria-label={`${direction} edge ${edge.type}`}>
      <h3 className="text-[18px] font-semibold leading-snug text-foreground">
        {edge.type} · {edge.axis}
      </h3>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {direction === "incoming" ? "From " : "To "}
        {other ? (
          <Link href={`/lineage/method/${other.id}`} className="text-primary underline">
            {other.name}
          </Link>
        ) : (
          otherId
        )}{" "}
        · confidence {ev.confidence} ({ev.confidenceBasis})
      </p>
      <dl>
        <dt className="mt-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Bottleneck</dt>
        <dd className="mt-1 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
          &ldquo;{ev.bottleneck.text}&rdquo; <QuoteSource sourceId={ev.bottleneck.sourceId} />
        </dd>
        <dt className="mt-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Mechanism</dt>
        <dd className="mt-1 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
          &ldquo;{ev.mechanism.text}&rdquo; <QuoteSource sourceId={ev.mechanism.sourceId} />
        </dd>
        <dt className="mt-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Trade-off</dt>
        <dd className="mt-1 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
          {ev.tradeoff ? (
            <>
              &ldquo;{ev.tradeoff.text}&rdquo; <QuoteSource sourceId={ev.tradeoff.sourceId} />
            </>
          ) : (
            "No trade-off quoted."
          )}
        </dd>
      </dl>
    </section>
  );
}

export default async function MethodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { nodesById, graph } = loadSeedGraph();
  const method = getMethod(id);
  if (!method) {
    return (
      <article>
        <Breadcrumbs trail={[{ name: "Method Lineage", url: "/lineage" }, { name: "Method", url: "/lineage/explore" }]} />
        <main>
          <h1 className="mt-2 text-[30px] font-semibold leading-tight text-foreground">No node with id {id} in this seed</h1>
          <p className={p}>
            The seed graph has no method with that id.{" "}
            <Link href={`/lineage/explore?q=${encodeURIComponent(id)}`} className="text-primary underline">
              Search for it
            </Link>{" "}
            or{" "}
            <Link href="/lineage/explore" className="text-primary underline">
              browse the explorer
            </Link>
            .
          </p>
        </main>
      </article>
    );
  }

  const parent = method.parent ? nodesById.get(method.parent) : undefined;
  const children = graph.nodes.filter((n) => n.parent === method.id);
  const incoming = edgesToId(method.id);
  const outgoing = edgesFromId(method.id);
  const paper = method.paper;
  // Definition quote: the first sentence of the defining paper's abstract,
  // verbatim, with a link to the paper.
  const firstSentence = paper ? paper.abstract.split(/(?<=[.!?])\s/)[0] : null;

  return (
    <article>
      <Breadcrumbs
        trail={[
          { name: "Method Lineage", url: "/lineage" },
          { name: "Explore", url: "/lineage/explore" },
          { name: method.name, url: `/lineage/method/${method.id}` },
        ]}
      />
      <main>
        <header className="mt-2">
          <h1 className="text-[30px] font-semibold leading-tight text-foreground">{method.name}</h1>
          <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-muted-foreground">
            Method · <span className="tabular-nums">{method.year}</span>
            {method.aliases.length > 0 ? ` · Also known as ${method.aliases.join(", ")}` : ""}
          </p>
        </header>

        {paper && firstSentence ? (
          <section aria-labelledby="definition">
            <h2 id="definition" className={h2}>
              Definition
            </h2>
            <blockquote className="mt-2 max-w-[48rem] border-l-2 border-border pl-4 text-[15px] leading-relaxed text-foreground">
              &ldquo;{firstSentence}&rdquo;
            </blockquote>
            <p className="mt-2 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
              From the defining paper:{" "}
              <a href={paper.url} className="text-primary underline">
                {paper.title}
              </a>{" "}
              ({paper.authors.slice(0, 3).join(", ")}
              {paper.authors.length > 3 ? ", et al." : ""}, {paper.venue ?? paper.arxivId}).
            </p>
          </section>
        ) : null}

        <section aria-labelledby="lineage">
          <h2 id="lineage" className={h2}>
            Lineage
          </h2>
          <p className={p}>
            Parent:{" "}
            {parent ? (
              <Link href={`/lineage/method/${parent.id}`} className="text-primary underline">
                {parent.name}
              </Link>
            ) : (
              "none in this seed"
            )}
          </p>
          <p className={p}>
            Children:{" "}
            {children.length > 0 ? (
              children.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && "; "}
                  <Link href={`/lineage/method/${c.id}`} className="text-primary underline">
                    {c.name}
                  </Link>
                </span>
              ))
            ) : (
              "none in this seed"
            )}
          </p>
        </section>

        <section aria-labelledby="incoming">
          <h2 id="incoming" className={h2}>
            Incoming edges ({incoming.length})
          </h2>
          {incoming.length > 0 ? (
            incoming.map((e) => <EdgeCard key={e.id} edge={e} otherId={e.from} direction="incoming" />)
          ) : (
            <p className={p}>No incoming edges in this seed.</p>
          )}
        </section>

        <section aria-labelledby="outgoing">
          <h2 id="outgoing" className={h2}>
            Outgoing edges ({outgoing.length})
          </h2>
          {outgoing.length > 0 ? (
            outgoing.map((e) => <EdgeCard key={e.id} edge={e} otherId={e.to} direction="outgoing" />)
          ) : (
            <p className={p}>No outgoing edges in this seed.</p>
          )}
        </section>

        <p className="mt-10 border-t border-border pt-4 text-[13px] text-muted-foreground">
          <Link href="/lineage/explore" className="inline-flex min-h-[44px] items-center text-primary underline">
            Back to the explorer
          </Link>
        </p>
      </main>
    </article>
  );
}
