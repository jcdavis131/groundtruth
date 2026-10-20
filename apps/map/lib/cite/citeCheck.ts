// STUB for the red run: says CONFIRMED for everything. The tests in citeCheck.test.ts must fail against it.

import { sha256Hex } from "./fetch";
import type { CiteItem, Matcher, Plan, PublisherReply, Refused, Verdict, VerdictStatus } from "./types";

export const MATCHERS: Record<string, Matcher> = {};
export type { CiteItem, Plan, PublisherReply, Refused, Verdict, VerdictStatus } from "./types";

export function plan(item: CiteItem): Plan | Refused {
  return item.upstreamRecordUrl ? { url: item.upstreamRecordUrl, matcherId: "stub" } : { refused: "the item has no record URL" };
}

export function classify(item: CiteItem, reply: PublisherReply): Verdict {
  return {
    status: "CONFIRMED",
    sourceId: item.sourceId,
    fact: item.fact,
    itemValue: item.value,
    publisherValue: item.value,
    period: null,
    recordUrl: item.upstreamRecordUrl ?? null,
    fetchedAt: reply.fetchedAt,
    sha256: reply.sha256 ?? sha256Hex(reply.body),
    matcherId: "stub",
    reason: "stub",
  };
}

export interface Summary {
  total: number;
  byStatus: Record<VerdictStatus, number>;
  confirmed: number;
  wrong: number;
  scored: number;
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
