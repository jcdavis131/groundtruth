// The chip that says whether a section is showing today's number, yesterday's,
// or nothing at all.
//
// A place page must never render a blank section. When an upstream did not
// answer, lib/places/facts.ts hands back a SectionState with status
// "unavailable" and a reason in words, and this chip prints that reason next
// to the label. The reader then knows the difference between "there is no
// figure for this place" and "we could not reach the publisher" — which are
// different facts and are never allowed to look the same.
//
// Deliberately logic-free: the label, the tone and the wording of a missing
// reason are all table lookups. Nothing here decides anything.

import type { SectionState, SectionStatus as Status } from "@/lib/places/facts";

const LABEL: Record<Status, string> = {
  fresh: "current",
  stale: "stale",
  unavailable: "unavailable",
  "not-applicable": "not applicable",
};

const TONE: Record<Status, string> = {
  fresh: "border-primary/50 text-primary",
  stale: "border-warn/60 text-warn",
  unavailable: "border-alert/60 text-alert",
  "not-applicable": "border-border text-muted-foreground",
};

// What the chip says when the loader gave a status but no reason. Only the
// fresh row is allowed to be silent.
const FALLBACK_REASON: Record<Status, string> = {
  fresh: "",
  stale: "served from the last good copy after the publisher did not answer",
  unavailable: "the publisher could not be reached for this section",
  "not-applicable": "this section does not exist at this scale",
};

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export default function SectionStatus({ state }: { state: SectionState }) {
  const reason = state.reason ?? FALLBACK_REASON[state.status];
  const asOf = day(state.asOf);
  const retrieved = day(state.retrievedAt);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] leading-snug">
      <span className={`shrink-0 rounded-sm border px-1.5 py-px text-[11px] uppercase tracking-wider ${TONE[state.status]}`}>
        {LABEL[state.status]}
      </span>
      {asOf ? <span className="text-muted-foreground tabular-nums">as of {asOf}</span> : null}
      {retrieved ? <span className="text-muted-foreground tabular-nums">retrieved {retrieved}</span> : null}
      {reason ? <span className="text-muted-foreground">{reason}</span> : null}
    </span>
  );
}
