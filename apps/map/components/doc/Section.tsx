// One section of a document page: a linkable heading, a status chip, a
// one-line summary, the body, and the basis prose as a footnote.
//
// This exists because the report section layout was duplicated as a private,
// unexported Section() inside both MarketReportPanel.tsx and
// WaterReportPanel.tsx, at HUD type sizes and with an onClick on every row.
// A document is not a cockpit panel: it scrolls, it prints, it is read at
// 14-16px, and it ships no event handlers at all.
//
// The id is load-bearing. Every finding in a brief can carry an href into the
// section it came from, and the sitemap-facing pages are read by people who
// paste anchors at each other, so the heading is addressable and shows it.

import type { ReactNode } from "react";
import type { SectionState } from "@/lib/places/facts";
import SectionStatus from "./SectionStatus";

export interface SectionProps {
  title: string;
  /** Anchor id. Findings and in-page links address the section by this. */
  id: string;
  state: SectionState;
  /** One line: what the section says, already written by lib/. */
  summary?: string;
  /** What the numbers are and are not. Printed as a footnote, never hidden. */
  basis?: string;
  children?: ReactNode;
}

export default function Section({ title, id, state, summary, basis, children }: SectionProps) {
  return (
    <section id={id} className="mt-8 border-t border-border pt-5">
      <h2 className="group text-[19px] font-semibold leading-tight text-foreground">
        {title}{" "}
        <a
          href={`#${id}`}
          className="text-muted-foreground no-underline hover:text-primary"
          aria-label={`Link to ${title}`}
        >
          #
        </a>
      </h2>
      <div className="mt-1.5">
        <SectionStatus state={state} />
      </div>
      {summary ? <p className="mt-2 max-w-[48rem] text-[15px] leading-relaxed text-foreground">{summary}</p> : null}
      {children}
      {basis ? <p className="mt-3 max-w-[48rem] text-[13px] leading-relaxed text-muted-foreground">{basis}</p> : null}
    </section>
  );
}
