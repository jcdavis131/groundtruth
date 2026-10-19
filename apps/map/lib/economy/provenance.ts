// Provenance builders for every economy source. Pure: they take the release
// labels the loaders already know (a Zillow file's last month column, a QCEW
// period, a FRED observation date, a BTS reporting year) and a retrieval time,
// and return Provenance records spelled the same way in the API envelope, the
// market report and the HUD. Nothing here imports the loaders, so the browser
// side of the report can use it too.

import { provenance, type Provenance } from "@/lib/provenance/types";
import { source, type SourceId } from "@/lib/provenance/sources";
import { monthPeriod, quarterPeriod } from "@/lib/provenance/collect";

/** Zillow's public CSV names (basenames of lib/economy/sources.ts ZILLOW_FILES; repeated here so the browser bundle stays free of the loaders). */
export const ZILLOW_FILE_NAMES = {
  zhviCounty: "County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  zhviState: "State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  zhviMetro: "Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
  zoriCounty: "County_zori_uc_sfrcondomfr_sm_month.csv",
  zoriMetro: "Metro_zori_uc_sfrcondomfr_sm_month.csv",
} as const;
export type ZillowFile = keyof typeof ZILLOW_FILE_NAMES;

const ZILLOW_BASE = "https://files.zillowstatic.com/research/public_csvs";

/** Zillow ZHVI or ZORI. `asOf` is the last month column ("2026-07-31"). */
export function zillowProvenance(file: ZillowFile, asOf: string | null | undefined, retrievedAt: string, notes?: string[]): Provenance {
  const isRent = file.startsWith("zori");
  return provenance(source(isRent ? "zillow-zori" : "zillow-zhvi"), {
    kind: "published",
    seriesId: ZILLOW_FILE_NAMES[file],
    upstreamUrl: `${ZILLOW_BASE}/${isRent ? "zori" : "zhvi"}/${ZILLOW_FILE_NAMES[file]}`,
    period: monthPeriod(asOf),
    retrievedAt,
    revision: "Zillow republishes the full history each month; earlier months can change",
    notes,
  });
}

/** BLS QCEW. `period` as the loader labels it ("2026 Q1"); `area` is the FIPS the row was read for. */
export function qcewProvenance(period: string | null | undefined, retrievedAt: string, opts: { area?: string; sectors?: boolean; notes?: string[] } = {}): Provenance {
  const p = quarterPeriod(period);
  const y = p?.slice(0, 4);
  const q = p?.slice(-1);
  return provenance(source("bls-qcew"), {
    kind: "published",
    seriesId: opts.area ? `area ${opts.area}${opts.sectors ? ", NAICS sectors, private ownership" : ", all ownerships, all industries"}` : undefined,
    upstreamUrl: y && q && opts.area ? `https://data.bls.gov/cew/data/api/${y}/${q}/area/${opts.area.toUpperCase()}.csv` : "https://data.bls.gov/cew/data/api/",
    period: p,
    retrievedAt,
    revision: "quarterly files are revised when the next quarter is published; annual revisions follow",
    notes: opts.notes,
  });
}

/**
 * BLS OEWS metro occupation mix. The tables ship with the app (one release a
 * year), so there is no upstream fetch to time: `retrievedAt` is when this
 * response was assembled, and `period` is the OEWS vintage itself.
 */
export function oewsProvenance(asOf: string, retrievedAt: string, opts: { msa?: string; notes?: string[] } = {}): Provenance {
  return provenance(source("bls-oews"), {
    kind: "published",
    seriesId: opts.msa ? `MSA ${opts.msa}, all occupations` : "all MSAs",
    upstreamUrl: "https://www.bls.gov/oes/tables.htm",
    period: asOf,
    retrievedAt,
    revision: "OEWS publishes once a year; estimates are not comparable across vintages",
    notes: [
      "Bundled with the app from the published OEWS release; metro centroids come from Census TIGERweb.",
      ...(opts.notes ?? []),
    ],
  });
}

/** Census TIGERweb polygons (geometry only, no values). */
export function tigerProvenance(retrievedAt: string, detail?: string): Provenance {
  return provenance(source("census-tigerweb"), {
    kind: "published",
    seriesId: detail ? `tigerWMS_Current, generalised ${detail}` : "tigerWMS_Current",
    retrievedAt,
    notes: ["Geometry and names only; no value on the map comes from TIGERweb."],
  });
}

/** One FRED series observation as the pulse carries it. */
export function fredProvenance(item: { id: string; date: string }, retrievedAt: string): Provenance {
  return provenance(source("fred"), {
    kind: "published",
    seriesId: item.id,
    upstreamUrl: `https://fred.stlouisfed.org/series/${item.id}`,
    period: item.date,
    retrievedAt,
    revision: "FRED serves the latest vintage; use ALFRED for the value as first published",
  });
}

/** One BTS Supply Chain and Freight Indicators row. */
export function btsIndicatorProvenance(item: { id: string; date: string }, retrievedAt: string): Provenance {
  return provenance(source("bts-supply-chain"), {
    kind: "published",
    seriesId: item.id,
    upstreamUrl: "https://data.bts.gov/resource/y5ut-ibwt.json",
    period: item.date,
    retrievedAt,
  });
}

/** Provenance for a pulse list: FRED ids are bare series codes, BTS ids start with "bts-". */
export function pulseProvenance(items: Array<{ id: string; date: string }>, retrievedAt: string): Provenance[] {
  return items.map((i) => (i.id.startsWith("bts-") ? btsIndicatorProvenance(i, retrievedAt) : fredProvenance(i, retrievedAt)));
}

/** NGA World Port Index, bundled copy. `pulled` is when the copy was taken. */
export function wpiProvenance(retrievedAt: string, pulled?: string): Provenance {
  return provenance(source("nga-wpi"), {
    kind: "published",
    seriesId: "Pub 150 World Port Index",
    retrievedAt: pulled ?? retrievedAt,
    notes: ["Bundled copy of the NGA table; harbour sizes and depths change only when NGA republishes."],
  });
}

/** BTS Port Performance statistics, latest reporting year. */
export function btsPortsProvenance(year: number | null | undefined, retrievedAt: string): Provenance {
  return provenance(source("bts-ports"), {
    kind: "published",
    seriesId: "5rpz-kgm9 port statistics",
    upstreamUrl: "https://data.bts.gov/resource/5rpz-kgm9.json",
    period: year != null ? String(year) : undefined,
    retrievedAt,
  });
}

/** BTS Border Crossing Entry Data; `asOf` is the latest month ("2026-06"). */
export function btsBorderProvenance(asOf: string | null | undefined, retrievedAt: string): Provenance {
  return provenance(source("bts-border"), {
    kind: "published",
    seriesId: "keg4-3bc2 border crossing entry data",
    upstreamUrl: "https://data.bts.gov/resource/keg4-3bc2.json",
    period: monthPeriod(asOf),
    retrievedAt,
    revision: "the latest month is often incomplete when first posted and is revised the following month",
  });
}

/** Natural Earth country polygons, bundled copy. */
export function naturalEarthProvenance(retrievedAt: string, pulled?: string): Provenance {
  return provenance(source("natural-earth"), {
    kind: "published",
    seriesId: "ne_110m_admin_0_countries",
    retrievedAt: pulled ?? retrievedAt,
    notes: ["Geometry, names and population only."],
  });
}

/** World Bank WDI, most recent non-empty value per indicator (`mrnev=1`), so each country carries its own year. */
export function worldBankProvenance(retrievedAt: string, indicators: string[] = ["NY.GDP.MKTP.CD", "BX.GSR.GNFS.CD", "BM.GSR.GNFS.CD", "NE.TRD.GNFS.ZS", "IS.SHP.GOOD.TU"]): Provenance {
  return provenance(source("worldbank-wdi"), {
    kind: "published",
    seriesId: indicators.join(", "),
    upstreamUrl: "https://api.worldbank.org/v2/country/all/indicator/",
    retrievedAt,
    notes: ["Latest available year per country and indicator; the `year` next to each value says which."],
  });
}

/** WITS TradeStats partner table for one reporter and year. */
export function witsProvenance(iso3: string, year: number | null | undefined, retrievedAt: string): Provenance {
  return provenance(source("worldbank-wits"), {
    kind: "published",
    seriesId: `tradestats-trade ${iso3} XPRT-TRD-VL, MPRT-TRD-VL`,
    period: year != null ? String(year) : undefined,
    retrievedAt,
    notes: ["Values in US$ thousands as WITS publishes them."],
  });
}

/**
 * A number computed here from published values. Cited against the source it
 * was computed from (`from`), with `method` holding the formula that ran and
 * any second source named in `notes`.
 */
export function estimateProvenance(from: SourceId, method: string, retrievedAt: string, notes?: string[]): Provenance {
  return provenance(source(from), { kind: "estimate", method, retrievedAt, notes });
}
