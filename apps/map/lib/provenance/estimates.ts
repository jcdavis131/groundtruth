// STUB for the red commit: the exported shape the tests compile against, with no behaviour yet. The next commit
// replaces it with the rule (kind published and computed, or published with inputs, is a finding; an estimate
// names its inputs). Relative imports only, so a plain-Node script can load it (see scripts/cite-load.mjs).

import type { Provenance } from "./types";

/** Method text that says a value was computed here. Stub: matches nothing. */
export const COMPUTED_METHOD = /(?!)/;

export interface EstimateFinding {
  /** Where the entry sits in the value that was walked, e.g. `provenance[1]`. */
  path: string;
  /** The entry's source id. */
  sourceId: string;
  why: string;
}

export interface ProvenanceScan {
  /** Provenance-shaped objects seen: a source with an id, and retrievedAt. */
  entries: number;
  /** Of those, how many carry a kind at all. */
  labelled: number;
  findings: EstimateFinding[];
}

export function scanProvenance(value: unknown): ProvenanceScan {
  void value;
  return { entries: 0, labelled: 0, findings: [] };
}

export function computedAsPublished(value: unknown): EstimateFinding[] {
  return scanProvenance(value).findings;
}

export function estimatesWithoutInputs(entries: Provenance[]): EstimateFinding[] {
  void entries;
  return [];
}
