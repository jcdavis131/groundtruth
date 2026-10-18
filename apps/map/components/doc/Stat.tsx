// One number, with its position among its peers underneath it.
//
// The value arrives already formatted, as a string, from lib/brief/format.ts
// via the page loader. Nothing here calls toLocaleString: the HUD's
// fmtUsd/fmtNum/fmtPct do, with no explicit locale, which is both a hydration
// hazard and a byte-reproducibility break across ICU builds, and this surface
// is the one that has to be reproducible.
//
// The peer lines are the whole point of the component. A number without a
// denominator is an assertion, so each cohort prints its percentile, its
// position, the size of the cohort that actually PUBLISHED the metric, and
// the cohort's median. When lib/places/percentiles.ts could not rank the
// value it says why, and that reason is printed instead of a number — a lone
// value must never appear as "0th percentile", which reads as "smallest of
// none" and is the single most misleading thing this page could print.
//
// A metric the publisher withheld is not a zero and is not a low rank. It
// renders as an absence, with no percentile at all.

import type { PeerStat } from "@/lib/places/percentiles";
import { countOf, num, ordinal } from "@/lib/brief/format";

/** Same shape as usd / num / pct in lib/brief/format.ts. */
export type ValueFormatter = (v: number | null | undefined) => string;

export interface StatProps {
  label: string;
  /** The value, already formatted ("$452,000", "not published"). Never a raw number. */
  display: string;
  /** Printed after the value when the display string does not carry its own unit. */
  unit?: string;
  /** The release this value belongs to. */
  asOf?: string | null;
  peers?: PeerStat[];
  /** What the number is and is not. */
  basis?: string;
  /**
   * True when the publisher withheld this area's cell (a QCEW disclosure
   * code N). The value is absent, not small, so no rank is printed.
   */
  suppressed?: boolean;
  /**
   * How to print the cohort median and range. The page knows whether the
   * metric is money, a count or a percent — this component deliberately does
   * not, because deciding would be exactly the kind of branch that belongs in
   * lib/ where it can be tested.
   */
  peerFormat?: ValueFormatter;
}

/** One cohort's line: percentile, position, cohort size and the cohort median. */
export function PeerLine({ peer, format = num }: { peer: PeerStat; format?: ValueFormatter }) {
  if (peer.pct == null || peer.rank == null) {
    return (
      <li className="text-[13px] leading-snug text-muted-foreground">
        {peer.cohortLabel}: {peer.reason ?? "no position published for this metric"}
      </li>
    );
  }
  return (
    <li className="text-[13px] leading-snug text-muted-foreground">
      <span className="tabular-nums text-foreground">{ordinal(peer.pct)} pct</span>
      {" · "}
      <span className="tabular-nums">{countOf(peer.rank, peer.n)}</span> {peer.cohortLabel}
      {" · "}median <span className="tabular-nums">{format(peer.median)}</span>
    </li>
  );
}

export default function Stat({ label, display, unit, asOf, peers, basis, suppressed, peerFormat = num }: StatProps) {
  return (
    <div className="rounded-sm border border-border bg-card p-3">
      <div className="text-[13px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold leading-tight tabular-nums text-foreground">
        {display}
        {unit ? <span className="ml-1 text-[13px] font-normal text-muted-foreground">{unit}</span> : null}
      </div>
      {asOf ? <div className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">as of {asOf}</div> : null}
      {suppressed ? (
        <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
          BLS withheld this area&rsquo;s figure, so it is absent rather than zero and carries no position among its peers.
        </p>
      ) : peers && peers.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {peers.map((p) => (
            <PeerLine key={p.cohortKey} peer={p} format={peerFormat} />
          ))}
        </ul>
      ) : null}
      {basis ? <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{basis}</p> : null}
    </div>
  );
}
