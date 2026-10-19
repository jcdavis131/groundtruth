// Economy history API: the backfilled research datasets behind the momentum
// and affordability indices, as lib/series Series with provenance.
//
//   /api/economy/history?op=county&fips=48453[&years=10][&lag=0][&format=csv]
//       ZHVI, ZORI (monthly), QCEW employment / avg weekly wage / establishments
//       and their over-the-year changes (quarterly), PMMS 30-year rate (weekly),
//       momentum index, payment, wage share and price-to-rent (monthly)
//   /api/economy/history?op=us[&years=10][&lag=0][&format=csv]
//       the same for the nation (Zillow "United States" row, QCEW US000)
//   /api/economy/history?op=ic&h=12[&asof=YYYY-MM][&minN=30][&from=YYYY-MM][&to=YYYY-MM]
//       cross-sectional information coefficient of the home-only momentum
//       signal for the next h months of ZHVI change, every month, across every
//       county in the Zillow file; with asof, also that month's cross-section
//
// JSON responses are Enveloped: { data, provenance[], generatedAt, caveats[] }.
// CSV is long format: series_id,t_iso,value. CORS open, edge-cached, like
// /api/economy. County/US bundles are cached 6 h (Zillow cadence); the QCEW
// quarters underneath are cached 12 h.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, num } from "@/lib/server/upstream";
import type { Enveloped } from "@/lib/provenance/types";
import type { Series } from "@/lib/series/types";
import { assembleHistory, dedupeProvenance, type HistoryBundle } from "@/lib/economy/history/assemble";
import { seriesToLongCsv } from "@/lib/economy/history/csv";
import { icCrossSection, icPanel, icRowsAt, icSeries, type IcMonth, type IcResult, type IcSummary } from "@/lib/economy/history/ic";
import { momentumHomeOnly } from "@/lib/economy/history/indices";
import { mortgageHistory } from "@/lib/economy/history/mortgageHistory";
import { qcewHistory, type QcewHistory } from "@/lib/economy/history/qcewHistory";
import { zhviAllCounties, zhviSeries, zoriSeries, type ZillowScope } from "@/lib/economy/history/zillowHistory";

export const maxDuration = 60;

const H = 3600_000;
const TTL_S = 6 * 3600;
const MAX_YEARS = 26; // Zillow ZHVI starts in 2000
const MAX_IC_ROWS = 4000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function headers(ttlS: number, extra: Record<string, string> = {}) {
  return { ...CORS, "cache-control": `public, max-age=0, s-maxage=${ttlS}, stale-while-revalidate=${ttlS}`, ...extra };
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Run a fetch, turning any failure into null plus a caveat, so one upstream cannot sink the bundle. */
async function soft<T>(label: string, caveats: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    caveats.push(`${label}: ${err instanceof Error ? err.message : "failed"}`);
    return null;
  }
}

async function bundle(scope: ZillowScope, qcewArea: string, years: number, lag: number): Promise<HistoryBundle> {
  const caveats: string[] = [];
  const [zhvi, zori, mortgage, qcew] = await Promise.all([
    soft("Zillow ZHVI", caveats, () => zhviSeries(scope)),
    soft("Zillow ZORI", caveats, () => zoriSeries(scope)),
    soft("FRED MORTGAGE30US", caveats, () => mortgageHistory()),
    soft<QcewHistory>("BLS QCEW", caveats, async () => {
      // Share the Zillow row's name with the QCEW series titles when we have it.
      const name = (await zhviSeries(scope).catch(() => null))?.geo?.name;
      return qcewHistory(qcewArea, years, { name });
    }),
  ]);
  const b = assembleHistory({ zhvi, zori, qcew, mortgage }, { years, now: Date.now(), lagMonths: lag });
  return { ...b, caveats: [...caveats, ...b.caveats] };
}

function envelope<T>(data: T, provenance: Enveloped<T>["provenance"], caveats: string[]): Enveloped<T> {
  return { data, provenance, generatedAt: new Date().toISOString(), caveats };
}

function respondBundle(b: HistoryBundle, format: "json" | "csv", filename: string) {
  if (format === "csv") {
    return new Response(seriesToLongCsv(b.series), {
      headers: headers(TTL_S, { "content-type": "text/csv; charset=utf-8", "content-disposition": `inline; filename="${filename}.csv"` }),
    });
  }
  return NextResponse.json(envelope({ series: b.series }, b.provenance, b.caveats), { headers: headers(TTL_S) });
}

interface IcData {
  h: number;
  signal: string;
  byMonth: IcMonth[];
  summary: IcSummary;
  series: Series[];
  /** Present when asof was given. */
  asof?: string;
  at?: IcResult;
  rows?: Array<{ id: string; signal: number; forward: number }>;
}

const IC_CAVEATS = [
  "Signal is the reduced-form home-only momentum (clip(ZHVI 12-month change / 10%, -1, 1)), not the full index: rent, jobs and wage terms are absent so the panel can run from one Zillow file instead of ~3,000 BLS fetches.",
  "Descriptive, not a forecast. No transaction costs, taxes or carrying costs; a county is not a tradable asset.",
  "Zillow's county coverage grows over time, so early months over-represent large metros (survivorship). Zillow revises recent months in each release.",
  "The t-statistic assumes independent cross-sections; neighbouring counties and overlapping windows are correlated, so it overstates significance.",
];

/** Signals and prices for every county, built once per Zillow release. */
function icInputs() {
  return cached("history:ic:inputs", 6 * H, async () => {
    const prices = await zhviAllCounties();
    const signals = new Map<string, Series>();
    for (const [fips, s] of prices) signals.set(fips, momentumHomeOnly(s));
    return { prices, signals };
  }).then((c) => c.value);
}

async function opIc(h: number, minN: number, asof: string | null, from: string | null, to: string | null) {
  const { prices, signals } = await icInputs();
  const key = `history:ic:${h}:${minN}:${from ?? ""}:${to ?? ""}`;
  const panel = await cached(key, 6 * H, async () => icPanel(signals, prices, h, { minN, from: from ?? undefined, to: to ?? undefined })).then((c) => c.value);
  const signalId = "momentum:home-only";
  const series = icSeries(panel, signalId);
  const data: IcData = { h, signal: signalId, byMonth: panel.byMonth, summary: panel.summary, series: [series] };
  const caveats = [...IC_CAVEATS];
  if (asof) {
    const rows = icRowsAt(signals, prices, h, asof);
    data.asof = asof;
    data.at = icCrossSection(rows);
    data.rows = rows.slice(0, MAX_IC_ROWS);
    if (rows.length > MAX_IC_ROWS) caveats.push(`rows truncated to ${MAX_IC_ROWS} of ${rows.length}`);
    if (!rows.length) caveats.push(`no county has both a signal at ${asof} and a ZHVI value ${h} months later`);
  }
  const sample = prices.values().next().value as Series | undefined;
  return NextResponse.json(envelope(data, sample ? dedupeProvenance([sample, series]) : [series.provenance], caveats), { headers: headers(TTL_S) });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  const format = q.get("format") === "csv" ? "csv" : "json";
  const years = Math.round(num(q.get("years"), 10, 1, MAX_YEARS));
  const lag = Math.round(num(q.get("lag"), 0, 0, 12));
  try {
    switch (op) {
      case "county": {
        const fips = q.get("fips") ?? "";
        if (!/^\d{5}$/.test(fips)) return bad("fips=SSCCC (five-digit county FIPS) required");
        const b = await cached(`history:county:${fips}:${years}:${lag}`, 6 * H, () => bundle({ kind: "county", fips }, fips, years, lag)).then((c) => c.value);
        if (!b.series.some((s) => s.id === `zhvi:county:${fips}`)) return bad(`no Zillow ZHVI row for county ${fips}`, 404);
        return respondBundle(b, format, `history-county-${fips}`);
      }
      case "us": {
        const b = await cached(`history:us:${years}:${lag}`, 6 * H, () => bundle({ kind: "us" }, "US000", years, lag)).then((c) => c.value);
        return respondBundle(b, format, "history-us");
      }
      case "ic": {
        const h = Math.round(num(q.get("h"), 12, 1, 60));
        const minN = Math.round(num(q.get("minN"), 30, 10, 5000));
        const asof = q.get("asof");
        const from = q.get("from");
        const to = q.get("to");
        for (const [k, v] of [
          ["asof", asof],
          ["from", from],
          ["to", to],
        ] as const) {
          if (v != null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return bad(`${k}=YYYY-MM expected`);
        }
        return await opIc(h, minN, asof, from, to);
      }
      default:
        return bad("unknown op: county | us | ic");
    }
  } catch (err) {
    const res = jsonError(err);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }
}
