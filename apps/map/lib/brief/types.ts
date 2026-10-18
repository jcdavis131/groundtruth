// The Brief's vocabulary. Types only: no logic, no clocks, no imports that
// pull data in.
//
// A Brief is what a place page says happened, in sentences a reader can
// check. Every Finding carries the arithmetic that produced it, the period
// it describes and the provenance of its inputs, because "show your work" is
// the whole credibility position — a number without its sum is an assertion.
//
// BriefInput is deliberately flat and deliberately timestamped by the
// caller. provenance() in lib/provenance/types.ts and envelope() in
// lib/series/api.ts both default their timestamps to new Date().toISOString();
// letting either default here would make the same facts render differently on
// every regeneration, which breaks the golden fixture, the byte-diff review of
// a wording change, and any claim that the brief is reproducible. So
// retrievedAt is a required argument and buildBrief takes generatedAt.

import type { Provenance } from "@/lib/provenance/types";
import type { PeerStat } from "@/lib/places/percentiles";
import type { IndicatorResult } from "@/lib/indicators/service";

/**
 * What produced a finding.
 * - move: a value differs from the previous published period.
 * - threshold: a value is on the wrong side of a line in PLACE_THRESHOLDS.
 * - rank: the value's position inside a cohort is notable on its own.
 * - release: the next publication of a series the brief depends on.
 * - gap: a figure the publisher withheld or has not published.
 */
export type FindingKind = "move" | "threshold" | "rank" | "release" | "gap";

export type Severity = "alert" | "watch" | "note";

export interface Finding {
  /** Stable across regenerations: derived from scope, kind and metric, never from position. */
  id: string;
  kind: FindingKind;
  severity: Severity;
  /** Field key the finding is about ("home.yoyPct"), or "" for a finding about the place as a whole. */
  metric: string;
  /** One sentence, built by lib/brief/sentence.ts. Never generated. */
  sentence: string;
  /** The operation, printed. Empty only for findings that involve no arithmetic. */
  arithmetic: string[];
  /** How big the finding is, for ordering. Comparable within a kind, not across kinds. */
  magnitude: number;
  /** Period the value describes ("2026-07-31", "2026-Q1"), when it has one. */
  period: string | null;
  previousPeriod: string | null;
  /** Where the level or the method comes from, in the words the reader sees. */
  citation: string | null;
  provenance: Provenance[];
  /** Link to the section of the place page this finding came from. */
  href?: string;
}

export interface Brief {
  scopeKind: "county" | "metro" | "state";
  /** 5-digit FIPS, 5-digit CBSA or 2-letter USPS. */
  scopeId: string;
  scopeName: string;
  /** Lens the brief was filtered to ("housing"), or null for the default brief. */
  lens: string | null;
  headline: string;
  status: "alert" | "watch" | "ok" | "no data";
  findings: Finding[];
  /** One finding that stands for the whole brief, for a feed entry or a card. */
  digest: Finding;
  /** Every distinct period the findings describe, sorted. */
  coversPeriods: string[];
  nextRelease: { title: string; earliest: string; latest: string; precision: "official" | "approximate" } | null;
  provenance: Provenance[];
  citations: string[];
  caveats: string[];
  generatedAt: string;
  /** Bumped when the rule table or the wording changes, so a reader can tell two briefs apart. */
  rulesVersion: number;
}

export interface BriefInput {
  scopeKind: "county" | "metro" | "state";
  scopeId: string;
  scopeName: string;
  lens: string | null;
  /** Latest published value per field key. A key that is absent is absent, not zero. */
  values: Record<string, number | null>;
  /** The previous published period's value for the keys where one is in the table already. */
  previous: Record<string, number | null>;
  periods: { current: Record<string, string>; previous: Record<string, string> };
  peers: Record<string, PeerStat[]>;
  /** Field keys the publisher withheld (QCEW disclosure codes). */
  suppressed: string[];
  /** Field keys that do not exist at this scope at all (rent at state level). */
  skipped: string[];
  indicators: IndicatorResult[];
  releases: Array<{ title: string; earliest: string; latest: string; precision: "official" | "approximate" }>;
  provenance: Record<string, Provenance[]>;
  /** When the inputs were fetched. Required: a default would break reproducibility. */
  retrievedAt: string;
}

/** Bump on any change to PLACE_THRESHOLDS or to the sentence templates. */
export const BRIEF_RULES_VERSION = 1;
