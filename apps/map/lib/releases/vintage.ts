// Which release of each upstream table is loaded right now. Pure: the route
// assembles a plain inputs object from lib/economy/sources.ts and the water
// route's caches, and this file turns it into records a panel or a script can
// read. Nothing here fetches.
//
// A vintage has two dates that are often confused:
//   period     what the newest value describes ("2026-07" for a Zillow month,
//              "2026 Q1" for QCEW). Read straight from the loaded table.
//   released   when the publisher put that value out. Most of the tables we
//              relay do not carry a publication stamp, so this is the last
//              calendar window before we fetched, labelled basis "rule". It
//              is never a single day unless the calendar entry is official.

import { effectivePrecision, findEntry, lastReleaseBefore, nextReleaseAfter, parseRule, type ReleaseEntry, type ReleaseWindow } from "./calendar";

export interface TableVintage {
  /** ISO 8601 time the table was read (from cache or upstream). */
  retrievedAt: string;
}

export interface VintageInputs {
  /** Zillow tables by file kind; `asOf` is the last month column ("2026-07-31"). */
  zillow?: Array<TableVintage & { kind: string; asOf: string; rows?: number }>;
  /** BLS QCEW newest quarter as the reader found it. */
  qcew?: TableVintage & { period: string; year: number; qtr: number; counties?: number };
  /** BTS border crossings: newest month key ("2026-06"). */
  border?: TableVintage & { asOf: string; ports?: number };
  /** BTS Port Performance: newest reporting year. */
  ports?: TableVintage & { year: number; ports?: number };
  /** FRED series: newest observation date each. */
  fred?: Array<TableVintage & { id: string; date: string; label?: string }>;
  /** BTS supply chain indicators: newest observation date each. */
  btsIndicators?: Array<TableVintage & { id: string; date: string; label?: string }>;
  /** USDM current map; the feature service does not carry a map date unless the route asked for it. */
  usdm?: TableVintage & { mapDate?: string };
  /** World Bank: newest year per indicator code. */
  worldBank?: TableVintage & { years: Record<string, string> };
  /** WITS: newest year answered for a reporter. */
  wits?: TableVintage & { year: number; iso3?: string };
  /** "Now" for rule evaluation; defaults to the newest retrievedAt seen. */
  now?: string;
}

export interface VintageRecord {
  /** Calendar entry id when one exists ("fred:UNRATE"), else the source id. */
  id: string;
  sourceId: string;
  seriesId?: string;
  title: string;
  /** The period the newest loaded value describes, normalised ("2026-07", "2026 Q1", "2025", "2026-09-04"). */
  period: string | null;
  /** The publisher's own stamp when the table carries one. */
  releasedAt?: string;
  /** Otherwise the last calendar window before retrieval; earliest === latest for official rules. */
  releaseWindow?: ReleaseWindow;
  /** Where the release date came from. */
  basis: "table" | "rule" | "unknown";
  precision?: "official" | "approximate";
  retrievedAt: string;
  /** The next expected window after retrieval, when the rule can say. */
  nextWindow?: ReleaseWindow;
  /** True when a whole window has passed since the loaded table was read and a newer release should exist. */
  maybeStale: boolean;
  rows?: number;
  scheduleUrl?: string;
  notes: string[];
}

function iso(d: string): string {
  return d.length >= 10 ? d.slice(0, 10) : d;
}

/** Month-end Zillow columns ("2026-07-31") to a month key. */
export function zillowPeriod(asOf: string): string {
  const m = asOf.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : asOf;
}

/** "2026 Q1" or "2026-Q1" to the canonical "2026 Q1"; anything else unchanged. */
export function qcewPeriod(period: string): string {
  const m = period.match(/^(\d{4})[\s-]?Q([1-4])$/i);
  return m ? `${m[1]} Q${m[2]}` : period;
}

function describeOne(
  entry: ReleaseEntry | undefined,
  fallback: { id: string; sourceId: string; seriesId?: string; title: string },
  period: string | null,
  retrievedAt: string,
  now: string,
  extra: { releasedAt?: string; rows?: number; notes?: string[] } = {},
): VintageRecord {
  const notes = [...(extra.notes ?? [])];
  const base = {
    id: entry?.id ?? fallback.id,
    sourceId: entry?.sourceId ?? fallback.sourceId,
    seriesId: entry?.seriesId ?? fallback.seriesId,
    title: entry?.title ?? fallback.title,
    period,
    retrievedAt,
    rows: extra.rows,
    scheduleUrl: entry?.scheduleUrl,
  };
  if (extra.releasedAt) {
    return { ...base, releasedAt: iso(extra.releasedAt), basis: "table", precision: "official", maybeStale: false, notes };
  }
  if (!entry) {
    notes.push("No calendar entry for this source; add one to lib/releases/calendar.ts to get release windows.");
    return { ...base, basis: "unknown", maybeStale: false, notes };
  }
  const rule = parseRule(entry.rule);
  const precision = effectivePrecision(entry);
  const slack = precision === "approximate" ? (entry.slackDays ?? 0) : 0;
  if (rule.cadence === "continuous") {
    return { ...base, basis: "rule", precision, maybeStale: false, notes: [...notes, "Continuous feed; the newest value is as recent as the last fetch."] };
  }
  const releaseWindow = lastReleaseBefore(rule, retrievedAt, slack);
  const nextWindow = nextReleaseAfter(rule, retrievedAt, slack);
  // Stale when the whole next window has already gone by since we read the table.
  const maybeStale = nextWindow.latest < iso(now);
  if (precision === "approximate") notes.push(`Release date is inferred from the rule "${entry.rule}"; the publisher may have released anywhere in the window.`);
  else notes.push(`Release date inferred from the publisher's posted cadence ("${entry.rule}").`);
  if (entry.covers) notes.push(`A release covers ${entry.covers}.`);
  return { ...base, releaseWindow, basis: "rule", precision, nextWindow, maybeStale, notes };
}

/**
 * Describe the vintage of every table in `inputs`. Order is stable: Zillow,
 * QCEW, BTS border, BTS ports, FRED (input order), BTS indicators, USDM,
 * World Bank, WITS. Tables absent from the inputs are simply absent.
 */
export function describeVintages(inputs: VintageInputs): VintageRecord[] {
  const out: VintageRecord[] = [];
  const stamps = [
    ...(inputs.zillow ?? []).map((z) => z.retrievedAt),
    inputs.qcew?.retrievedAt,
    inputs.border?.retrievedAt,
    inputs.ports?.retrievedAt,
    ...(inputs.fred ?? []).map((f) => f.retrievedAt),
    ...(inputs.btsIndicators ?? []).map((f) => f.retrievedAt),
    inputs.usdm?.retrievedAt,
    inputs.worldBank?.retrievedAt,
    inputs.wits?.retrievedAt,
  ].filter((s): s is string => !!s);
  const now = inputs.now ?? (stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : new Date(0).toISOString());

  for (const z of inputs.zillow ?? []) {
    const sourceId = z.kind.startsWith("zori") ? "zillow-zori" : "zillow-zhvi";
    const entry = findEntry(sourceId);
    const title = `${entry?.title ?? sourceId} · ${z.kind}`;
    out.push(describeOne(entry ? { ...entry, id: `${entry.id}:${z.kind}`, title } : undefined, { id: `${sourceId}:${z.kind}`, sourceId, title }, zillowPeriod(z.asOf), z.retrievedAt, now, { rows: z.rows }));
  }
  if (inputs.qcew) {
    const q = inputs.qcew;
    out.push(describeOne(findEntry("bls-qcew"), { id: "bls-qcew", sourceId: "bls-qcew", title: "BLS QCEW" }, qcewPeriod(q.period), q.retrievedAt, now, { rows: q.counties }));
  }
  if (inputs.border) {
    const b = inputs.border;
    out.push(describeOne(findEntry("bts-border"), { id: "bts-border", sourceId: "bts-border", title: "BTS border crossings" }, b.asOf.slice(0, 7), b.retrievedAt, now, { rows: b.ports }));
  }
  if (inputs.ports) {
    const p = inputs.ports;
    out.push(describeOne(findEntry("bts-ports"), { id: "bts-ports", sourceId: "bts-ports", title: "BTS port performance" }, String(p.year), p.retrievedAt, now, { rows: p.ports }));
  }
  for (const f of inputs.fred ?? []) {
    const entry = findEntry("fred", f.id);
    out.push(
      describeOne(entry, { id: `fred:${f.id}`, sourceId: "fred", seriesId: f.id, title: f.label ? `${f.label} (FRED ${f.id})` : `FRED ${f.id}` }, iso(f.date), f.retrievedAt, now, {
        notes: ["Period is the newest observation date FRED lists, not the release date."],
      }),
    );
  }
  for (const f of inputs.btsIndicators ?? []) {
    const entry = findEntry("bts-supply-chain");
    out.push(
      describeOne(entry ? { ...entry, id: `bts-supply-chain:${f.id}`, seriesId: f.id, title: f.label ? `${f.label} (BTS ${f.id})` : `BTS ${f.id}` } : undefined, { id: `bts-supply-chain:${f.id}`, sourceId: "bts-supply-chain", seriesId: f.id, title: f.label ?? f.id }, iso(f.date), f.retrievedAt, now, {
        notes: ["Period is the newest observation date in the Socrata table."],
      }),
    );
  }
  if (inputs.usdm) {
    const u = inputs.usdm;
    const entry = findEntry("usdm");
    if (u.mapDate) {
      out.push(describeOne(entry, { id: "usdm", sourceId: "usdm", title: "U.S. Drought Monitor" }, iso(u.mapDate), u.retrievedAt, now, { releasedAt: undefined, notes: ["Map date read from the feature service."] }));
    } else {
      // The USDM_current service we read returns only the DM class; the map date is
      // the Tuesday before the Thursday release, by the publisher's stated cycle.
      const rec = describeOne(entry, { id: "usdm", sourceId: "usdm", title: "U.S. Drought Monitor" }, null, u.retrievedAt, now, {
        notes: ["The current-map feature service answered without a map date; the period is the Tuesday before the release window (USDM cycle), not read from the table."],
      });
      if (rec.releaseWindow) {
        const thu = Date.parse(rec.releaseWindow.nominal + "T00:00:00Z");
        rec.period = new Date(thu - 2 * 86_400_000).toISOString().slice(0, 10);
      }
      out.push(rec);
    }
  }
  if (inputs.worldBank) {
    const w = inputs.worldBank;
    const years = Object.values(w.years).filter((y) => /^\d{4}$/.test(y));
    const newest = years.length ? years.reduce((a, b) => (a > b ? a : b)) : null;
    out.push(
      describeOne(findEntry("worldbank-wdi"), { id: "worldbank-wdi", sourceId: "worldbank-wdi", title: "World Bank WDI" }, newest, w.retrievedAt, now, {
        notes: Object.entries(w.years).map(([code, y]) => `${code}: newest year ${y}`),
      }),
    );
  }
  if (inputs.wits) {
    const t = inputs.wits;
    out.push(describeOne(findEntry("worldbank-wits"), { id: "worldbank-wits", sourceId: "worldbank-wits", title: "World Bank WITS" }, String(t.year), t.retrievedAt, now, { notes: t.iso3 ? [`Newest year answered for reporter ${t.iso3}.`] : [] }));
  }
  return out;
}
