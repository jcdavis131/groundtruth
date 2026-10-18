// The catalogue, for people: every curated collection eye draws or reads, on
// shelves by subject. Each card says what a record is, where it comes from
// (with the licence and credit the publisher asks for), what it covers, how
// current it is and where that was read, what is left out and why, the
// caveats, and the API call that serves it. The same entries are JSON at
// /api/catalog.
//
// Server-rendered from lib/catalog/collections.ts: no network, no client
// JavaScript, no globe. Ethics: collections of places and regulatory records;
// no person is listed or searchable here.

import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumbs from "@/components/doc/Breadcrumbs";

import { relatedCards } from "@/lib/catalog/cardIndex";
import { COLLECTIONS, SHELVES, catalogued, type Collection } from "@/lib/catalog/collections";
import { POTION } from "@/lib/embed/pins";
import { LAYER_IDS } from "@/lib/layers/types";
import { source } from "@/lib/provenance/sources";
import { absoluteUrl } from "@/lib/seo/base";

/** A day: the catalogue is bundled and changes only with a deploy. */
export const revalidate = 86400;

const TITLE = "Catalogue";

const DESCRIPTION =
  "Every curated collection on the Embedding Atlas globe: what a record is, its source and licence, coverage, freshness, what is left out and why, and the API call that serves it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/catalog") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl("/catalog"), type: "website" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

const h2 = "mt-10 text-[22px] font-semibold leading-tight text-foreground";
const dt = "mt-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground";
const dd = "mt-1 max-w-[48rem] text-[15px] leading-relaxed text-foreground";

function Card({ c }: { c: Collection }) {
  return (
    <section id={c.id} aria-labelledby={`${c.id}-title`} className="mt-6 border-t border-border pt-4">
      <h3 id={`${c.id}-title`} className="text-[18px] font-semibold leading-snug text-foreground">
        {c.title}
      </h3>
      <p className="mt-1 text-[13px] text-muted-foreground">
        <span className="tabular-nums">{c.id}</span> · layer <span className="tabular-nums">{c.layer}</span> ·{" "}
        <a href={`/?layers=${c.layer}`} className="text-primary underline">
          show on the globe
        </a>
      </p>
      <dl>
        <dt className={dt}>What it holds</dt>
        <dd className={dd}>{c.what}</dd>
        <dt className={dt}>A record is</dt>
        <dd className={dd}>{c.recordIs}</dd>
        <dt className={dt}>Sources</dt>
        {c.sources.map((id) => {
          const s = source(id);
          return (
            <dd key={id} className={dd}>
              <a href={s.url} className="text-primary underline" rel="noreferrer">
                {s.name}
              </a>
              , {s.publisher}. <span className="text-muted-foreground">Licence and credit: {s.license}</span>
            </dd>
          );
        })}
        <dt className={dt}>Coverage</dt>
        <dd className={dd}>
          {c.coverage.spatial}
          {c.coverage.temporal ? `; ${c.coverage.temporal}` : ""}.
          {c.coverage.count && (
            <>
              {" "}
              <span className="tabular-nums">{c.coverage.count.value.toLocaleString("en-US")}</span> {c.coverage.count.of} (counted {c.coverage.count.countedOn}).
            </>
          )}
        </dd>
        <dt className={dt}>Freshness</dt>
        <dd className={dd}>
          {c.freshness.statement} <span className="text-muted-foreground">Read from {c.freshness.readFrom}, {c.freshness.recordedOn}.</span>
        </dd>
        {c.excluded.length > 0 && (
          <>
            <dt className={dt}>Left out, and why</dt>
            <dd className={dd}>
              <ul className="list-disc pl-5">
                {c.excluded.map((x) => (
                  <li key={x.what}>
                    {x.what}: {x.why}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {c.caveats.length > 0 && (
          <>
            <dt className={dt}>Caveats</dt>
            <dd className={dd}>
              <ul className="list-disc pl-5">
                {c.caveats.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt className={dt}>Sensitivity</dt>
        <dd className={dd}>{c.sensitivity}</dd>
        <dt className={dt}>Searchable fields</dt>
        <dd className={dd}>{c.searchable.length ? c.searchable.join(", ") : "none: the layer answers by place, not by name"}</dd>
        <dt className={dt}>Embedded as record text</dt>
        <dd className={dd}>{c.embedText.length ? c.embedText.join(", ") : "nothing: no record text"}</dd>
        <dt className={dt}>API</dt>
        {c.ops.map((op) => (
          <dd key={op} className={dd}>
            <code className="tabular-nums">/api/{op}</code>
          </dd>
        ))}
        <dt className={dt}>Related collections</dt>
        <dd className={dd}>
          {relatedCards(c.id, 3).map((r, i) => (
            <span key={r.id}>
              {i > 0 && "; "}
              <a href={`#${r.id}`} className="text-primary underline">
                {r.title}
              </a>{" "}
              <span className="tabular-nums text-muted-foreground">{r.score.toFixed(2)}</span>
            </span>
          ))}
          <span className="block text-[13px] text-muted-foreground">Nearest by text embedding of the card descriptions: they read alike, which is not a claim that the data agree.</span>
        </dd>
      </dl>
    </section>
  );
}

export default function CatalogPage() {
  const done = catalogued();
  const missing = LAYER_IDS.filter((l) => !done.includes(l));
  return (
    <article>
      <Breadcrumbs trail={[{ name: "Globe", url: "/" }, { name: "Catalogue", url: "/catalog" }]} />

      <header className="mt-2">
        <h1 className="text-[30px] font-semibold leading-tight text-foreground">Catalogue</h1>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">
          Each layer on the globe is one or more curated collections. A card says what one record is and is not, who publishes it and on
          what terms, what it covers, how current it is and where that was read, what is left out and why, and the call that serves it.
          Counts and dates are as read on the day given, not a live status.
        </p>
        <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-muted-foreground">
          The same entries are JSON at{" "}
          <a href="/api/catalog" className="text-primary underline">
            /api/catalog
          </a>
          . {done.length} of {LAYER_IDS.length} layers are catalogued so far; the rest are listed under Signal sources in the globe&apos;s
          About panel. Place documents are indexed at{" "}
          <Link href="/place" className="text-primary underline">
            /place
          </Link>
          .
        </p>
      </header>

      {SHELVES.filter((s) => s.layers.some((l) => done.includes(l))).map((shelf) => (
        <div key={shelf.id}>
          <h2 id={`shelf-${shelf.id}`} className={h2}>
            {shelf.title}
          </h2>
          {COLLECTIONS.filter((c) => shelf.layers.includes(c.layer)).map((c) => (
            <Card key={c.id} c={c} />
          ))}
        </div>
      ))}

      <footer className="mt-10 border-t border-border pt-4 text-[13px] text-muted-foreground">
        Not yet catalogued ({missing.length}): {missing.join(", ")}.
        <p className="mt-3 max-w-[48rem]">
          Search by meaning: each card&apos;s description, and the record text of the collections that have it (the fields listed under
          &ldquo;Embedded as record text&rdquo;), are embedded with a small static model, so a query finds a collection or a loaded record by
          what it means as well as by its words. Names and ids are matched by letters, never by meaning, and the names of privately held
          dams and protected areas are not matched at all. Collections are ranked at{" "}
          <a href="/api/catalog?op=search&q=wetland%20habitat" className="text-primary underline">
            /api/catalog?op=search
          </a>
          .
        </p>
        <p className="mt-2 max-w-[48rem]">{POTION.credit}</p>
      </footer>
    </article>
  );
}
