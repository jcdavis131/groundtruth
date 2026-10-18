// Reader for the RSU event calendar store (lib/rsu/data/events.jsonl).
// One JSON object per line, written by scripts/rsu-events.py.
// Empty until real Form 4 filings are parsed - never backfilled with
// synthetic events.

import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface RsuEvent {
  event_id: string;
  event_type: "grant" | "vest" | "sale" | "tax_withhold" | "disposition" | "projected_vest" | "other";
  event_date: string; // YYYY-MM-DD, when the transaction happened
  knowable_date: string; // YYYY-MM-DD, when it became public (filing date)
  knowable_estimated: boolean;
  issuer_cik: string;
  issuer_ticker: string;
  issuer_name: string;
  filer_name: string;
  filer_cik: string;
  shares: number | null;
  price: number | null;
  security_title: string;
  source: "form4" | "projected";
  confidence: "high" | "medium" | "low";
  provenance: { parser?: string; src_file?: string | null };
}

const STORE = join(process.cwd(), "lib", "rsu", "data", "events.jsonl");

let cache: RsuEvent[] | null = null;

export function allRsuEvents(): RsuEvent[] {
  if (cache) return cache;
  if (!existsSync(STORE)) {
    cache = [];
    return cache;
  }
  const out: RsuEvent[] = [];
  for (const line of readFileSync(STORE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RsuEvent);
    } catch {
      // skip malformed lines; the builder is the source of truth
    }
  }
  cache = out;
  return out;
}

export function rsuEventsFiltered(opts: {
  ticker?: string;
  from?: string;
  to?: string;
  type?: string;
}): RsuEvent[] {
  const t = (opts.ticker || "").toUpperCase();
  return allRsuEvents().filter((e) => {
    if (t && e.issuer_ticker.toUpperCase() !== t) return false;
    if (opts.from && e.event_date < opts.from) return false;
    if (opts.to && e.event_date > opts.to) return false;
    if (opts.type && e.event_type !== opts.type) return false;
    return true;
  });
}

export function rsuEventProvenance() {
  return {
    source: "SEC EDGAR Form 4 (via scripts/rsu-extract.py + scripts/rsu-events.py)",
    pulled: null as string | null,
    note: "Point-in-time event calendar. knowable_date is the filing date; use it, not event_date, for any analysis.",
  };
}
