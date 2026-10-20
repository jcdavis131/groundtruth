// Running cite-check over a batch: live (one request per unique record URL, gated per host, capped) or against recorded replies.
// The CLI (scripts/cite-check.mjs) and the tests both go through here.

import { classify, plan, summarize, type Summary } from "./citeCheck";
import { fetchPublisher, MAX_REQUESTS, type FetchDeps } from "./fetch";
import { recordedFor, toReply } from "./recorded";
import type { CiteItem, PublisherReply, Verdict } from "./types";

export interface LiveResult {
  verdicts: Verdict[];
  summary: Summary;
  /** Requests actually made, per host. */
  byHost: Record<string, number>;
  requests: number;
}

/**
 * Check every item against the publisher, live. An item whose plan is refused, or that has no record URL, costs no request.
 * Items sharing a record URL share one request. Hosts are worked in parallel, each one request at a time behind the gate.
 * Past `maxRequests` the remaining URLs are not fetched and their items are UNREACHABLE ("unscored"), never wrong.
 */
export async function runLive(items: CiteItem[], deps: FetchDeps & { maxRequests?: number }): Promise<LiveResult> {
  const cap = deps.maxRequests ?? MAX_REQUESTS;
  const urls = new Map<string, string>(); // url -> host
  for (const it of items) {
    const p = plan(it);
    if (!("refused" in p) && !urls.has(p.url)) urls.set(p.url, new URL(p.url).host);
  }
  const hosts = new Map<string, string[]>();
  for (const [u, h] of urls) hosts.set(h, [...(hosts.get(h) ?? []), u]);
  const replies = new Map<string, PublisherReply>();
  const byHost: Record<string, number> = {};
  let requests = 0;
  await Promise.all(
    [...hosts].map(async ([host, list]) => {
      for (const u of list) {
        if (requests >= cap) {
          replies.set(u, { status: 0, body: "", fetchedAt: new Date(deps.clock.now()).toISOString(), error: `request cap (${cap}) reached; not fetched` });
          continue;
        }
        requests++; // counted before the await, so parallel hosts cannot overshoot the cap
        byHost[host] = (byHost[host] ?? 0) + 1;
        replies.set(u, await fetchPublisher(u, deps));
      }
    }),
  );
  const verdicts = items.map((it) => {
    const p = plan(it);
    return classify(it, "refused" in p ? { status: 0, body: "", fetchedAt: new Date(deps.clock.now()).toISOString() } : (replies.get(p.url) as PublisherReply));
  });
  return { verdicts, summary: summarize(verdicts), byHost, requests };
}

export interface RecordedResult {
  verdicts: Verdict[];
  summary: Summary;
  /** Items that have a record URL and a matcher but no recorded reply: not scored, listed so nothing is skipped silently. */
  unrecorded: CiteItem[];
}

/** Check every item against the recorded publisher replies. No network. */
export function runRecorded(items: CiteItem[]): RecordedResult {
  const verdicts: Verdict[] = [];
  const unrecorded: CiteItem[] = [];
  for (const it of items) {
    const p = plan(it);
    if (!("refused" in p)) {
      const rec = recordedFor(it.sourceId, p.url);
      if (!rec) {
        unrecorded.push(it);
        continue;
      }
      verdicts.push(classify(it, toReply(rec)));
    } else verdicts.push(classify(it, { status: 0, body: "", fetchedAt: "" }));
  }
  return { verdicts, summary: summarize(verdicts), unrecorded };
}
