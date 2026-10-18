// What the page is made of, at the bottom of the page.
//
// Three blocks, in this order: the machine-readable provenance records, the
// paste-ready citation lines, and the caveats. Then when the page was built,
// and when the place identity manifest was last pulled — which is its own
// fact, because the counties table ships as a seed until a host with egress
// has run scripts/places-data.mjs, and a reader is entitled to know that the
// name and centroid on this page came from a partial table.
//
// The records arrive already de-duplicated from lib/provenance/collect; this
// component does not dedupe, sort or filter them, so what the JSON says and
// what the footer says cannot drift apart.

import type { Provenance } from "@/lib/provenance/types";

const KIND_TONE: Record<Provenance["kind"], string> = {
  published: "border-primary/50 text-primary",
  estimate: "border-warn/60 text-warn",
  snapshot: "border-border text-muted-foreground",
};

function day(iso: string | undefined | null): string | null {
  if (!iso) return null;
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export interface ProvenanceFooterProps {
  provenance: Provenance[];
  citations: string[];
  caveats: string[];
  generatedAt: string;
  /** MANIFEST.pulled: the date the place identity tables were last pulled, or null. */
  manifestPulled: string | null;
}

export default function ProvenanceFooter({ provenance, citations, caveats, generatedAt, manifestPulled }: ProvenanceFooterProps) {
  return (
    <footer className="mt-10 border-t border-border pt-5">
      <h2 id="sources" className="text-[19px] font-semibold leading-tight text-foreground">
        Sources{" "}
        <a href="#sources" className="text-muted-foreground no-underline hover:text-primary" aria-label="Link to Sources">
          #
        </a>
      </h2>

      {provenance.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {provenance.map((p, i) => (
            <li key={`${p.source.id}|${p.seriesId ?? ""}|${p.period ?? ""}|${p.kind}|${i}`} className="text-[13px] leading-snug">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={`shrink-0 rounded-sm border px-1.5 py-px text-[11px] uppercase tracking-wider ${KIND_TONE[p.kind]}`}>
                  {p.kind}
                </span>
                <span className="text-foreground">{p.source.name}</span>
                <span className="text-muted-foreground">{p.source.publisher}</span>
                <a
                  href={p.upstreamUrl ?? p.source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline"
                >
                  open the source
                </a>
              </div>
              <div className="text-muted-foreground">
                {p.seriesId ? <span className="font-mono">{p.seriesId}</span> : null}
                {p.period ? <span className="tabular-nums">{p.seriesId ? " · " : ""}period {p.period}</span> : null}
                {day(p.releasedAt) ? <span className="tabular-nums"> · released {day(p.releasedAt)}</span> : null}
                <span className="tabular-nums"> · retrieved {day(p.retrievedAt)}</span>
                {p.kind === "estimate" && p.method ? <span> · {p.method}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          No source answered while this page was built, so there is nothing to cite. Every section above says which publisher it
          was waiting for.
        </p>
      )}

      {citations.length > 0 ? (
        <>
          <h3 className="mt-6 text-[15px] font-semibold text-foreground">Citations</h3>
          <ul className="mt-2 space-y-1">
            {citations.map((c, i) => (
              <li key={i} className="max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
                {c}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {caveats.length > 0 ? (
        <>
          <h3 className="mt-6 text-[15px] font-semibold text-foreground">What these numbers are not</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {caveats.map((c, i) => (
              <li key={i} className="max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">
                {c}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="mt-6 text-[13px] leading-relaxed tabular-nums text-muted-foreground">
        Page assembled {generatedAt}.{" "}
        {manifestPulled
          ? `Place identity tables pulled ${manifestPulled}.`
          : "Place identity tables have never been pulled: names, centroids and memberships come from the offline seed, which is complete for states and metropolitan areas and partial for counties."}
      </p>
    </footer>
  );
}
