// Reads the reconciled set (`final`) of a plan file (writeups/jev-2026-10-18/eval-v3/regrade/grades.json) and compares, per fact, "the
// publisher returned a record at the fact's link" with the reconciler's upstreamConfirmed. This is record existence,
// not a value check: the facts in that file are prose, not structured items. scripts/cite-grades.mjs drives it live.

import { RECORD_HOSTS } from "./hosts";
import type { PublisherReply } from "./types";

export interface GradeFact {
  plan: string;
  fact: string;
  link: string;
  sourceId: string;
  upstreamConfirmed: boolean;
  wrong: boolean;
}
export interface UrlRow {
  url: string;
  sourceId: string;
  facts: GradeFact[];
}
export type Outcome = "agree" | "disagree" | "unreachable";
export interface FactOutcome {
  fact: GradeFact;
  outcome: Outcome;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** upstream_publisher facts whose link is on a host in the table (hosts.ts), in file order. Anything else is not measured. */
export function inTableFacts(grades: unknown): GradeFact[] {
  const plans = isObj(grades) && Array.isArray(grades.result) ? grades.result : [];
  const out: GradeFact[] = [];
  for (const p of plans) {
    const facts = isObj(p) && isObj(p.final) && Array.isArray(p.final.facts) ? p.final.facts : [];
    for (const f of facts) {
      if (!isObj(f) || f.citeType !== "upstream_publisher" || typeof f.link !== "string") continue;
      const link = f.link;
      const sourceId = Object.keys(RECORD_HOSTS).find((s) => RECORD_HOSTS[s].test(link));
      if (!sourceId) continue;
      out.push({ plan: String((p as Record<string, unknown>).id), fact: String(f.fact), link, sourceId, upstreamConfirmed: f.upstreamConfirmed === true, wrong: f.wrong === true });
    }
  }
  return out;
}

/** One row per unique link, in first-seen order. */
export function byUrl(facts: GradeFact[]): UrlRow[] {
  const rows = new Map<string, UrlRow>();
  for (const f of facts) {
    const r = rows.get(f.link) ?? { url: f.link, sourceId: f.sourceId, facts: [] };
    r.facts.push(f);
    rows.set(f.link, r);
  }
  return [...rows.values()];
}

/** HTTP 200, a non-empty body, and not an ArcGIS 200-with-error object (that is the backend failing, not a record). */
export function recordReturned(reply: PublisherReply): boolean {
  return reply.status === 200 && reply.body.trim() !== "" && !/^\s*\{\s*"error"\s*:/.test(reply.body);
}

/** agree / disagree are decided only where a record came back; a link with no record (or no reply) is unreachable and counted neither way. */
export function compare(rows: UrlRow[], replies: Map<string, PublisherReply>): FactOutcome[] {
  const out: FactOutcome[] = [];
  for (const r of rows) {
    const rep = replies.get(r.url);
    const got = rep !== undefined && recordReturned(rep);
    for (const fact of r.facts) out.push({ fact, outcome: !got ? "unreachable" : fact.upstreamConfirmed ? "agree" : "disagree" });
  }
  return out;
}
