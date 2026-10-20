// Shared types for cite-check: a verifier that resolves an item as world_context emits it against the
// publisher's own keyed record. Relative imports only, so scripts can load lib/cite without a bundler.

/** The fields of a world_context item the verifier reads (a WorldItem has these and more). */
export interface CiteItem {
  fact: string;
  value: string | number | boolean | null;
  unit?: string;
  code?: string;
  period?: string;
  note?: string;
  point?: [number, number];
  sourceId: string;
  upstreamRecordUrl?: string;
  retrievedAt: string;
  kind?: string;
}

/** The six outcomes, plus REFUSED: the plan refused the item, so nothing was fetched. */
export type VerdictStatus = "CONFIRMED" | "CONTRADICTED" | "CHANGED_SINCE_RETRIEVAL" | "NOT_PUBLISHED" | "UNREACHABLE" | "NO_RECORD_URL" | "REFUSED";

export type Scalar = string | number | boolean | null;

export interface Verdict {
  status: VerdictStatus;
  sourceId: string;
  fact: string;
  /** What the item claimed. */
  itemValue: Scalar;
  /** What the publisher's record says for the compared field; null when there was no readable record. */
  publisherValue: Scalar;
  /** The publisher's own period or release for that value, when its record carries one. */
  period: string | null;
  recordUrl: string | null;
  fetchedAt: string | null;
  /** sha256 (hex) of the body the verdict rests on; never null on CONFIRMED. */
  sha256: string | null;
  matcherId: string | null;
  /** The field compared and the tolerance applied, or why there was no comparison. */
  reason: string;
}

/** What came back from the publisher (or a recorded fixture of it). */
export interface PublisherReply {
  /** HTTP status; 0 for a network failure or timeout. */
  status: number;
  /** The body as text ("" when there was none). */
  body: string;
  /** ISO time the reply was fetched (or recorded). */
  fetchedAt: string;
  /** sha256 of the full body as received. A recorded fixture may keep only part of the body, so it carries the full body's hash. */
  sha256?: string;
  /** Network error text, when status is 0. */
  error?: string;
}

/** What a matcher read out of a publisher body for one item. */
export type Reading =
  | {
      kind: "value";
      /** The field the item's value is compared with (a key in the matcher's `tolerance`). */
      field: string;
      publisherValue: Scalar;
      /** The item's value after the matcher puts it in the publisher's form. */
      itemValue: Scalar;
      /** The publisher's period or release for this row, if the record carries one. */
      period: string | null;
      /** True when that period or release is later than the one the item states. */
      later: boolean;
      /** Extra fields that must also agree: name, value, publisher's value. Any difference is CONTRADICTED. */
      also?: Array<{ field: string; item: Scalar; publisher: Scalar }>;
    }
  | { kind: "suppressed"; reason: string; period: string | null }
  | { kind: "absent"; reason: string }
  | { kind: "unreadable"; reason: string };

export interface Matcher {
  id: string;
  sourceId: string;
  /** Allowed absolute difference per compared field; 0 for codes, ids, dates and counts. */
  tolerance: Record<string, number>;
  read(item: CiteItem, body: string, url: string): Reading;
}

export interface Plan {
  url: string;
  matcherId: string;
}

export interface Refused {
  refused: string;
}
