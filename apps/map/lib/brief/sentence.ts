// Every sentence the brief can say, in one file.
//
// This is a total switch: one template per (kind, metric family), each
// producing exactly one sentence with a subject, a number, a direction, a
// period and a source clause. Interpolation only — no generation, no hedging
// adverbs, nothing that varies with anything but its arguments. That is what
// makes "no language model wrote this" a structural property of the code
// rather than a promise in a footer, and it is what lets a reviewer read every
// wording the product can emit in a single sitting.
//
// Two deliberate absences. There is no "crossed on <date>" template: a
// threshold here is recomputed from the latest point on every call, there is
// no crossed-at timestamp anywhere in the repo, and no persisted brief state,
// so the vocabulary is "is above" and "is in the top tenth" — never "crossed
// three weeks ago". And thresholdSentence always prints the citation next to
// the label, because several citations are literally "convention chosen for
// this dashboard, not an official level" and the label alone would imply an
// official line that nobody publishes.
//
// Every number goes through lib/brief/format.ts, never through
// lib/economy/features.ts, whose formatters are locale-dependent.

import type { PeerStat } from "@/lib/places/percentiles";
import type { PlaceThreshold } from "./thresholds";
import { countOf, month, num, pct, signedPct, usd, MISSING } from "./format";

type Unit = "usd" | "pct" | "count" | "ratio" | "years" | "index";

interface MetricCopy {
  /** The subject of the sentence, as a reader would say it out loud. */
  noun: string;
  unit: Unit;
  /** The source clause, without a leading preposition. */
  source: string;
}

const ZHVI = "Zillow ZHVI";
const ZORI = "Zillow ZORI";
const QCEW = "BLS QCEW";
const OEWS = "BLS OEWS";

const COPY: Record<string, MetricCopy> = {
  "home.latest": { noun: "typical home value", unit: "usd", source: ZHVI },
  "home.yoyPct": { noun: "typical home value", unit: "pct", source: ZHVI },
  "home.momPct": { noun: "typical home value", unit: "pct", source: ZHVI },
  "home.y5Pct": { noun: "typical home value", unit: "pct", source: ZHVI },
  "rent.latest": { noun: "typical asking rent", unit: "usd", source: ZORI },
  "rent.yoyPct": { noun: "typical asking rent", unit: "pct", source: ZORI },
  "rent.momPct": { noun: "typical asking rent", unit: "pct", source: ZORI },
  priceToRent: { noun: "price-to-rent ratio", unit: "ratio", source: `${ZHVI} over ${ZORI}` },
  "jobs.emp": { noun: "covered employment", unit: "count", source: QCEW },
  "jobs.yoy.emp": { noun: "covered employment", unit: "pct", source: QCEW },
  "jobs.estabs": { noun: "establishment count", unit: "count", source: QCEW },
  "jobs.yoy.estabs": { noun: "establishment count", unit: "pct", source: QCEW },
  "jobs.wages": { noun: "total quarterly wages", unit: "usd", source: QCEW },
  "jobs.yoy.wages": { noun: "total quarterly wages", unit: "pct", source: QCEW },
  "jobs.avgWeeklyWage": { noun: "average weekly wage", unit: "usd", source: QCEW },
  "jobs.yoy.avgWeeklyWage": { noun: "average weekly wage", unit: "pct", source: QCEW },
  // The metro-only employment total, from the bundled OEWS occupational
  // tables. Deliberately worded differently from QCEW's "covered employment"
  // above: they count different things, and a metro page prints both.
  emp: { noun: "surveyed employment", unit: "count", source: OEWS },
  momentum: { noun: "momentum index", unit: "index", source: `${ZHVI}, ${ZORI} and ${QCEW}, combined here` },
  yearsOfWages: { noun: "years of wages", unit: "years", source: `${ZHVI} over ${QCEW}` },
};

/**
 * Copy for a metric key. The registry is open — a caller may pass a key the
 * table does not know — so the fallback names the key itself rather than
 * inventing a noun for it.
 */
export function metricCopy(metric: string): MetricCopy {
  return COPY[metric] ?? { noun: metric, unit: "count", source: "the published table" };
}

/** A metric's value at its own scale. */
export function formatValue(v: number | null | undefined, unit: Unit): string {
  switch (unit) {
    case "usd":
      return usd(v);
    case "pct":
      return signedPct(v);
    case "count":
      return num(v);
    case "ratio":
      return num(v, 1);
    case "years":
      return num(v, 1);
    case "index":
      return num(v, 2);
  }
}

/**
 * Possessive of a place name. "Texas'" rather than "Texas's", which is the
 * form the AP stylebook uses and the one a reader will not stumble over.
 */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** "a", "a and b", "a, b and c". */
export function joinList(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * A period as a reader says it. month() passes a quarter label like "2026-Q1"
 * through unchanged, which is exactly right: QCEW publishes quarters and
 * naming a month inside one would be an invention.
 */
function periodPhrase(period: string | null | undefined): string {
  return period ? month(period) : MISSING;
}

// ---------------------------------------------------------------- templates

/**
 * A value against the previous published period, with the arithmetic printed.
 * The arithmetic array is the point of the whole product: the percent, the
 * subtraction it came from, and where each of the two levels was read.
 */
export function moveSentence(
  metric: string,
  before: number,
  after: number,
  periods: { current: string; previous: string },
  name: string,
): { sentence: string; arithmetic: string[] } {
  const c = metricCopy(metric);
  const cur = periodPhrase(periods.current);
  const prev = periodPhrase(periods.previous);
  const divisible = Number.isFinite(before) && before !== 0;
  const change = divisible ? ((after - before) / Math.abs(before)) * 100 : null;

  const arithmetic = divisible
    ? [
        `${signedPct(change)} = (${after} - ${before}) / ${before} × 100`,
        `${after} = ${c.source}, ${periods.current}`,
        `${before} = ${c.source}, ${periods.previous}`,
      ]
    : [
        `${after - before} = ${after} - ${before}`,
        `${after} = ${c.source}, ${periods.current}`,
        `${before} = ${c.source}, ${periods.previous}`,
      ];

  if (after === before) {
    return { sentence: `${possessive(name)} ${c.noun} held at ${formatValue(after, c.unit)} from ${prev} to ${cur}, on ${c.source}.`, arithmetic };
  }
  const direction = after > before ? "rose" : "fell";
  const size = change == null ? "" : `${pct(Math.abs(change))} `;
  return {
    sentence: `${possessive(name)} ${c.noun} ${direction} ${size}from ${formatValue(before, c.unit)} in ${prev} to ${formatValue(after, c.unit)} in ${cur}, on ${c.source}.`,
    arithmetic,
  };
}

/** A rule that fired, with its level and its citation in the same breath. */
export function thresholdSentence(t: PlaceThreshold, value: number, name: string, peer?: PeerStat): string {
  const c = metricCopy(t.metric);
  const level = t.level === "alert" ? "an alert level here" : "a watch level here";
  let subject: string;
  switch (t.on) {
    case "value":
      subject = `${possessive(name)} ${c.noun} is ${formatValue(value, c.unit)}`;
      break;
    case "yoyPct":
      subject = `${possessive(name)} ${c.noun} is ${signedPct(value)} against a year earlier`;
      break;
    case "momPct":
      subject = `${possessive(name)} ${c.noun} is ${signedPct(value)} against the previous month`;
      break;
    case "pct":
      subject =
        peer == null
          ? `${possessive(name)} ${c.noun} is ${formatValue(value, c.unit)}`
          : peer.rank != null
            ? `${possessive(name)} ${c.noun} of ${formatValue(value, c.unit)} ranks ${countOf(peer.rank, peer.n)} ${peer.cohortLabel}`
            : `${possessive(name)} ${c.noun} of ${formatValue(value, c.unit)} scores ${num(peer.pct, 0)} on the 0-to-100 scale across ${peer.cohortLabel}`;
      break;
  }
  return `${subject}, ${level}: ${t.label} (${t.citation}).`;
}

/** Where a value sits among its peers, with the size of the cohort printed. */
export function rankSentence(metric: string, p: PeerStat, name: string): string {
  const c = metricCopy(metric);
  const value = formatValue(p.value, c.unit);
  if (p.rank == null || p.n < 1) {
    return `${possessive(name)} ${c.noun} of ${value} carries no rank, because ${p.reason ?? `fewer than the minimum number of ${p.cohortLabel} published it`}.`;
  }
  return `${possessive(name)} ${c.noun} of ${value} ranks ${countOf(p.rank, p.n)} ${p.cohortLabel}, against a median of ${formatValue(p.median, c.unit)}.`;
}

const SUPPRESSED_NOUN: Record<string, string> = {
  "jobs.emp": "employment",
  "jobs.yoy.emp": "employment",
  "jobs.wages": "wage",
  "jobs.yoy.wages": "wage",
  "jobs.avgWeeklyWage": "wage",
  "jobs.yoy.avgWeeklyWage": "wage",
  "jobs.estabs": "establishment",
  "jobs.yoy.estabs": "establishment",
};

/**
 * A withheld figure. The sentence must say the value is ABSENT, never that it
 * is zero: QCEW nulls every cell on a disclosure_code N row, and a reader who
 * takes the gap for a zero has been misled by us, not by BLS.
 */
export function suppressedSentence(metrics: string[], name: string): string {
  const nouns: string[] = [];
  for (const m of metrics) {
    const noun = SUPPRESSED_NOUN[m] ?? m;
    if (!nouns.includes(noun)) nouns.push(noun);
  }
  if (nouns.length === 0) {
    return `BLS withheld no cells for ${name} this quarter, so no figure here is absent rather than zero.`;
  }
  return `BLS withheld ${possessive(name)} ${joinList(nouns)} cells this quarter, so those figures are absent rather than zero.`;
}

/** When the next publication lands, and how firmly that date is known. */
export function releaseSentence(r: { title: string; earliest: string; latest: string; precision: string }, name: string): string {
  const basis = r.precision === "official" ? "on the publisher's own calendar" : "estimated from the publisher's past release pattern";
  const when =
    r.earliest.slice(0, 10) === r.latest.slice(0, 10)
      ? `on ${r.earliest.slice(0, 10)}`
      : `between ${r.earliest.slice(0, 10)} and ${r.latest.slice(0, 10)}`;
  return `The next ${r.title} covering ${name} is due ${when}, ${basis}.`;
}

/** One sentence that stands for the whole brief, for a feed entry or a card. */
export function digestSentence(
  scopeName: string,
  values: Record<string, number | null>,
  periods: Record<string, string>,
  findingCount: number,
): string {
  const anchors: string[] = [];
  const home = values["home.latest"];
  if (home != null && Number.isFinite(home)) anchors.push(`a typical home value of ${usd(home)} in ${periodPhrase(periods["home.latest"])}`);
  const emp = values["jobs.emp"];
  if (emp != null && Number.isFinite(emp)) anchors.push(`covered employment of ${num(emp)} in ${periodPhrase(periods["jobs.emp"])}`);
  const against = anchors.length ? `, against ${joinList(anchors)}` : ", against no published headline value";
  const head =
    findingCount === 0
      ? `No rule fired for ${scopeName} this run`
      : `${num(findingCount)} ${findingCount === 1 ? "finding" : "findings"} fired for ${scopeName} this run`;
  return `${head}${against}.`;
}
