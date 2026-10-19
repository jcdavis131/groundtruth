// The Ask Jev panel's view of a world_context reply (lib/mcp/world.ts): the
// same bundle agents get over MCP, laid out for a person through fixed
// templates. No model writes anything here and nothing is added to the reply.
//
// Rules (writeups jev-2026-10-18: ASK-PANEL-SPEC.md, as amended by
// ASK-PANEL-DATA-AUDIT.md):
//   - One line per item: the value, or the item's note when the value is null
//     (a private dam's withheld name, a hospital CMS gives no rating). A null
//     is never drawn as 0 and is not a gap.
//   - Only topics[t].missing entries become gap sentences: what, then why,
//     the why mapped to a plain sentence by lib/jev/plain.ts (fixed patterns
//     from ASK-PANEL-PLAIN-TEXT.md; an unmatched reason is shown as written).
//   - Notes, publishers and the point's basis go through the same plain layer,
//     and acronyms are spelled out on first use (lib/jev/glossary.ts).
//   - A list cut at max_records says so ("3 of 7 hospitals shown."), and a
//     reply world_context trimmed for size says so once.
//   - A topic gets a "partial" marker only when it has missing entries. Every
//     reply's top-level coverageStatus says partial, so a panel-wide badge
//     would show every time and mean nothing: there is none.
//   - Every line links its source: upstreamRecordUrl (the publisher's own URL
//     for that record), else link (the eye route that reproduces it).

import type { WorldItem, WorldSection } from "@/lib/mcp/world";
import { cutSentences, plainBasis, plainNote, plainPublisher, plainReason, plainWhat, truncatedSentence } from "./plain";

/** The sections the panel shows, in order. world_context's fabric and collections topics are not asked for. */
export const JEV_SECTIONS = ["identity", "hazards", "economy", "vulnerability", "institutions", "water", "freshness"] as const;
export type JevSectionKey = (typeof JEV_SECTIONS)[number];

/** The topics the panel asks world_context for (identity always comes). */
export const JEV_TOPICS = JEV_SECTIONS.filter((s) => s !== "identity");

export const JEV_TITLES: Record<JevSectionKey, string> = {
  identity: "Where this is",
  hazards: "Hazards",
  economy: "Economy",
  vulnerability: "Vulnerability",
  institutions: "Institutions",
  water: "Water",
  freshness: "Next releases",
};

/** world_context's reply payload, as much of it as the panel reads. */
export interface JevBundle {
  place?: {
    kind?: string;
    name?: string | null;
    countyFips?: string | null;
    stateFips?: string | null;
    usps?: string;
    point?: { lon?: number; lat?: number; basis?: string } | null;
  };
  topics?: Partial<Record<string, WorldSection>>;
  /** Set when world_context dropped items to stay under its size limit. */
  truncated?: { droppedItems?: number; note?: string };
  error?: string;
}

export interface JevLine {
  fact: string;
  /** The value as words, or the item's note (in plain words) when the value is null. */
  text: string;
  /** A record id shown on the line where the value is withheld: a private dam's NID id ("NID id AL00011"). */
  id?: string;
  /** True when `text` is the item's note standing in for a null value. */
  fromNote: boolean;
  /** The item's note beside a real value, in plain words (context such as "score 95.2 (percentile ...)"). */
  note?: string;
  publisher: string;
  /** The period the value is for, as the source states it ("2026 Q1"). */
  period?: string;
  /** When eye retrieved it: the date part of retrievedAt. */
  asOf: string;
  /** upstreamRecordUrl, else link. */
  href: string;
  /** A claim about eye's own catalogue rather than the world. */
  aboutEye: boolean;
}

export interface JevGap {
  /** What is missing, in plain words (lib/jev/plain.ts plainWhat). */
  what: string;
  reason: string;
  /** The pattern that wrote the sentence (lib/jev/plain.ts), or null when the reason is shown as written. */
  rule: string | null;
  /** The plain sentence shown: what, then why. */
  sentence: string;
}

export interface JevSection {
  key: JevSectionKey;
  title: string;
  lines: JevLine[];
  gaps: JevGap[];
  /** Lists cut at max_records, as sentences ("3 of 7 hospitals shown."). */
  cuts: string[];
  /** The partial-coverage marker, only when the topic has missing entries. */
  marker: string | null;
}

export function valueText(v: Exclude<WorldItem["value"], null>, unit?: string): string {
  const base = typeof v === "number" ? v.toLocaleString("en-US") : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  return unit ? `${base} ${unit}` : base;
}

/** The source link for an item: the publisher's record URL, else eye's route. */
export function sourceHref(it: Pick<WorldItem, "upstreamRecordUrl" | "link">): string {
  return it.upstreamRecordUrl || it.link;
}

export function toLine(it: WorldItem): JevLine {
  const isNull = it.value === null || it.value === undefined;
  const line: JevLine = {
    fact: it.fact,
    text: isNull ? (it.note ? plainNote(it.note) : "the source states no value here") : valueText(it.value as Exclude<WorldItem["value"], null>, it.unit),
    fromNote: isNull,
    publisher: plainPublisher(it.publisher),
    asOf: (it.retrievedAt ?? "").slice(0, 10),
    href: sourceHref(it),
    aboutEye: it.kind === "about-eye",
  };
  if (!isNull && it.note) line.note = plainNote(it.note);
  if (isNull && it.code?.startsWith("nid:")) line.id = `NID id ${it.code.slice(4)}`;
  if (it.period) line.period = it.period;
  return line;
}

export function toGap(m: { what: string; reason: string }): JevGap {
  const p = plainReason(m.what, m.reason);
  const what = plainWhat(m.what);
  return { what, reason: m.reason, rule: p.rule, sentence: `${what}: ${p.text}` };
}

export function gapSentence(m: { what: string; reason: string }): string {
  return toGap(m).sentence;
}

export function toSection(key: JevSectionKey, sec: WorldSection | undefined): JevSection {
  const missing = sec?.missing ?? [];
  const gaps = missing.map(toGap);
  return {
    key,
    title: JEV_TITLES[key],
    lines: (sec?.items ?? []).map(toLine),
    gaps,
    cuts: cutSentences(sec?.coverageStatus?.basis),
    marker: gaps.length ? `partial: ${gaps.length === 1 ? "1 thing" : `${gaps.length} things`} not shown (${gaps.map((g) => g.what).join("; ")})` : null,
  };
}

/** The panel's sections for a reply, in JEV_SECTIONS order; topics the reply does not carry are left out. */
export function jevSections(b: JevBundle): JevSection[] {
  const topics = b.topics ?? {};
  return JEV_SECTIONS.filter((k) => topics[k]).map((k) => toSection(k, topics[k]));
}

/** The reply-wide note when world_context trimmed the answer for size, else null. */
export function truncatedNote(b: JevBundle): string | null {
  return b.truncated ? truncatedSentence(b.truncated) : null;
}

/** What the panel's status line says (read out by screen readers): short, never the whole answer. */
export function jevStatusLine(status: "idle" | "loading" | "done" | "error", b: JevBundle | null): string {
  if (status === "loading") return "Asking Jev…";
  if (status === "error") return "No answer for this place.";
  if (status !== "done" || !b) return "";
  const secs = jevSections(b);
  const facts = secs.reduce((n, s) => n + s.lines.length, 0);
  const gaps = secs.reduce((n, s) => n + s.gaps.length, 0);
  return `Answer loaded: ${facts} ${facts === 1 ? "fact" : "facts"}, ${gaps} ${gaps === 1 ? "gap" : "gaps"}`;
}

/**
 * What the panel says when the call fails, whatever the reason. The raw reason
 * (a tool or server message) is for us, not the visitor: it goes to the console
 * and a data attribute only.
 */
export const JEV_ERROR_SENTENCE = "Jev couldn't reach its sources just now. Try again in a minute.";

/** The panel's heading for a reply: the place's name from the reply itself, else its point. */
export function placeTitle(b: JevBundle): string {
  const p = b.place;
  if (p?.name) return p.name;
  const pt = p?.point;
  if (pt && typeof pt.lat === "number" && typeof pt.lon === "number") return `${pt.lat.toFixed(4)}, ${pt.lon.toFixed(4)}`;
  return "this place";
}

const KIND_WORDS: Record<string, string> = { county: "county", state: "state", point: "point", bbox: "box" };

export function placeSubtitle(b: JevBundle): string | null {
  const p = b.place;
  if (!p) return null;
  const parts = [p.kind ? KIND_WORDS[p.kind] ?? p.kind : null, p.countyFips ? `FIPS ${p.countyFips}` : p.stateFips && p.kind === "state" ? `FIPS ${p.stateFips}` : null, plainBasis(p.point?.basis)];
  const s = parts.filter(Boolean).join(" · ");
  return s || null;
}
