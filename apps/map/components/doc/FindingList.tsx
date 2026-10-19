// The brief, on the page: one sentence per finding, and the arithmetic that
// produced it one click away.
//
// Every sentence here was written by a total switch in lib/brief/sentence.ts,
// not generated, and every number in it went through lib/brief/format.ts.
// This component's only job is to put them in order and to make the working
// available, because "show your work" is the credibility position: a reader
// who does not believe a number can open the details and recompute it.
//
// The list item id is the finding's own content hash, so a link into a
// finding survives regeneration as long as the finding itself does.

import type { Finding, Severity } from "@/lib/brief/types";

const TONE: Record<Severity, string> = {
  alert: "border-alert/60 text-alert",
  watch: "border-warn/60 text-warn",
  note: "border-border text-muted-foreground",
};

export default function FindingList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">Nothing crossed a line in this period.</p>;
  }
  return (
    <ol className="mt-3 space-y-4">
      {findings.map((f) => (
        <li key={f.id} id={f.id} className="max-w-[48rem]">
          <p className="text-[15px] leading-relaxed text-foreground">
            <span className={`mr-2 rounded-sm border px-1.5 py-px align-middle text-[11px] uppercase tracking-wider ${TONE[f.severity]}`}>
              {f.severity}
            </span>
            {f.sentence}
          </p>
          <div className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {f.period ? <span className="tabular-nums">Period {f.period}. </span> : null}
            {f.href ? (
              <a href={f.href} className="text-primary underline">
                See the section this came from
              </a>
            ) : null}
          </div>
          {f.arithmetic.length > 0 || f.citation ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-[13px] text-muted-foreground">Show the arithmetic</summary>
              {f.arithmetic.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {f.arithmetic.map((line, i) => (
                    <li key={i} className="font-mono text-[13px] leading-snug text-foreground">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
              {f.citation ? <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{f.citation}</p> : null}
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
