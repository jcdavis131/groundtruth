// cite-check: resolve an item as world_context emits it against the publisher's own keyed record.
//
//   plan(item)             -> {url, matcherId}, or {refused: reason} (then nothing is fetched)
//   classify(item, reply)  -> a Verdict, from the publisher's reply (live, or a recorded fixture of it)
//
// Pure: no network, no clock. Fetching is in ./fetch and ./live. Outcomes:
//   CONFIRMED                the publisher's record states what the item states (within the matcher's declared tolerance)
//   CONTRADICTED             the record states something else for the same period, or has no such record
//   CHANGED_SINCE_RETRIEVAL  the record now carries a later period or release than the item states
//   NOT_PUBLISHED            the publisher's own suppression flag (QCEW disclosure_code N, NRI "Insufficient Data", CMS "Not Available")
//   UNREACHABLE              403, 429, 5xx, 404, a timeout, an empty or unreadable reply: unscored, never wrong
//   NO_RECORD_URL            the item carries no record URL (or its record expires): not machine-verifiable
//   REFUSED                  plan() refused the item (host not in the table, a required id absent from the URL): nothing was fetched
// A verdict is never CONFIRMED without a sha256 of the body it rests on.

import { sha256Hex } from "./fetch";
import { refusal } from "./hosts";
import { MATCHERS } from "./matchers";
import type { CiteItem, Plan, PublisherReply, Refused, Scalar, Verdict, VerdictStatus } from "./types";

export { MATCHERS } from "./matchers";
export type { CiteItem, Plan, PublisherReply, Refused, Verdict, VerdictStatus } from "./types";

export function plan(item: CiteItem): Plan | Refused {
  const url = item.upstreamRecordUrl;
  if (!url) return { refused: "the item has no record URL" };
  const why = refusal(item);
  if (why) return { refused: why };
  const matcher = MATCHERS[item.sourceId];
  if (!matcher) return { refused: `no matcher for source ${item.sourceId}` };
  return { url, matcherId: matcher.id };
}

function verdict(item: CiteItem, status: VerdictStatus, extra: Partial<Verdict> & { reason: string }): Verdict {
  return {
    status,
    sourceId: item.sourceId,
    fact: item.fact,
    itemValue: item.value,
    publisherValue: null,
    period: null,
    recordUrl: item.upstreamRecordUrl ?? null,
    fetchedAt: null,
    sha256: null,
    matcherId: MATCHERS[item.sourceId]?.id ?? null,
    ...extra,
  };
}

/** Equal within `tol`: numbers by absolute difference, everything else exactly. */
function same(a: Scalar, b: Scalar, tol: number): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= tol + 1e-9;
  return a === b;
}

export function classify(item: CiteItem, reply: PublisherReply): Verdict {
  if (!item.upstreamRecordUrl) return verdict(item, "NO_RECORD_URL", { reason: "the item has no record URL" });
  const p = plan(item);
  if ("refused" in p) {
    return verdict(item, /NWS alert/.test(item.fact) ? "NO_RECORD_URL" : "REFUSED", { reason: p.refused });
  }
  const matcher = MATCHERS[item.sourceId];
  const base = { fetchedAt: reply.fetchedAt };
  if (reply.status === 0) return verdict(item, "UNREACHABLE", { ...base, reason: `no answer: ${reply.error ?? "network failure"}` });
  if (reply.status !== 200) return verdict(item, "UNREACHABLE", { ...base, reason: `HTTP ${reply.status}${reply.status === 403 || reply.status === 429 ? " (the publisher refuses this client)" : ""}` });
  if (reply.body.trim() === "") return verdict(item, "UNREACHABLE", { ...base, reason: "HTTP 200 with an empty body" });
  const sha = reply.sha256 ?? sha256Hex(reply.body);
  const withSha = { ...base, sha256: sha };
  const reading = matcher.read(item, reply.body, p.url);
  if (reading.kind === "unreadable") return verdict(item, "UNREACHABLE", { ...withSha, reason: `unreadable reply (the publisher's shape did not match the matcher): ${reading.reason}` });
  if (reading.kind === "absent") return verdict(item, "CONTRADICTED", { ...withSha, reason: `no such record: ${reading.reason}` });
  if (reading.kind === "suppressed") return verdict(item, "NOT_PUBLISHED", { ...withSha, period: reading.period, reason: reading.reason });
  if (reading.publisherValue === null) return verdict(item, "UNREACHABLE", { ...withSha, reason: `unreadable reply: the record has no ${reading.field}` });
  const tol = (f: string) => matcher.tolerance[f] ?? 0;
  const main = same(reading.itemValue, reading.publisherValue, tol(reading.field));
  const diffs = (reading.also ?? []).filter((a) => !same(a.item, a.publisher, tol(a.field)));
  const shown = { ...withSha, publisherValue: reading.publisherValue, period: reading.period };
  if (reading.later) return verdict(item, "CHANGED_SINCE_RETRIEVAL", { ...shown, reason: `the publisher's record now carries ${reading.period}, later than the item's ${item.period ?? item.retrievedAt}` });
  if (main && diffs.length === 0) return verdict(item, "CONFIRMED", { ...shown, reason: `${reading.field} equals the publisher's (tolerance ${tol(reading.field)})` });
  const parts = [
    ...(main ? [] : [`${reading.field}: item ${JSON.stringify(reading.itemValue)}, publisher ${JSON.stringify(reading.publisherValue)} (tolerance ${tol(reading.field)})`]),
    ...diffs.map((d) => `${d.field}: item ${JSON.stringify(d.item)}, publisher ${JSON.stringify(d.publisher)} (tolerance ${tol(d.field)})`),
  ];
  return verdict(item, "CONTRADICTED", { ...shown, reason: parts.join("; ") });
}

export interface Summary {
  total: number;
  byStatus: Record<VerdictStatus, number>;
  /** CONFIRMED verdicts. */
  confirmed: number;
  /** CONTRADICTED verdicts: the only ones that count as the item being wrong. */
  wrong: number;
  /** Verdicts the publisher's record could score: confirmed, wrong, changed since, not published. */
  scored: number;
  /** UNREACHABLE, NO_RECORD_URL and REFUSED: unscored, in neither the confirmed nor the wrong total. */
  unscored: number;
}

const STATUSES: VerdictStatus[] = ["CONFIRMED", "CONTRADICTED", "CHANGED_SINCE_RETRIEVAL", "NOT_PUBLISHED", "UNREACHABLE", "NO_RECORD_URL", "REFUSED"];

export function summarize(verdicts: Verdict[]): Summary {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<VerdictStatus, number>;
  for (const v of verdicts) byStatus[v.status]++;
  return {
    total: verdicts.length,
    byStatus,
    confirmed: byStatus.CONFIRMED,
    wrong: byStatus.CONTRADICTED,
    scored: byStatus.CONFIRMED + byStatus.CONTRADICTED + byStatus.CHANGED_SINCE_RETRIEVAL + byStatus.NOT_PUBLISHED,
    unscored: byStatus.UNREACHABLE + byStatus.NO_RECORD_URL + byStatus.REFUSED,
  };
}
