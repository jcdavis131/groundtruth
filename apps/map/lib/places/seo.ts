// Titles and descriptions for the place pages.
//
// A title is not decoration here, it is the whole acquisition argument. Three
// thousand six hundred pages whose titles differ only by a place name are the
// textbook doorway pattern and get filtered as a set; three thousand six
// hundred pages that each lead with the most distinctive TRUE thing about that
// place are a reference work. So placeSeo runs a fixed priority order and
// takes the first branch that applies:
//
//   1. a place threshold that fired   - a number, a direction and a period
//   2. a top- or bottom-decile rank   - a position inside a named cohort
//   3. the metro's distinctive work   - from the bundled OEWS index
//   4. the offline fallback           - identity plus what the page covers
//
// Branches 3 and 4 need no network at all, so a page rendered with every
// upstream down still gets a specific title rather than a templated one, and
// two neighbouring counties in the same metro still differ at branches 1 and 2
// even though branch 3 would give them the same words.
//
// Descriptions are composed from the SAME finished sentences the brief prints,
// through lib/brief/sentence.ts, so they carry real numbers with their periods
// and their sources rather than adjectives. Two strings are refused outright:
// anything that says a section is unavailable, and anything carrying the
// MISSING placeholder. A search result that reads "data unavailable" is worse
// than no description at all, and neither string is a fact about the place.
//
// Ethics: places and institutions only. Nothing here names a person or an
// address, because nothing upstream of it holds one.

import { absoluteUrl } from "@/lib/seo/base";
import { MISSING, month, num, pct } from "@/lib/brief/format";
import { metricCopy, moveSentence, rankSentence, thresholdSentence } from "@/lib/brief/sentence";
import { triggeredPlaceThresholds, type TriggeredPlaceThreshold } from "@/lib/brief/thresholds";
import type { Brief } from "@/lib/brief/types";
// The OEWS metro index is imported as JSON rather than through
// lib/economy/oews.ts on purpose: that module also statically imports
// msa_jobs.json (2.1 MB), and generateMetadata and the sitemaps reach this
// file on paths that have no use for the occupation mix. Same file, same
// module, one twenty-seventh of the bytes.
import msaIndexJson from "@/lib/economy/data/msa_index.json";
import type { MsaIndexEntry } from "@/lib/economy/features";
import type { PeerStat } from "./percentiles";
import { PEER_MIN_N } from "./percentiles";
import { metroForCounty } from "./registry";
import { scopeBriefPath, scopePath, type PlaceScope } from "./scope";
import type { PlaceFacts } from "./facts";

/** Which of the four priority branches produced the title. Exposed so the order is testable. */
export type SeoBranch = "threshold" | "percentile" | "occupation" | "offline";

export interface SeoText {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  /** The branch the title came from. */
  branch: SeoBranch;
  /** False when the page must be noindex, follow — a brief with no findings. */
  index: boolean;
}

/** Google truncates a description near here; a sentence that survives whole is worth more than a clipped one. */
export const META_MAX = 155;

/** OpenGraph has room for more, and a card is read in full. */
export const OG_MAX = 200;

/** Past this a title is cut in the result list, so it is cut here instead, on a word. */
export const TITLE_MAX = 90;

/** A decile either way is notable; anything nearer the middle is not worth a title. */
const DECILE = 10;

/** Below this location quotient the metro's leading group is not distinctive enough to lead with. */
const DISTINCTIVE_LQ = 1.2;

/** Never advertise an outage or a placeholder in a search result. */
const REFUSED = /unavailab|not fetched|did not answer|no rank|carries no rank/i;

const MSA_INDEX = new Map<string, MsaIndexEntry>((msaIndexJson as unknown as MsaIndexEntry[]).map((m) => [m.id, m]));

// ---------------------------------------------------------------- text plumbing

/**
 * Cut to a length without ever cutting through a number. Whole words are
 * dropped from the end until the last character is a letter, so "$452,000"
 * and "4.1%" are either present entire or absent entirely — a truncated
 * figure is a wrong figure, and this is the one place a wrong figure could
 * reach a search result.
 */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  if (space > 0) cut = cut.slice(0, space);
  while (cut.length > 0 && !/[A-Za-z]$/.test(cut)) {
    const i = cut.lastIndexOf(" ");
    if (i <= 0) return "";
    cut = cut.slice(0, i);
  }
  return cut;
}

function usable(s: string | null | undefined): s is string {
  if (!s) return false;
  const t = s.trim();
  return t.length > 0 && !REFUSED.test(t) && !t.includes(MISSING);
}

/**
 * Join finished sentences to a budget, on sentence boundaries. A sentence is
 * taken whole or not at all; only a first sentence that is itself over the
 * budget is clipped, and then on a word.
 */
export function metaDescription(sentences: string[], max = META_MAX): string {
  let out = "";
  for (const raw of sentences) {
    if (!usable(raw)) continue;
    const s = raw.trim();
    const next = out ? `${out} ${s}` : s;
    if (next.length <= max) {
      out = next;
      continue;
    }
    if (out) break;
    return clip(s, max);
  }
  return out;
}

// ---------------------------------------------------------------- the four branches

/** "Austin-Round Rock-San Marcos, TX" -> "Austin". */
function primaryCity(metroName: string): string {
  return (metroName.split(",")[0] ?? metroName).split(/[-/]/)[0].trim();
}

/** "a Dallas metro economy", "an Austin metro economy" — the article is part of the sentence being true English. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** "Computer and Mathematical Occupations" -> "computer and mathematical work". */
function occupationPhrase(domT: string): string {
  const body = domT.replace(/\s+Occupations$/i, "").toLowerCase();
  return `${body} work`;
}

/** The CBSA this scope belongs to, from the scope's own ref where it has one. */
function cbsaOf(scope: PlaceScope): string | null {
  if (scope.kind === "metro") return scope.id;
  if (scope.kind === "state") return null;
  return scope.ref?.cbsa ?? metroForCounty(scope.id)?.cbsa ?? null;
}

/**
 * The rule that gets to speak. An alert outranks a watch; within a level the
 * PLACE_THRESHOLDS table order decides, which is hand-written and stable, so
 * the same inputs always produce the same title.
 */
function leadThreshold(f: PlaceFacts): TriggeredPlaceThreshold | null {
  const fired = triggeredPlaceThresholds(f.scope.kind, f.values, f.peers);
  if (fired.length === 0) return null;
  return fired.find((t) => t.threshold.level === "alert") ?? fired[0];
}

function thresholdClause(t: TriggeredPlaceThreshold, f: PlaceFacts): string {
  const c = metricCopy(t.threshold.metric);
  const direction = t.value < 0 ? "fell" : "rose";
  const size = pct(Math.abs(t.value));
  const period = f.periods.current[t.threshold.metric];
  switch (t.threshold.on) {
    case "momPct":
      return period ? `${c.noun} ${direction} ${size} in ${month(period)}` : `${c.noun} ${direction} ${size} against the previous month`;
    case "yoyPct":
      return `${c.noun} ${direction} ${size} from a year earlier`;
    default:
      return t.threshold.label;
  }
}

interface LeadPeer {
  metric: string;
  peer: PeerStat;
}

/** The most extreme decile position across every metric and cohort on the page. */
function leadPeer(f: PlaceFacts): LeadPeer | null {
  let best: LeadPeer | null = null;
  let bestDistance = 0;
  for (const metric of Object.keys(f.peers).sort()) {
    for (const peer of f.peers[metric] ?? []) {
      if (peer.pct == null || !Number.isFinite(peer.pct) || peer.n < PEER_MIN_N) continue;
      if (peer.pct > DECILE && peer.pct < 100 - DECILE) continue;
      const distance = Math.abs(peer.pct - 50);
      if (distance > bestDistance) {
        best = { metric, peer };
        bestDistance = distance;
      }
    }
  }
  return best;
}

function peerClause(lead: LeadPeer): string {
  const c = metricCopy(lead.metric);
  const p = lead.peer.pct as number;
  const side = p >= 50 ? "top" : "bottom";
  const share = Math.max(1, Math.round(side === "top" ? 100 - p : p));
  return `${c.noun} in the ${side} ${share}% of ${lead.peer.cohortLabel}`;
}

/** What the page covers, for the branch that has no numbers to lead with. */
function coverage(kind: PlaceScope["kind"]): string {
  if (kind === "metro") return "housing, the occupation mix and member counties";
  if (kind === "state") return "housing, jobs and federal spending";
  return "housing, jobs, water and federal spending";
}

interface Distinctive {
  branch: SeoBranch;
  clause: string;
}

/**
 * The first branch that applies, with the clause it produced. Shared by the
 * page title and the brief title so the two never disagree about what the
 * most distinctive true fact is.
 */
export function distinctive(f: PlaceFacts): Distinctive {
  const t = leadThreshold(f);
  if (t) return { branch: "threshold", clause: thresholdClause(t, f) };

  const p = leadPeer(f);
  if (p) return { branch: "percentile", clause: peerClause(p) };

  const cbsa = cbsaOf(f.scope);
  if (cbsa) {
    const entry = MSA_INDEX.get(cbsa);
    if (entry && entry.domT && entry.domLq != null && entry.domLq >= DISTINCTIVE_LQ) {
      const city = primaryCity(entry.name);
      const lead = `${article(city)} ${city} metro economy led by ${occupationPhrase(entry.domT)}`;
      return { branch: "occupation", clause: f.scope.kind === "metro" ? `an economy led by ${occupationPhrase(entry.domT)}` : lead };
    }
  }

  return { branch: "offline", clause: coverage(f.scope.kind) };
}

/**
 * The name spelled out. The branches that lead with a number want the compact
 * "Travis County, TX" so the number stays inside the length a result list
 * shows; the branches that lead with no number have the room for "Travis
 * County, Texas", which is also the form a search for it is typed in.
 */
function longName(f: PlaceFacts): string {
  return f.scope.kind === "county" && f.scope.ref ? `${f.scope.ref.name}, ${f.scope.ref.stateName}` : f.name;
}

/** The title, with the separator each branch reads best with. */
function titleOf(f: PlaceFacts, d: Distinctive): string {
  if (d.branch === "threshold" || d.branch === "percentile") return clip(`${f.name}: ${d.clause}`, TITLE_MAX);
  if (d.branch === "occupation") return clip(`${f.name} — ${d.clause}`, TITLE_MAX);
  return clip(`${longName(f)} — ${d.clause}`, TITLE_MAX);
}

// ---------------------------------------------------------------- sentences

/** Every finished sentence this page can offer a description, best first. */
function pageSentences(f: PlaceFacts): string[] {
  const name = f.shortName;
  const out: string[] = [];

  const fired = triggeredPlaceThresholds(f.scope.kind, f.values, f.peers);
  for (const t of [...fired].sort((a, b) => (a.threshold.level === b.threshold.level ? 0 : a.threshold.level === "alert" ? -1 : 1))) {
    out.push(thresholdSentence(t.threshold, t.value, name, t.peer));
  }

  for (const metric of Object.keys(f.values).sort()) {
    const after = f.values[metric];
    const before = f.previous[metric];
    const current = f.periods.current[metric];
    const previous = f.periods.previous[metric];
    if (after == null || before == null || !current || !previous) continue;
    if (!Number.isFinite(after) || !Number.isFinite(before)) continue;
    out.push(moveSentence(metric, before, after, { current, previous }, name).sentence);
  }

  const lead = leadPeer(f);
  if (lead) out.push(rankSentence(lead.metric, lead.peer, name));

  // Always last, always true, and never about an outage: the description is
  // never empty and never advertises a failure.
  out.push(`${f.name}: ${coverage(f.scope.kind)}, each figure with its source and the period it describes.`);
  return out;
}

// ---------------------------------------------------------------- public

/** Title and description for a place page. Always indexable: the page has identity even with no data. */
export function placeSeo(f: PlaceFacts): SeoText {
  const d = distinctive(f);
  const sentences = pageSentences(f);
  const title = titleOf(f, d);
  return {
    title,
    description: metaDescription(sentences, META_MAX),
    ogTitle: title,
    ogDescription: metaDescription(sentences, OG_MAX),
    branch: d.branch,
    index: true,
  };
}

/**
 * Title and description for a brief. `index` is false when the brief found
 * nothing: a page that says "nothing crossed a line" is true and useful to a
 * subscriber and thin to a crawler, so it is served, linked and followed, and
 * not offered for indexing.
 */
export function briefSeo(b: Brief, f: PlaceFacts): SeoText {
  const lensTag = b.lens ? ` (${b.lens} lens)` : "";
  const d = distinctive(f);
  const counted = b.headline.startsWith(`${b.scopeName}: `) ? b.headline.slice(b.scopeName.length + 2) : b.headline;
  const clause =
    b.findings.length === 0
      ? "nothing crossed a line this run"
      : d.branch === "threshold" || d.branch === "percentile"
        ? d.clause
        : counted;
  const title = clip(`${f.name} brief${lensTag}: ${clause}`, TITLE_MAX);
  const sentences = [b.digest.sentence, ...b.findings.map((x) => x.sentence), ...pageSentences(f)];
  return {
    title,
    description: metaDescription(sentences, META_MAX),
    ogTitle: title,
    ogDescription: metaDescription(sentences, OG_MAX),
    branch: d.branch,
    index: b.findings.length > 0,
  };
}

/**
 * What a canonical target may be. "lens" and "compare" are members so that the
 * refusal is typed rather than a runtime surprise: a lens brief is one of seven
 * near-duplicates of the default brief and a compare page is one of millions of
 * pairs, so neither is ever the canonical URL of anything. Both are served,
 * both are followed, and both point their canonical elsewhere.
 */
export type CanonicalTarget = "page" | "brief" | "lens" | "compare";

export function canonicalOf(scope: PlaceScope, kind: CanonicalTarget): string {
  switch (kind) {
    case "page":
      return absoluteUrl(scopePath(scope));
    case "brief":
      return absoluteUrl(scopeBriefPath(scope));
    default:
      throw new Error(
        `canonicalOf: a ${kind === "lens" ? "lens brief" : "compare page"} is never a canonical target; canonicalise it to the place page or the default brief instead`,
      );
  }
}

/** A count for a hub page's description, so the hubs are specific too. */
export function hubDescription(what: string, n: number): string {
  return `${num(n)} ${what}, each with housing, jobs and the source of every figure.`;
}
