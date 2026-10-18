// Number and date formatting for the brief and the document pages, pinned to
// en-US and UTC at module scope.
//
// This is not cosmetic. lib/economy/features.ts fmtUsd/fmtNum/fmtPct/monthLabel
// call toLocaleString and toLocaleDateString with no explicit locale, which is
// two separate hazards here: a React hydration mismatch on any number that is
// rendered on the server and again in the browser, and a byte-reproducibility
// break for a brief that has to be identical across machines with different
// ICU builds and different TZ settings. Those four are left alone — the HUD
// reads them everywhere and nothing about the cockpit should move.
//
// Every formatter returns MISSING for a value the publisher did not publish.
// Never "0", never a bare dash: a missing number and a zero are different
// facts and the reader is entitled to know which one this is.

/** What a value the publisher did not publish reads as, everywhere. */
export const MISSING = "not published";

const LOCALE = "en-US";

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(style: "decimal" | "currency", digits: number): Intl.NumberFormat {
  const key = `${style}:${digits}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, {
      style,
      ...(style === "currency" ? { currency: "USD" } : {}),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormats.set(key, f);
  }
  return f;
}

// Pre-built for the shapes the brief uses on every page, so the common path
// never pays for a formatter construction.
const USD_0 = numberFormat("currency", 0);
const NUM_0 = numberFormat("decimal", 0);
const MONTH_YEAR = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" });

function finite(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

/** Dollars, no cents by default: usd(452000) is "$452,000". */
export function usd(v: number | null | undefined, digits = 0): string {
  if (!finite(v)) return MISSING;
  return (digits === 0 ? USD_0 : numberFormat("currency", digits)).format(v);
}

/** A plain count: num(3088) is "3,088". */
export function num(v: number | null | undefined, digits = 0): string {
  if (!finite(v)) return MISSING;
  return (digits === 0 ? NUM_0 : numberFormat("decimal", digits)).format(v);
}

/** A percent that is already in percent units: pct(6.2) is "6.2%", pct(-4.1) is "-4.1%". */
export function pct(v: number | null | undefined, digits = 1): string {
  if (!finite(v)) return MISSING;
  return `${numberFormat("decimal", digits).format(v)}%`;
}

/** A percent that always carries its sign, for a change: "+6.2%", "-4.1%", "+0.0%". */
export function signedPct(v: number | null | undefined, digits = 1): string {
  if (!finite(v)) return MISSING;
  // The sign is taken from the raw value, not from the rounded one, so a
  // change of -0.04 reads "-0.0%" — the direction is a fact even when the
  // magnitude rounds away.
  return `${v < 0 ? "-" : "+"}${numberFormat("decimal", digits).format(Math.abs(v))}%`;
}

/**
 * The month an ISO date or "YYYY-MM" belongs to, in UTC: "July 2026".
 * UTC matters — "2026-01-01" is December 2025 in any negative offset, which
 * would print the wrong month for every reader west of Greenwich.
 */
export function month(iso: string | null | undefined): string {
  if (iso == null || iso === "") return MISSING;
  const d = new Date(iso.length === 7 ? `${iso}-01` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return MONTH_YEAR.format(d);
}

/** English ordinal: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 101st, 111th. */
export function ordinal(n: number | null | undefined): string {
  if (!finite(n)) return MISSING;
  const i = Math.trunc(n);
  const body = NUM_0.format(Math.abs(i));
  const last2 = Math.abs(i) % 100;
  const last1 = Math.abs(i) % 10;
  const suffix = last2 >= 11 && last2 <= 13 ? "th" : last1 === 1 ? "st" : last1 === 2 ? "nd" : last1 === 3 ? "rd" : "th";
  return `${i < 0 ? "-" : ""}${body}${suffix}`;
}

/** A position inside a cohort: countOf(812, 3088) is "812th of 3,088". */
export function countOf(rank: number | null | undefined, n: number | null | undefined): string {
  if (!finite(rank) || !finite(n)) return MISSING;
  return `${ordinal(rank)} of ${num(n)}`;
}
