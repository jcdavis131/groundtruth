// Release calendar: when each upstream table the app relays is expected to
// change. Data plus a small rule language, no network. Every rule is
// evaluated on UTC calendar dates so DST never shifts a window.
//
// A rule is a string:
//
//   daily                      every calendar day
//   daily:business             Monday to Friday
//   weekly:THU                 every Thursday (SUN..SAT)
//   monthly:day=17             the 17th, clamped to the month length
//   monthly:day~17             about the 17th, window +-3 days
//   monthly:day~17:tol=2       about the 17th, window +-2 days
//   monthly:days=14-21         somewhere between the 14th and the 21st
//   monthly:first-FRI          first Friday; second/third/fourth/last work too
//   quarterly:+150d            150 days after each quarter end, window +-10 days
//   quarterly:+150d:tol=14     same with a +-14 day window
//   annual:month=4             sometime in April
//   annual:month=4:day=15      exactly 15 April
//
// Rules with "~", "days=", a quarterly lag or a month-only annual are
// approximate by construction and always answer with a window that is wider
// than one day. A rule that lands on one day can still be marked
// "approximate" on its calendar entry (BLS moves the Employment Situation
// around holidays); the entry's `slackDays` then widens the window. Nothing
// here claims a single date for an approximate entry.

import type { SourceId } from "@/lib/provenance/sources";

export type Cadence = "continuous" | "daily" | "weekly" | "monthly" | "quarterly" | "annual";
export type Precision = "official" | "approximate";

/** ISO calendar dates (YYYY-MM-DD, UTC). For an official rule earliest === latest. */
export interface ReleaseWindow {
  earliest: string;
  latest: string;
  /** The rule's nominal date inside the window (the anchor the tolerance is applied to). */
  nominal: string;
}

export interface ReleaseEntry {
  /** Stable id for the calendar entry ("fred:MORTGAGE30US", "bls-qcew"). */
  id: string;
  sourceId: SourceId;
  seriesId?: string;
  title: string;
  cadence: Cadence;
  rule: string;
  /** "official" only when the publisher posts a schedule and the rule matches it. */
  precision: Precision;
  /** The publisher's own schedule page when one exists. */
  scheduleUrl?: string;
  /** What a release covers, relative to the release date ("previous month", "quarter ending ~5 months earlier"). */
  covers?: string;
  /** Extra +-days for approximate entries whose rule lands on one day. */
  slackDays?: number;
  notes?: string;
}

export interface Rule {
  cadence: Cadence;
  approximate: boolean;
  /** Days either side of the nominal date the window spans. */
  tolDays: number;
  /** Explicit day range inside a month ("days=14-21", "annual:month=4"). */
  span?: { fromDay: number; toDay: number };
  business?: boolean;
  dow?: number;
  nth?: number;
  day?: number;
  lagDays?: number;
  month?: number;
}

const DOW: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const NTH: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- dates (UTC only)

/** Start of the UTC day containing `d`, as epoch ms. Accepts Date, epoch ms or ISO text. */
export function utcDay(d: Date | number | string): number {
  const ms = typeof d === "number" ? d : typeof d === "string" ? Date.parse(d.length === 10 ? d + "T00:00:00Z" : d) : d.getTime();
  if (!Number.isFinite(ms)) throw new Error(`invalid date: ${String(d)}`);
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** YYYY-MM-DD for an epoch ms in UTC. */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

function nthDow(y: number, m0: number, dow: number, nth: number): number {
  if (nth > 0) {
    const first = new Date(Date.UTC(y, m0, 1)).getUTCDay();
    const day = 1 + ((dow - first + 7) % 7) + (nth - 1) * 7;
    return Date.UTC(y, m0, Math.min(day, daysInMonth(y, m0)));
  }
  const lastDay = daysInMonth(y, m0);
  const last = new Date(Date.UTC(y, m0, lastDay)).getUTCDay();
  return Date.UTC(y, m0, lastDay - ((last - dow + 7) % 7));
}

// ---------------------------------------------------------------- rule parsing

/** Parse a rule string; throws on anything it does not understand. */
export function parseRule(text: string): Rule {
  const parts = text.trim().split(":");
  const head = parts[0];
  const rest = parts.slice(1);
  const kv = (k: string) => rest.find((p) => p.startsWith(k + "="))?.slice(k.length + 1);
  const tol = kv("tol") != null ? Number(kv("tol")) : undefined;
  if (tol != null && (!Number.isInteger(tol) || tol < 0 || tol > 60)) throw new Error(`bad tol in rule "${text}"`);
  switch (head) {
    case "daily":
      return { cadence: "daily", approximate: false, tolDays: 0, business: rest.includes("business") };
    case "continuous":
      return { cadence: "continuous", approximate: false, tolDays: 0 };
    case "weekly": {
      const dow = DOW[rest[0] ?? ""];
      if (dow == null) throw new Error(`weekly rule needs a day of week: "${text}"`);
      return { cadence: "weekly", approximate: false, tolDays: 0, dow };
    }
    case "monthly": {
      const p = rest[0] ?? "";
      let m: RegExpMatchArray | null;
      if ((m = p.match(/^day=(\d{1,2})$/))) {
        const day = Number(m[1]);
        if (day < 1 || day > 31) throw new Error(`bad day in "${text}"`);
        return { cadence: "monthly", approximate: false, tolDays: 0, day };
      }
      if ((m = p.match(/^day~(\d{1,2})$/))) {
        const day = Number(m[1]);
        if (day < 1 || day > 31) throw new Error(`bad day in "${text}"`);
        return { cadence: "monthly", approximate: true, tolDays: tol ?? 3, day };
      }
      if ((m = p.match(/^days=(\d{1,2})-(\d{1,2})$/))) {
        const fromDay = Number(m[1]);
        const toDay = Number(m[2]);
        if (fromDay < 1 || toDay > 31 || fromDay > toDay) throw new Error(`bad day range in "${text}"`);
        return { cadence: "monthly", approximate: true, tolDays: 0, span: { fromDay, toDay } };
      }
      if ((m = p.match(/^(first|second|third|fourth|last)-([A-Z]{3})$/))) {
        const dow = DOW[m[2]];
        if (dow == null) throw new Error(`bad day of week in "${text}"`);
        return { cadence: "monthly", approximate: false, tolDays: 0, nth: NTH[m[1]], dow };
      }
      throw new Error(`unknown monthly rule "${text}"`);
    }
    case "quarterly": {
      const m = (rest[0] ?? "").match(/^\+(\d{1,3})d$/);
      if (!m) throw new Error(`quarterly rule needs "+Nd": "${text}"`);
      return { cadence: "quarterly", approximate: true, tolDays: tol ?? 10, lagDays: Number(m[1]) };
    }
    case "annual": {
      const month = Number(kv("month"));
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error(`annual rule needs month=1..12: "${text}"`);
      const dayText = kv("day");
      if (dayText != null) {
        const day = Number(dayText);
        if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error(`bad day in "${text}"`);
        return { cadence: "annual", approximate: false, tolDays: 0, month, day };
      }
      return { cadence: "annual", approximate: true, tolDays: 0, month, span: { fromDay: 1, toDay: 31 } };
    }
    default:
      throw new Error(`unknown rule "${text}"`);
  }
}

// ---------------------------------------------------------------- occurrences

/** Nominal release dates (epoch ms, UTC midnight) of a rule inside [fromMs, toMs], ascending. */
function nominalsBetween(rule: Rule, fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  const push = (ms: number) => {
    if (ms >= fromMs && ms <= toMs) out.push(ms);
  };
  const from = new Date(fromMs);
  const y0 = from.getUTCFullYear();
  const y1 = new Date(toMs).getUTCFullYear();
  switch (rule.cadence) {
    case "continuous":
    case "daily":
      for (let ms = fromMs; ms <= toMs; ms += DAY_MS) {
        const dow = new Date(ms).getUTCDay();
        if (rule.business && (dow === 0 || dow === 6)) continue;
        out.push(ms);
      }
      break;
    case "weekly": {
      const dow = rule.dow ?? 0;
      let ms = fromMs + ((dow - from.getUTCDay() + 7) % 7) * DAY_MS;
      for (; ms <= toMs; ms += 7 * DAY_MS) out.push(ms);
      break;
    }
    case "monthly":
      for (let y = y0; y <= y1; y++) {
        for (let m0 = 0; m0 < 12; m0++) {
          if (rule.span) push(Date.UTC(y, m0, Math.min(rule.span.fromDay, daysInMonth(y, m0))));
          else if (rule.nth != null && rule.dow != null) push(nthDow(y, m0, rule.dow, rule.nth));
          else push(Date.UTC(y, m0, Math.min(rule.day ?? 1, daysInMonth(y, m0))));
        }
      }
      break;
    case "quarterly":
      // Quarter ends are 31 Mar, 30 Jun, 30 Sep, 31 Dec; look one year back so a
      // long lag still yields the release that falls in the range.
      for (let y = y0 - 1; y <= y1; y++) {
        for (const m0 of [2, 5, 8, 11]) {
          const end = Date.UTC(y, m0, daysInMonth(y, m0));
          push(end + (rule.lagDays ?? 0) * DAY_MS);
        }
      }
      break;
    case "annual":
      for (let y = y0; y <= y1; y++) {
        const m0 = (rule.month ?? 1) - 1;
        const day = rule.day ?? rule.span?.fromDay ?? 1;
        push(Date.UTC(y, m0, Math.min(day, daysInMonth(y, m0))));
      }
      break;
  }
  return out.sort((a, b) => a - b);
}

/** The window around a nominal date for a rule (plus optional extra slack). */
export function windowFor(rule: Rule, nominalMs: number, slackDays = 0): ReleaseWindow {
  const tol = rule.tolDays + slackDays;
  if (rule.span) {
    const d = new Date(nominalMs);
    const y = d.getUTCFullYear();
    const m0 = d.getUTCMonth();
    const first = Date.UTC(y, m0, Math.min(rule.span.fromDay, daysInMonth(y, m0)));
    const last = Date.UTC(y, m0, Math.min(rule.span.toDay, daysInMonth(y, m0)));
    return { earliest: isoDate(first - slackDays * DAY_MS), latest: isoDate(last + slackDays * DAY_MS), nominal: isoDate(nominalMs) };
  }
  return { earliest: isoDate(nominalMs - tol * DAY_MS), latest: isoDate(nominalMs + tol * DAY_MS), nominal: isoDate(nominalMs) };
}

/** Widest number of days a rule can be searched over before it must produce an occurrence. */
function horizonDays(rule: Rule): number {
  switch (rule.cadence) {
    case "continuous":
    case "daily":
      return 4;
    case "weekly":
      return 8;
    case "monthly":
      return 63;
    case "quarterly":
      return 370;
    case "annual":
      return 740;
  }
}

/**
 * The first release whose nominal date is strictly after `date` (UTC day).
 * `slackDays` widens the window for entries marked approximate.
 */
export function nextReleaseAfter(rule: Rule | string, date: Date | number | string, slackDays = 0): ReleaseWindow {
  const r = typeof rule === "string" ? parseRule(rule) : rule;
  const day = utcDay(date);
  const list = nominalsBetween(r, day + DAY_MS, day + horizonDays(r) * DAY_MS);
  if (!list.length) throw new Error(`rule produced no occurrence after ${isoDate(day)}`);
  return windowFor(r, list[0], slackDays);
}

/** The last release whose nominal date is on or before `date` (UTC day). */
export function lastReleaseBefore(rule: Rule | string, date: Date | number | string, slackDays = 0): ReleaseWindow {
  const r = typeof rule === "string" ? parseRule(rule) : rule;
  const day = utcDay(date);
  const list = nominalsBetween(r, day - horizonDays(r) * DAY_MS, day);
  if (!list.length) throw new Error(`rule produced no occurrence before ${isoDate(day)}`);
  return windowFor(r, list[list.length - 1], slackDays);
}

/** Every release window of a rule whose nominal date falls in [from, to] (inclusive UTC days). */
export function releasesBetween(rule: Rule | string, from: Date | number | string, to: Date | number | string, slackDays = 0): ReleaseWindow[] {
  const r = typeof rule === "string" ? parseRule(rule) : rule;
  return nominalsBetween(r, utcDay(from), utcDay(to)).map((ms) => windowFor(r, ms, slackDays));
}

// ---------------------------------------------------------------- the calendar

// Precision is "official" only where the publisher posts a schedule and the
// rule follows it exactly. Everything with a lag or a "third week" is
// approximate and says so. Schedule URLs are the publishers' pages; they were
// written from the publishers' documentation and could not be fetched from
// this sandbox, so treat them as "start here" links.
export const RELEASE_CALENDAR: ReleaseEntry[] = [
  {
    id: "bls-qcew",
    sourceId: "bls-qcew",
    title: "BLS QCEW county employment and wages (quarterly)",
    cadence: "quarterly",
    rule: "quarterly:+150d:tol=14",
    precision: "approximate",
    scheduleUrl: "https://www.bls.gov/schedule/news_release/cewqtr.htm",
    covers: "the quarter that ended about five months earlier",
    notes: "BLS posts the open-data CSVs shortly before the County Employment and Wages news release; check the schedule page for the exact day.",
  },
  {
    id: "zillow-zhvi",
    sourceId: "zillow-zhvi",
    title: "Zillow ZHVI typical home value (monthly)",
    cadence: "monthly",
    rule: "monthly:days=14-21",
    precision: "approximate",
    scheduleUrl: "https://www.zillow.com/research/data/",
    covers: "the previous month",
    notes: "Zillow refreshes the research CSVs around the third week; there is no posted calendar.",
  },
  {
    id: "zillow-zori",
    sourceId: "zillow-zori",
    title: "Zillow ZORI typical rent (monthly)",
    cadence: "monthly",
    rule: "monthly:days=14-21",
    precision: "approximate",
    scheduleUrl: "https://www.zillow.com/research/data/",
    covers: "the previous month",
  },
  {
    id: "bts-border",
    sourceId: "bts-border",
    title: "BTS Border Crossing Entry Data (monthly)",
    cadence: "monthly",
    rule: "monthly:day~20:tol=10",
    precision: "approximate",
    scheduleUrl: "https://data.bts.gov/Research-and-Statistics/Border-Crossing-Entry-Data/keg4-3bc2",
    covers: "the month that ended six to eight weeks earlier",
    notes: "Rolling Socrata refresh; the dataset page shows its own 'updated' stamp.",
  },
  {
    id: "bts-ports",
    sourceId: "bts-ports",
    title: "BTS Port Performance Freight Statistics (annual)",
    cadence: "annual",
    rule: "annual:month=1",
    precision: "approximate",
    scheduleUrl: "https://www.bts.gov/ports",
    covers: "the previous calendar year",
    notes: "The annual report to Congress is due in January; the Socrata table follows the report.",
  },
  {
    id: "bts-supply-chain",
    sourceId: "bts-supply-chain",
    title: "BTS Supply Chain and Freight Indicators (rolling)",
    cadence: "weekly",
    rule: "weekly:FRI",
    precision: "approximate",
    scheduleUrl: "https://data.bts.gov/Research-and-Statistics/Supply-Chain-Indicators/y5ut-ibwt",
    covers: "each indicator keeps its own cadence (weekly rates, monthly TEU)",
  },
  {
    id: "fred:MORTGAGE30US",
    sourceId: "fred",
    seriesId: "MORTGAGE30US",
    title: "30-year fixed mortgage rate (Freddie Mac PMMS, weekly)",
    cadence: "weekly",
    rule: "weekly:THU",
    precision: "official",
    scheduleUrl: "https://www.freddiemac.com/pmms",
    covers: "the week ending that Thursday",
  },
  {
    id: "fred:UNRATE",
    sourceId: "fred",
    seriesId: "UNRATE",
    title: "Unemployment rate (BLS Employment Situation, monthly)",
    cadence: "monthly",
    rule: "monthly:first-FRI",
    precision: "approximate",
    slackDays: 7,
    scheduleUrl: "https://www.bls.gov/schedule/news_release/empsit.htm",
    covers: "the previous month",
    notes: "Usually the first Friday; holidays and shutdowns move it. The BLS schedule page has the exact dates.",
  },
  {
    id: "fred:HOUST",
    sourceId: "fred",
    seriesId: "HOUST",
    title: "Housing starts (Census New Residential Construction, monthly)",
    cadence: "monthly",
    rule: "monthly:day~18:tol=2",
    precision: "approximate",
    scheduleUrl: "https://www.census.gov/construction/nrc/index.html",
    covers: "the previous month",
  },
  {
    id: "fred:PERMIT",
    sourceId: "fred",
    seriesId: "PERMIT",
    title: "Building permits (Census New Residential Construction, monthly)",
    cadence: "monthly",
    rule: "monthly:day~18:tol=2",
    precision: "approximate",
    scheduleUrl: "https://www.census.gov/construction/nrc/index.html",
    covers: "the previous month",
  },
  {
    id: "fred:RSXFS",
    sourceId: "fred",
    seriesId: "RSXFS",
    title: "Retail sales ex food services (Census Advance Monthly Retail Trade)",
    cadence: "monthly",
    rule: "monthly:day~15:tol=3",
    precision: "approximate",
    scheduleUrl: "https://www.census.gov/retail/release_schedule.html",
    covers: "the previous month",
  },
  {
    id: "fred:BOPGSTB",
    sourceId: "fred",
    seriesId: "BOPGSTB",
    title: "Trade balance (BEA/Census International Trade in Goods and Services)",
    cadence: "monthly",
    rule: "monthly:day~6:tol=4",
    precision: "approximate",
    scheduleUrl: "https://www.bea.gov/news/schedule",
    covers: "the month before last",
  },
  {
    id: "fred:CSUSHPINSA",
    sourceId: "fred",
    seriesId: "CSUSHPINSA",
    title: "Case-Shiller US home price index (S&P, monthly)",
    cadence: "monthly",
    rule: "monthly:last-TUE",
    precision: "approximate",
    slackDays: 1,
    scheduleUrl: "https://www.spglobal.com/spdji/en/index-family/indicators/sp-corelogic-case-shiller/",
    covers: "the month that ended two months earlier",
  },
  {
    id: "fred:DCOILWTICO",
    sourceId: "fred",
    seriesId: "DCOILWTICO",
    title: "WTI crude spot (EIA, daily)",
    cadence: "daily",
    rule: "daily:business",
    precision: "approximate",
    scheduleUrl: "https://www.eia.gov/petroleum/data.php",
    covers: "each trading day; FRED posts EIA's weekly batch a few days later",
  },
  {
    id: "fred:MSPUS",
    sourceId: "fred",
    seriesId: "MSPUS",
    title: "Median sales price of houses sold (Census, quarterly)",
    cadence: "quarterly",
    rule: "quarterly:+25d:tol=5",
    precision: "approximate",
    scheduleUrl: "https://www.census.gov/construction/nrs/index.html",
    covers: "the quarter that just ended",
  },
  {
    id: "fred:TOTALSA",
    sourceId: "fred",
    seriesId: "TOTALSA",
    title: "Vehicle sales, annual rate (BEA, monthly)",
    cadence: "monthly",
    rule: "monthly:day~3:tol=3",
    precision: "approximate",
    scheduleUrl: "https://www.bea.gov/data/consumer-spending/motor-vehicles",
    covers: "the previous month",
  },
  {
    id: "usdm",
    sourceId: "usdm",
    title: "U.S. Drought Monitor map (weekly, Thursday 08:30 ET)",
    cadence: "weekly",
    rule: "weekly:THU",
    precision: "official",
    scheduleUrl: "https://droughtmonitor.unl.edu/About/WhatistheUSDM.aspx",
    covers: "conditions through the preceding Tuesday morning; the map carries that Tuesday's date",
  },
  {
    id: "usgs-water",
    sourceId: "usgs-water",
    title: "USGS instantaneous and daily water values (continuous)",
    cadence: "continuous",
    rule: "continuous",
    precision: "official",
    scheduleUrl: "https://waterdata.usgs.gov/nwis",
    covers: "instantaneous values as gauges report (typically every 15 minutes); daily values the next day",
  },
  {
    id: "worldbank-wdi",
    sourceId: "worldbank-wdi",
    title: "World Bank World Development Indicators (annual, refreshed several times a year)",
    cadence: "annual",
    rule: "annual:month=7",
    precision: "approximate",
    scheduleUrl: "https://datatopics.worldbank.org/world-development-indicators/",
    covers: "the previous calendar year for most indicators",
    notes: "WDI gets smaller updates through the year; July is usually the main annual release.",
  },
  {
    id: "worldbank-wits",
    sourceId: "worldbank-wits",
    title: "World Bank WITS TradeStats (annual, rolling)",
    cadence: "annual",
    rule: "annual:month=12",
    precision: "approximate",
    scheduleUrl: "https://wits.worldbank.org/",
    covers: "the latest year reporters have submitted to UN Comtrade; two to three years behind",
  },
];

/** A calendar entry with the window computed for one occurrence. */
export interface ReleaseOccurrence {
  entry: ReleaseEntry;
  window: ReleaseWindow;
  /** Effective precision: a rule that is approximate by construction can never be official. */
  precision: Precision;
}

/** Effective precision of an entry (the rule wins when it is approximate). */
export function effectivePrecision(entry: ReleaseEntry): Precision {
  return parseRule(entry.rule).approximate ? "approximate" : entry.precision;
}

/**
 * Upcoming release windows in [from, to], sorted by earliest date then title.
 * Continuous sources are listed once at `from` rather than once per day.
 */
export function upcomingReleases(from: Date | number | string, to: Date | number | string, entries: ReleaseEntry[] = RELEASE_CALENDAR): ReleaseOccurrence[] {
  const out: ReleaseOccurrence[] = [];
  for (const entry of entries) {
    const rule = parseRule(entry.rule);
    const precision = rule.approximate ? "approximate" : entry.precision;
    const slack = precision === "approximate" ? (entry.slackDays ?? 0) : 0;
    if (rule.cadence === "continuous") {
      const d = isoDate(utcDay(from));
      out.push({ entry, window: { earliest: d, latest: d, nominal: d }, precision });
      continue;
    }
    for (const window of releasesBetween(rule, from, to, slack)) out.push({ entry, window, precision });
  }
  return out.sort((a, b) => (a.window.earliest < b.window.earliest ? -1 : a.window.earliest > b.window.earliest ? 1 : a.entry.title.localeCompare(b.entry.title)));
}

/** Find a calendar entry by id, or by source id plus optional series id. */
export function findEntry(sourceId: string, seriesId?: string, entries: ReleaseEntry[] = RELEASE_CALENDAR): ReleaseEntry | undefined {
  return entries.find((e) => e.id === sourceId) ?? entries.find((e) => e.sourceId === sourceId && (seriesId ? e.seriesId === seriesId : !e.seriesId));
}
