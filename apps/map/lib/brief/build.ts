// Assembly: five detectors, one total order, one digest, no clock.
//
// buildBrief is PURE. No Date.now(), no new Date().toISOString(), no network,
// no randomness. Every timestamp it emits comes from opts.generatedAt or from
// input.retrievedAt, because provenance() in lib/provenance/types.ts and
// envelope() in lib/series/api.ts both default their timestamps to the wall
// clock — call either without an explicit value and the same facts render
// differently on every regeneration, which breaks the golden fixture, the
// byte-diff review of a wording change and any claim of reproducibility.
//
// WHERE THE DELTAS COME FROM. There is no per-place series anywhere: data/series
// holds a .gitkeep and no collector is county-keyed. So input.previous is the
// caller's, lifted out of the 25-month arrays the Zillow and BTS tables already
// carry, guarded the way zillowMovers guards them — a metric is comparable only
// when its newest two month keys ARE the file's newest two month columns.
// Anything that fails that guard lands in input.skipped, and this brief SAYS SO
// rather than hiding it.
//
// QCEW IS THE EXCEPTION AND IS TREATED AS ONE. The newest QCEW file carries no
// year-earlier level, only BLS's published oty_*_pct_chg, so an employment or
// wage finding states that published change and never "went from X to Y", and
// any brief carrying one also carries a caveat saying exactly that.
//
// Findings are assembled as DATA first; the sentence is the last thing computed
// and every one of them is an interpolation of lib/brief/sentence.ts templates.
// That is what makes "no language model wrote this" a property of the code.

import type { IndicatorResult } from "@/lib/indicators/service";
import type { IndicatorCategory } from "@/lib/indicators/types";
import { stableHash } from "@/lib/feed/hash";
import { PERSONA_BY_ID, isPersonaId } from "@/lib/personas/registry";
import type { PeerStat } from "@/lib/places/percentiles";
import { citationsOf, dedupeProvenance } from "@/lib/provenance/collect";
import type { Provenance } from "@/lib/provenance/types";
import { month, num, pct } from "./format";
import { digestSentence, formatValue, joinList, metricCopy, moveSentence, possessive, rankSentence, releaseSentence, suppressedSentence, thresholdSentence } from "./sentence";
import { triggeredPlaceThresholds, type PlaceThreshold } from "./thresholds";
import { BRIEF_RULES_VERSION, type Brief, type BriefInput, type Finding, type FindingKind, type Severity } from "./types";

const DAY = 86_400_000;

const SEVERITY_RANK: Record<Severity, number> = { alert: 3, watch: 2, note: 1 };

/**
 * Editorial priority inside a severity band. Finding.magnitude is comparable
 * WITHIN a kind and not across kinds — a percentile forty points off the median
 * and a home value that moved one percent are both "big" on their own scale and
 * neither is bigger than the other — so kind is ranked before magnitude rather
 * than pretending the two numbers can be compared. The order is what a reader
 * wants first: a line was crossed, then a number changed, then something is
 * missing, then where it sits, then what is coming.
 */
const KIND_RANK: Record<FindingKind, number> = { threshold: 5, move: 4, gap: 3, rank: 2, release: 1 };

/** Default cap on the printed list. The tail is counted in the digest, never dropped silently. */
export const MAX_FINDINGS = 12;

// ---------------------------------------------------------------- templates
//
// These five clauses are the only wording this module adds to the templates in
// lib/brief/sentence.ts, which ships no crossing clause, no over-the-year
// clause and no cohort-disagreement clause. They are interpolation only, from
// the same primitives (metricCopy, possessive, joinList, format.ts), and they
// belong in sentence.ts the moment that file is open for editing again.

const CROSSED = "It was on the other side of that line in the previous published period.";
const HELD = "It was on the same side of that line in the previous published period.";
const STANDING = "The previous published period is not in this table, so this is a standing level rather than a change.";
const STALE = "That window has already passed, so a newer release should exist and the figures here are an older vintage.";
const NOTHING_CROSSED = "No level in the rule table was crossed.";

/** The caveat every brief carrying a QCEW over-the-year finding must print. */
export const QCEW_OTY_CAVEAT =
  "The newest BLS QCEW file carries no year-earlier level, only the over-the-year percent change BLS publishes itself. " +
  "Every employment and wage comparison here states that published change; none of them is a move from one level to another, " +
  "because the two levels are not both in the file.";

/** The caveat every brief carrying a percentile prints, so 0 is never read as "none below". */
export const PERCENTILE_CAVEAT =
  "A percentile here is a min-max scaling of average rank across the entities that published the metric this period: " +
  "the smallest published value scores 0 and the largest scores 100. It is not the share of entities below the value, " +
  "and entities that did not publish the metric are counted in neither the rank nor its denominator.";

/** Where a rank finding's level comes from, printed next to it. */
const PERCENTILE_BASIS = "position among the entities that published this metric this period; not an official level";

function uniq(list: string[]): string[] {
  const out: string[] = [];
  for (const s of list) if (!out.includes(s)) out.push(s);
  return out;
}

/**
 * Metrics the caller could not line up against a previous period. The field key
 * is printed next to the noun on purpose: several keys share a noun —
 * home.latest, home.yoyPct and home.y5Pct are all "typical home value" — and a
 * sentence that named only the noun would read as though the headline number
 * were the one that could not be compared.
 */
function skippedSentence(metrics: string[], name: string): string {
  const named = uniq(metrics.map((m) => `${metricCopy(m).noun} (${m})`));
  return `${joinList(named)} for ${name} could not be lined up against the previous published period this run, so no change is printed for ${named.length === 1 ? "it" : "them"}.`;
}

/** A QCEW over-the-year change, stated as the published change it is. */
function otySentence(metric: string, value: number, period: string | null, name: string): string {
  const c = metricCopy(metric);
  const when = period ? ` in ${month(period)}` : "";
  return `${possessive(name)} ${c.noun} was ${pct(Math.abs(value))} ${value < 0 ? "lower" : "higher"} than the same quarter a year earlier${when}, on ${c.source}'s published over-the-year change.`;
}

/** Two cohorts that disagree — the sentence that actually changes a decision. */
function disagreementSentence(metric: string, a: PeerStat, b: PeerStat, name: string): string {
  const c = metricCopy(metric);
  const value = formatValue(a.value ?? b.value, c.unit);
  const gap = Math.abs((a.pct ?? 0) - (b.pct ?? 0));
  return `${possessive(name)} ${c.noun} of ${value} scores ${num(a.pct, 0)} on the 0-to-100 scale across ${a.cohortLabel} but ${num(b.pct, 0)} across ${b.cohortLabel}, a gap of ${num(gap, 0)} points.`;
}

/** How many findings the cap held back, said plainly. */
function remainderClause(hidden: number): string {
  return `${num(hidden)} further ${hidden === 1 ? "finding is" : "findings are"} not listed here.`;
}

// ---------------------------------------------------------------- drafts

/**
 * A finding before its id. `idValue` is the number the id is content-addressed
 * over; `discriminator` separates two findings of the same kind about the same
 * metric in the same period — two threshold rules on home.yoyPct both fire at
 * -6.3%, and a decile finding exists once per cohort. Without it their ids
 * would collide and a feed reader would see one entry where there are two.
 */
interface Draft {
  kind: FindingKind;
  severity: Severity;
  metric: string;
  sentence: string;
  arithmetic: string[];
  magnitude: number;
  period: string | null;
  previousPeriod: string | null;
  citation: string | null;
  provenance: Provenance[];
  idValue: number;
  discriminator: string;
}

function finiteOr(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Provenance for a finding, de-duplicated across the metrics it rests on. */
function provFor(input: BriefInput, metrics: string[]): Provenance[] {
  return dedupeProvenance(metrics.map((m) => input.provenance[m]));
}

/** The formulae the estimates already computed, reused verbatim so the printed arithmetic cannot drift. */
function estimateMethods(list: Provenance[]): string[] {
  return uniq(list.filter((p) => p.kind === "estimate" && p.method).map((p) => p.method!));
}

function toFinding(scopeId: string, d: Draft): Finding {
  const id = stableHash([d.kind, scopeId, d.metric, d.discriminator, d.period ?? "", d.idValue.toFixed(4)].join("|"));
  return {
    id,
    kind: d.kind,
    severity: d.severity,
    metric: d.metric,
    sentence: d.sentence,
    arithmetic: d.arithmetic,
    magnitude: d.magnitude,
    period: d.period,
    previousPeriod: d.previousPeriod,
    citation: d.citation,
    provenance: d.provenance,
  };
}

/**
 * The total order. Every tie is broken, which is what makes the output
 * invariant under any reordering of the input: severity, then kind, then size,
 * then metric, then the content-addressed id. Comparisons are byte
 * comparisons, never localeCompare, whose result depends on the machine's ICU
 * build.
 */
function compareFindings(a: Finding, b: Finding): number {
  const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (sev !== 0) return sev;
  const kind = KIND_RANK[b.kind] - KIND_RANK[a.kind];
  if (kind !== 0) return kind;
  const ma = Number.isFinite(a.magnitude) ? Math.abs(a.magnitude) : -Infinity;
  const mb = Number.isFinite(b.magnitude) ? Math.abs(b.magnitude) : -Infinity;
  if (ma !== mb) return mb - ma;
  if (a.metric !== b.metric) return a.metric < b.metric ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------- detectors

/** Which series a release title is about, so the finding can cite it. */
function releaseMetric(title: string): string {
  if (/qcew|employment|wage/i.test(title)) return "jobs.emp";
  if (/zhvi|home value/i.test(title)) return "home.latest";
  if (/zori|rent/i.test(title)) return "rent.latest";
  return "";
}

/**
 * The next publication of every series the brief rests on, plus the note that
 * a window has passed and a newer vintage should exist. Releases are sorted
 * into a fixed order first so a shuffled input cannot move them.
 */
function detectReleases(input: BriefInput, now: number): Draft[] {
  const out: Draft[] = [];
  const list = [...input.releases].sort((a, b) =>
    a.earliest !== b.earliest ? (a.earliest < b.earliest ? -1 : 1) : a.title < b.title ? -1 : a.title > b.title ? 1 : 0,
  );
  for (const r of list) {
    const metric = releaseMetric(r.title);
    const provenance = dedupeProvenance([input.provenance[metric], input.provenance[r.title]]);
    if (provenance.length === 0) continue;
    const latest = Date.parse(r.latest);
    const earliest = Date.parse(r.earliest);
    const stale = Number.isFinite(latest) && latest < now;
    const days = Number.isFinite(earliest) ? (earliest - now) / DAY : 0;
    out.push({
      kind: "release",
      severity: stale ? "watch" : "note",
      metric,
      sentence: stale ? `${releaseSentence(r, input.scopeName)} ${STALE}` : releaseSentence(r, input.scopeName),
      arithmetic: [
        `window = ${r.earliest.slice(0, 10)} to ${r.latest.slice(0, 10)}, ${r.precision === "official" ? "the publisher's own calendar" : "estimated from the publisher's past release pattern"}`,
      ],
      // Ordering urgency, not a size: an overdue release outranks an imminent
      // one, an imminent one outranks a distant one, and a release more than a
      // month out carries no weight at all.
      magnitude: Math.max(0, 30 - days),
      period: null,
      previousPeriod: null,
      citation: r.precision === "official" ? "the publisher's own release calendar" : "estimated from the publisher's past release pattern; not an announced date",
      provenance,
      idValue: stale ? 1 : 0,
      discriminator: `${r.title}@${r.earliest.slice(0, 10)}`,
    });
  }
  return out;
}

function ruleKey(t: PlaceThreshold): string {
  return [t.metric, t.level, t.op, t.value, t.on].join("|");
}

/**
 * Which lines the place is on the wrong side of, evaluated at the current
 * period AND — for every rule that does not read a percentile — at the
 * previous one, so a rule that has just started firing reads as a crossing and
 * a rule with no comparable previous period says it is a standing level.
 */
function detectThresholds(input: BriefInput): Draft[] {
  const comparable: Record<string, number | null> = {};
  for (const metric of Object.keys(input.previous).sort()) {
    const before = finiteOr(input.previous[metric]);
    const after = finiteOr(input.values[metric]);
    if (before != null && after != null) comparable[metric] = before;
  }
  // An empty peers map is what makes the previous-period pass skip every
  // on:"pct" rule: triggeredPlaceThresholds needs a national PeerStat and
  // there is no such thing for a period that has already been replaced.
  const firedBefore = new Set(triggeredPlaceThresholds(input.scopeKind, comparable, {}).map((t) => ruleKey(t.threshold)));

  const out: Draft[] = [];
  for (const t of triggeredPlaceThresholds(input.scopeKind, input.values, input.peers)) {
    const metric = t.threshold.metric;
    const provenance = provFor(input, [metric]);
    if (provenance.length === 0) continue;
    const tested = t.threshold.on === "pct" ? (t.peer?.pct ?? t.value) : t.value;
    const hasPrevious = t.threshold.on !== "pct" && comparable[metric] != null;
    const clause = !hasPrevious ? STANDING : firedBefore.has(ruleKey(t.threshold)) ? HELD : CROSSED;
    out.push({
      kind: "threshold",
      severity: t.threshold.level,
      metric,
      sentence: `${thresholdSentence(t.threshold, t.value, input.scopeName, t.peer)} ${clause}`,
      arithmetic: [
        `test: ${t.threshold.on === "pct" ? `${metric} percentile` : metric} = ${tested} ${t.threshold.op} ${t.threshold.value}`,
        ...estimateMethods(provenance),
      ],
      magnitude: Math.abs(tested - t.threshold.value),
      period: input.periods.current[metric] ?? null,
      previousPeriod: hasPrevious ? (input.periods.previous[metric] ?? null) : null,
      citation: t.threshold.citation,
      provenance,
      idValue: t.value,
      discriminator: ruleKey(t.threshold),
    });
  }
  return out;
}

/**
 * Levels worth comparing against the previous published period, and the size a
 * move has to reach before it is worth a sentence. Only LEVELS are here: a move
 * in home.yoyPct would be a change in a change, which is a second derivative
 * nobody asked for. momentum is scored on the absolute step because it lives
 * on a -1 to 1 scale where a percent change of a near-zero score explodes.
 */
const MOVE_RULES: ReadonlyArray<{ metric: string; minPct?: number; minAbs?: number; watchAt: number }> = [
  { metric: "home.latest", minPct: 0.25, watchAt: 3 },
  { metric: "rent.latest", minPct: 0.25, watchAt: 3 },
  { metric: "priceToRent", minPct: 1, watchAt: 5 },
  { metric: "yearsOfWages", minPct: 1, watchAt: 5 },
  { metric: "momentum", minAbs: 0.05, watchAt: 25 },
];

/**
 * QCEW's published over-the-year changes, the only employment comparison the
 * file supports. Total wages and establishment counts are left out: they move
 * with employment, the rule table has no line for either, and a brief that
 * says the same thing four ways has said it none.
 */
const OTY_METRICS = ["jobs.yoy.emp", "jobs.yoy.avgWeeklyWage"] as const;

/** Below this the published change is rounding, not news. */
const OTY_MIN_PCT = 0.05;

function detectMoves(input: BriefInput): { drafts: Draft[]; usedQcewOty: boolean } {
  const withheld = new Set([...input.suppressed, ...input.skipped]);
  const out: Draft[] = [];

  for (const rule of MOVE_RULES) {
    const metric = rule.metric;
    if (withheld.has(metric)) continue;
    // Employment and wages never take this path, whatever the caller supplied:
    // the QCEW file has one level, not two.
    if (metric.startsWith("jobs.")) continue;
    const after = finiteOr(input.values[metric]);
    const before = finiteOr(input.previous[metric]);
    const current = input.periods.current[metric];
    const previous = input.periods.previous[metric];
    if (after == null || before == null || !current || !previous) continue;
    const changePct = before === 0 ? null : ((after - before) / Math.abs(before)) * 100;
    const size = rule.minAbs != null ? Math.abs(after - before) * 100 : Math.abs(changePct ?? 0);
    if (rule.minAbs != null && Math.abs(after - before) < rule.minAbs) continue;
    if (rule.minPct != null && changePct != null && Math.abs(changePct) < rule.minPct) continue;
    const provenance = provFor(input, [metric]);
    if (provenance.length === 0) continue;
    const { sentence, arithmetic } = moveSentence(metric, before, after, { current, previous }, input.scopeName);
    out.push({
      kind: "move",
      severity: size >= rule.watchAt ? "watch" : "note",
      metric,
      sentence,
      arithmetic: [...arithmetic, ...estimateMethods(provenance)],
      magnitude: size,
      period: current,
      previousPeriod: previous,
      citation: null,
      provenance,
      idValue: after,
      discriminator: "",
    });
  }

  let usedQcewOty = false;
  for (const metric of OTY_METRICS) {
    if (withheld.has(metric)) continue;
    const v = finiteOr(input.values[metric]);
    if (v == null || Math.abs(v) < OTY_MIN_PCT) continue;
    const provenance = provFor(input, [metric]);
    if (provenance.length === 0) continue;
    const period = input.periods.current[metric] ?? null;
    out.push({
      kind: "move",
      severity: "note",
      metric,
      sentence: otySentence(metric, v, period, input.scopeName),
      arithmetic: [
        `${v > 0 ? "+" : ""}${v} % = BLS QCEW over-the-year percent change for ${period ?? "the latest quarter"}, as published`,
        "the newest QCEW file carries no year-earlier level, so no move from one level to another is printed",
      ],
      magnitude: Math.abs(v),
      period,
      previousPeriod: null,
      citation: "BLS QCEW over-the-year percent change, as published",
      provenance,
      idValue: v,
      discriminator: "oty",
    });
    usedQcewOty = true;
  }

  return { drafts: out, usedQcewOty };
}

/** Metrics whose cohort position is worth a sentence on its own. */
const RANK_METRICS = [
  "home.latest",
  "home.yoyPct",
  "rent.latest",
  "priceToRent",
  "jobs.emp",
  "jobs.avgWeeklyWage",
  "jobs.yoy.emp",
  "momentum",
  "yearsOfWages",
] as const;

/** A decile is where the tail starts. */
const DECILE = 10;
/** Two cohorts this far apart are telling the reader different things. */
const DISAGREEMENT_POINTS = 30;

function detectRanks(input: BriefInput, firedMetrics: Set<string>): { drafts: Draft[]; usedPercentiles: boolean } {
  const out: Draft[] = [];
  let usedPercentiles = false;
  const withheld = new Set(input.suppressed);
  for (const metric of RANK_METRICS) {
    if (withheld.has(metric)) continue;
    const stats = input.peers[metric];
    if (!stats || stats.length === 0) continue;
    const provenance = provFor(input, [metric]);
    if (provenance.length === 0) continue;
    for (const p of stats) {
      const pv = finiteOr(p.pct);
      if (pv == null || (pv < 100 - DECILE && pv > DECILE)) continue;
      // An on:"pct" rule that fired already printed this rank next to its
      // level; saying it again as a bare note is the same sentence twice.
      if (firedMetrics.has(metric)) continue;
      usedPercentiles = true;
      out.push({
        kind: "rank",
        severity: "note",
        metric,
        sentence: rankSentence(metric, p, input.scopeName),
        arithmetic: [
          `${num(pv, 0)} on the 0-to-100 scale across ${p.n} ${p.cohortLabel} that published ${metric}`,
          ...estimateMethods(provenance),
        ],
        magnitude: Math.abs(pv - 50),
        period: input.periods.current[metric] ?? null,
        previousPeriod: null,
        citation: PERCENTILE_BASIS,
        provenance,
        idValue: finiteOr(p.value) ?? pv,
        discriminator: p.cohortKey,
      });
    }
    const national = stats.find((p) => /:us$/.test(p.cohortKey) && finiteOr(p.pct) != null);
    const local = stats.find((p) => !/:us$/.test(p.cohortKey) && finiteOr(p.pct) != null);
    if (!national || !local) continue;
    const gap = Math.abs((national.pct as number) - (local.pct as number));
    if (gap <= DISAGREEMENT_POINTS) continue;
    usedPercentiles = true;
    out.push({
      kind: "rank",
      severity: "watch",
      metric,
      sentence: disagreementSentence(metric, national, local, input.scopeName),
      arithmetic: [
        `${num(gap, 0)} = |${num(national.pct, 0)} across ${national.cohortLabel} - ${num(local.pct, 0)} across ${local.cohortLabel}|`,
        ...estimateMethods(provenance),
      ],
      magnitude: gap,
      period: input.periods.current[metric] ?? null,
      previousPeriod: null,
      citation: PERCENTILE_BASIS,
      provenance,
      idValue: finiteOr(national.value) ?? gap,
      discriminator: `${national.cohortKey}~${local.cohortKey}`,
    });
  }
  return { drafts: out, usedPercentiles };
}

/**
 * What is not here, said out loud. A withheld QCEW cell is ABSENT, never zero,
 * and a metric the caller could not line up against a previous period is named
 * rather than quietly omitted — a brief that hides its own holes is worse than
 * one that has them.
 */
function detectGaps(input: BriefInput): Draft[] {
  const out: Draft[] = [];
  const suppressed = [...input.suppressed].sort();
  if (suppressed.length > 0) {
    const provenance = provFor(input, [...suppressed, "jobs.emp"]);
    if (provenance.length > 0) {
      out.push({
        kind: "gap",
        severity: "note",
        metric: "",
        sentence: suppressedSentence(suppressed, input.scopeName),
        arithmetic: [`withheld cells: ${suppressed.join(", ")}`],
        magnitude: suppressed.length,
        period: input.periods.current["jobs.emp"] ?? null,
        previousPeriod: null,
        citation: "BLS QCEW disclosure code N: the cell does not meet BLS disclosure standards and is withheld",
        provenance,
        idValue: suppressed.length,
        discriminator: "suppressed",
      });
    }
  }
  const skipped = [...input.skipped].sort();
  if (skipped.length > 0) {
    const provenance = provFor(input, skipped);
    if (provenance.length > 0) {
      out.push({
        kind: "gap",
        severity: "note",
        metric: "",
        sentence: skippedSentence(skipped, input.scopeName),
        arithmetic: [`not comparable this run: ${skipped.join(", ")}`],
        magnitude: skipped.length,
        period: null,
        previousPeriod: null,
        citation: "the two newest month columns in the published file are not the two this table carries",
        provenance,
        idValue: skipped.length,
        discriminator: "skipped",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- lens

const FAMILY: Record<string, IndicatorCategory> = {
  "home.latest": "housing",
  "home.yoyPct": "housing",
  "home.momPct": "housing",
  "home.y5Pct": "housing",
  "rent.latest": "housing",
  "rent.yoyPct": "housing",
  "rent.momPct": "housing",
  priceToRent: "housing",
  yearsOfWages: "housing",
  momentum: "housing",
  "jobs.emp": "labour",
  "jobs.estabs": "labour",
  "jobs.wages": "labour",
  "jobs.avgWeeklyWage": "labour",
  "jobs.yoy.emp": "labour",
  "jobs.yoy.estabs": "labour",
  "jobs.yoy.wages": "labour",
  "jobs.yoy.avgWeeklyWage": "labour",
};

/** The metric family a finding belongs to, or null for a finding about the place as a whole. */
export function familyOf(metric: string): IndicatorCategory | null {
  return FAMILY[metric] ?? null;
}

/**
 * Which families a lens keeps, or null for "keep everything". A lens is a
 * PersonaId; "explorer" has no open panel, no indicatorCategory and no
 * screener, so all three are optional and an unknown or category-less lens
 * falls back to the unfiltered default rather than emptying the brief.
 */
export function lensFamilies(lens: string | null): Set<IndicatorCategory> | null {
  if (!lens || !isPersonaId(lens)) return null;
  const persona = PERSONA_BY_ID[lens];
  const keep = new Set<IndicatorCategory>();
  if (persona.indicatorCategory && persona.indicatorCategory !== "all") keep.add(persona.indicatorCategory);
  const query = persona.screener?.query ?? "";
  for (const metric of Object.keys(FAMILY).sort()) if (query.includes(metric)) keep.add(FAMILY[metric]);
  return keep.size === 0 ? null : keep;
}

// ---------------------------------------------------------------- build

export interface BuildBriefOptions {
  /** Epoch ms the brief is evaluated at. Used for release staleness only; never read from the clock. */
  now: number;
  /** ISO time stamped onto the Brief. Required: a default would break reproducibility. */
  generatedAt: string;
  maxFindings?: number;
}

/**
 * The whole brief, from a frozen input and two explicit timestamps. Runs the
 * five detectors in a fixed order, filters by lens, sorts by a total order,
 * caps the list and summarises the tail in a digest that is always present —
 * so a quiet county still produces a feed item and the page is never empty.
 */
export function buildBrief(input: BriefInput, opts: BuildBriefOptions): Brief {
  const releases = detectReleases(input, opts.now);
  const thresholds = detectThresholds(input);
  const moves = detectMoves(input);
  const ranks = detectRanks(input, new Set(thresholds.filter((t) => t.discriminator.endsWith("|pct")).map((t) => t.metric)));
  const gaps = detectGaps(input);

  const keep = lensFamilies(input.lens);
  const drafts = [...releases, ...thresholds, ...moves.drafts, ...ranks.drafts, ...gaps].filter((d) => {
    if (keep == null) return true;
    const family = familyOf(d.metric);
    // A finding about the place as a whole — a withheld cell, a release with
    // no single series behind it — survives every lens. A lens narrows which
    // numbers are shown, not which holes are admitted to.
    return family == null || keep.has(family);
  });

  const all = drafts.map((d) => toFinding(input.scopeId, d)).sort(compareFindings);
  const unique: Finding[] = [];
  const seen = new Set<string>();
  for (const f of all) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    unique.push(f);
  }

  const cap = opts.maxFindings ?? MAX_FINDINGS;
  const findings = unique.slice(0, Math.max(0, cap));
  const hidden = unique.length - findings.length;

  const anyValue = Object.keys(input.values).some((k) => finiteOr(input.values[k]) != null);
  const worst = unique.reduce<Severity | null>((acc, f) => (acc == null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc), null);
  const status: Brief["status"] = !anyValue ? "no data" : worst === "alert" ? "alert" : worst === "watch" ? "watch" : "ok";

  const coversPeriods = [...new Set(unique.filter((f) => f.kind !== "release").map((f) => f.period).filter((p): p is string => p != null))].sort();

  const nextRelease =
    [...input.releases].sort((a, b) => (a.earliest !== b.earliest ? (a.earliest < b.earliest ? -1 : 1) : a.title < b.title ? -1 : a.title > b.title ? 1 : 0))[0] ?? null;

  const digest = buildDigest(input, unique.length, hidden, coversPeriods);

  const provenance = dedupeProvenance([...unique.map((f) => f.provenance), digest.provenance]);

  return {
    scopeKind: input.scopeKind,
    scopeId: input.scopeId,
    scopeName: input.scopeName,
    lens: input.lens,
    headline: headlineOf(input.scopeName, unique, status),
    status,
    findings,
    digest,
    coversPeriods,
    nextRelease,
    provenance,
    citations: citationsOf(provenance),
    caveats: caveatsOf(input, moves.usedQcewOty, ranks.usedPercentiles),
    generatedAt: opts.generatedAt,
    rulesVersion: BRIEF_RULES_VERSION,
  };
}

/** Headline metrics the digest anchors on, in the order it prints them. */
const DIGEST_METRICS = ["home.latest", "rent.latest", "jobs.emp", "jobs.avgWeeklyWage", "priceToRent", "momentum"] as const;

/**
 * One finding that stands for the whole brief. It exists even when nothing
 * fired — the same trick the watchlist digest uses — so a quiet place still
 * produces a feed item with a stable guid and a page that is never blank.
 *
 * The id is content-addressed over the scope, the lens, the periods covered
 * and the number of findings, with no wall-clock term: a regeneration that
 * changed nothing regenerates the same id, and a poller does not re-notify.
 */
function buildDigest(input: BriefInput, total: number, hidden: number, coversPeriods: string[]): Finding {
  const parts = [digestSentence(input.scopeName, input.values, input.periods.current, total)];
  if (total === 0) parts.push(NOTHING_CROSSED);
  if (hidden > 0) parts.push(remainderClause(hidden));
  const arithmetic: string[] = [];
  for (const metric of DIGEST_METRICS) {
    const v = finiteOr(input.values[metric]);
    if (v == null) continue;
    const period = input.periods.current[metric];
    arithmetic.push(`${metric} = ${v}${period ? ` (${period})` : ""}`);
  }
  return {
    id: stableHash(["digest", input.scopeId, input.lens ?? "", coversPeriods.join(","), String(total)].join("|")),
    // FindingKind has no "summary" member and this module does not own the
    // type. "gap" is the nearest honest member: the digest is what stands in
    // for a detection rather than being one.
    kind: "gap",
    severity: "note",
    metric: "",
    sentence: parts.join(" "),
    arithmetic,
    magnitude: total,
    period: null,
    previousPeriod: null,
    citation: null,
    provenance: dedupeProvenance(Object.keys(input.provenance).sort().map((k) => input.provenance[k])),
  };
}

function headlineOf(name: string, findings: Finding[], status: Brief["status"]): string {
  if (status === "no data") return `${name}: no published figures this run`;
  if (findings.length === 0) return `${name}: nothing crossed a line this run`;
  const counts: Record<Severity, number> = { alert: 0, watch: 0, note: 0 };
  for (const f of findings) counts[f.severity]++;
  const parts: string[] = [];
  if (counts.alert > 0) parts.push(`${num(counts.alert)} at an alert level`);
  if (counts.watch > 0) parts.push(`${num(counts.watch)} at a watch level`);
  if (counts.note > 0) parts.push(`${num(counts.note)} noted`);
  return `${name}: ${num(findings.length)} ${findings.length === 1 ? "finding" : "findings"}, ${joinList(parts)}`;
}

function caveatsOf(input: BriefInput, usedQcewOty: boolean, usedPercentiles: boolean): string[] {
  const out: string[] = [];
  if (usedQcewOty) out.push(QCEW_OTY_CAVEAT);
  if (usedPercentiles) out.push(PERCENTILE_CAVEAT);
  if (input.indicators.length > 0) {
    const flagged = input.indicators
      .filter((i) => i.evaluation.status === "alert" || i.evaluation.status === "watch")
      .map((i) => `${i.meta.title} (${i.evaluation.status})`)
      .sort();
    const tail = flagged.length > 0 ? `; ${joinList(flagged)} ${flagged.length === 1 ? "is" : "are"} at a watch or alert level` : "; none is at a watch or alert level";
    out.push(
      `The named indicators shown beside this brief are national or basin-level series, not measurements of ${input.scopeName}${tail}. They are context.`,
    );
  }
  return out;
}

/**
 * The brief as plain text, for a feed summary, a terminal or a diff. Prints the
 * arithmetic under every finding, because that is the product.
 */
export function briefText(b: Brief): string {
  const lines: string[] = [b.headline, `status: ${b.status}`, "", b.digest.sentence, ""];
  for (const f of b.findings) {
    lines.push(`- [${f.severity}] ${f.sentence}`);
    for (const a of f.arithmetic) lines.push(`    ${a}`);
    if (f.citation) lines.push(`    source of the level: ${f.citation}`);
  }
  if (b.findings.length === 0) lines.push("- no finding");
  if (b.nextRelease) lines.push("", `next release: ${b.nextRelease.title}, ${b.nextRelease.earliest.slice(0, 10)} to ${b.nextRelease.latest.slice(0, 10)} (${b.nextRelease.precision})`);
  if (b.caveats.length > 0) {
    lines.push("", "caveats:");
    for (const c of b.caveats) lines.push(`- ${c}`);
  }
  if (b.citations.length > 0) {
    lines.push("", "sources:");
    for (const c of b.citations) lines.push(`- ${c}`);
  }
  lines.push("", `generated ${b.generatedAt}, rules version ${b.rulesVersion}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- from facts

/**
 * The shape briefInputFromFacts reads. PlaceFacts (lib/places/facts.ts)
 * satisfies it structurally; it is written out here rather than imported so
 * this module — which is pure, and is imported by the feed and the API —
 * does not pull the facts assembler and its upstream clients into a brief that
 * never fetches anything.
 */
export interface BriefFacts {
  scope: { kind: "county" | "metro" | "state"; id: string };
  name: string;
  retrievedAt: string;
  values: Record<string, number | null>;
  previous: Record<string, number | null>;
  periods: { current: Record<string, string>; previous: Record<string, string> };
  suppressed: string[];
  skipped: string[];
  peers: Record<string, PeerStat[]>;
  indicators: { items: IndicatorResult[] };
  releases: Array<{ title: string; earliest: string; latest: string; precision: "official" | "approximate" }>;
  metricProvenance: Record<string, Provenance[]>;
}

/**
 * A PlaceFacts as a BriefInput. Every timestamp comes from the facts, never
 * from the clock — this is the only helper in the module that touches anything
 * assembled, and it still invents nothing.
 */
export function briefInputFromFacts(f: BriefFacts, lens: string | null): BriefInput {
  return {
    scopeKind: f.scope.kind,
    scopeId: f.scope.id,
    scopeName: f.name,
    lens,
    values: f.values,
    previous: f.previous,
    periods: f.periods,
    peers: f.peers,
    suppressed: f.suppressed,
    skipped: f.skipped,
    indicators: f.indicators.items,
    releases: f.releases,
    provenance: f.metricProvenance,
    retrievedAt: f.retrievedAt,
  };
}
