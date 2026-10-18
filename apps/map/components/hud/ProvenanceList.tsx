"use client";
// Compact list of provenance records for a report panel: source, period,
// release and retrieval dates, a kind tag (published / estimate / snapshot)
// and a link to the upstream. Pure presentation; the records come from
// lib/economy/report.ts and lib/water/report.ts.

import { ExternalLink } from "lucide-react";
import type { Provenance } from "@/lib/provenance/types";

const KIND_CLASS: Record<Provenance["kind"], string> = {
  published: "border-primary/50 text-primary",
  estimate: "border-warn/60 text-warn",
  snapshot: "border-border text-muted-foreground",
};

function day(iso: string | undefined): string | null {
  if (!iso) return null;
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export interface ProvenanceListProps {
  items: Provenance[];
  /** Cap the list (the panel is narrow); the rest is summarised as "+n more". */
  max?: number;
  className?: string;
}

export default function ProvenanceList({ items, max = 12, className = "" }: ProvenanceListProps) {
  if (!items.length) return <p className={`text-[9px] text-muted-foreground ${className}`}>No sources recorded yet (nothing loaded).</p>;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <ul className={`space-y-1 ${className}`}>
      {shown.map((p, i) => {
        const href = p.upstreamUrl ?? p.source.url;
        const released = day(p.releasedAt);
        const retrieved = day(p.retrievedAt);
        return (
          <li key={`${p.source.id}|${p.seriesId ?? ""}|${p.period ?? ""}|${p.kind}|${i}`} className="text-[9px] leading-snug">
            <div className="flex items-baseline gap-1.5">
              <span className={`shrink-0 rounded-sm border px-1 text-[8px] uppercase tracking-wider ${KIND_CLASS[p.kind]}`}>{p.kind}</span>
              <span className="min-w-0 truncate text-foreground/90" title={`${p.source.publisher} · ${p.source.name}`}>
                {p.source.name}
              </span>
              <a href={href} target="_blank" rel="noreferrer noopener" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Open ${p.source.name}`} title={href}>
                <ExternalLink className="inline size-2.5" />
              </a>
            </div>
            <div className="truncate text-muted-foreground" title={[p.seriesId, p.method].filter(Boolean).join(" · ")}>
              {p.seriesId ? <span>{p.seriesId}</span> : null}
              {p.kind === "estimate" && p.method ? <span>{p.seriesId ? " · " : ""}{p.method}</span> : null}
            </div>
            <div className="tabular-nums text-muted-foreground/80">
              {p.period ? <span>period {p.period}</span> : null}
              {released ? <span>{p.period ? " · " : ""}released {released}</span> : null}
              {retrieved ? <span>{p.period || released ? " · " : ""}retrieved {retrieved}</span> : null}
              {p.revision ? <span title={p.revision}> · {p.revision.length > 40 ? p.revision.slice(0, 40) + "…" : p.revision}</span> : null}
            </div>
          </li>
        );
      })}
      {rest > 0 && <li className="text-[9px] text-muted-foreground">+{rest} more in the JSON</li>}
    </ul>
  );
}
