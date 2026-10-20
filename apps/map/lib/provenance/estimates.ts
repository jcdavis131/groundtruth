// The rule behind "published = relayed as-is; estimate = computed here" (types.ts), as a check a test can run
// over any JSON a reply carries: a provenance entry labelled published must not say its value was computed here,
// and an estimate must name the inputs it was computed from.
//
// Two ways an entry is caught:
//   - kind "published" with a method that says it was computed (whole words: computed, aggregate, sum, count,
//     derived and their inflections; "county" and "summary" are not "count" and "sum");
//   - kind "published" with `inputs`: an entry that names what it was computed from is not relayed as-is.
// The words are a heuristic and a method that computes without saying so ("changeAbs = after - before") passes;
// the second way and a reviewer cover that. Nothing here reads the network or the clock. Relative imports only,
// so a plain-Node script can load it (see scripts/cite-load.mjs).

import type { Provenance } from "./types";

/** Method text that says a value was computed here. Whole words, so "county" and "summary" do not match. */
export const COMPUTED_METHOD = /\b(compute[sd]?|computing|computation|aggregate[sd]?|aggregating|aggregation|sums?|summed|summing|counts?|counted|counting|derive[sd]?|deriving|calculate[sd]?|calculating)\b/i;

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

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A provenance entry as it is serialised in a reply: a source with an id, and retrievedAt. */
function entryOf(v: Record<string, unknown>): { sourceId: string; kind: unknown; method: unknown; inputs: unknown } | null {
  const source = v.source;
  if (!isObj(source) || typeof source.id !== "string" || typeof v.retrievedAt !== "string") return null;
  return { sourceId: source.id, kind: v.kind, method: v.method, inputs: v.inputs };
}

/**
 * Walk any JSON (a fixture, a reply, an envelope) and judge every provenance-shaped object in it. The scan also says
 * how many entries it looked at, so a test can tell a clean walk from a walk that found nothing to judge.
 */
export function scanProvenance(value: unknown): ProvenanceScan {
  const out: ProvenanceScan = { entries: 0, labelled: 0, findings: [] };
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}[${i}]`));
      return;
    }
    if (!isObj(v)) return;
    const e = entryOf(v);
    if (e) {
      out.entries++;
      if (typeof e.kind === "string") out.labelled++;
      if (e.kind === "published") {
        if (typeof e.method === "string" && COMPUTED_METHOD.test(e.method)) {
          out.findings.push({ path: at, sourceId: e.sourceId, why: `labelled published, but its method says it was computed here: "${e.method.slice(0, 120)}"` });
        } else if (Array.isArray(e.inputs) && e.inputs.length > 0) {
          out.findings.push({ path: at, sourceId: e.sourceId, why: `labelled published, but it names ${e.inputs.length} input(s) it was computed from` });
        }
      }
    }
    for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
  };
  walk(value, "");
  return out;
}

/** Entries labelled published whose method says they were computed here, or that name inputs. */
export function computedAsPublished(value: unknown): EstimateFinding[] {
  return scanProvenance(value).findings;
}

/** Estimate entries that name no inputs. A list of entries, as a reply's `provenance` array. */
export function estimatesWithoutInputs(entries: Provenance[]): EstimateFinding[] {
  const out: EstimateFinding[] = [];
  entries.forEach((p, i) => {
    if (p.kind === "estimate" && !(p.inputs && p.inputs.length > 0)) out.push({ path: `provenance[${i}]`, sourceId: p.source.id, why: "an estimate with no inputs: it does not say what it was computed from" });
  });
  return out;
}
