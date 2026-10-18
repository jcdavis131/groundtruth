// Sector bridge: SIC code (what EDGAR assigns a filer) -> SIC division ->
// GICS-style sector -> the sector ETFs practitioners use as a proxy, and the
// same bridge from a county's NAICS employment mix (BLS QCEW).
//
// This is a CONVENTION, not a classification service and not advice. GICS is
// a licensed taxonomy owned by MSCI and S&P; the eleven sector names are used
// here as common vocabulary and the assignment below is our own reading of
// SIC ranges, kept as one table so a practitioner can correct a line. The ETF
// tickers are the widely used SPDR sector funds plus a few industry funds
// (ITB/XHB homebuilders, IYT transports, KRE regional banks, XOP/OIH oil
// services, SMH semiconductors, XRT retail); listing a fund says nothing
// about its merits.
//
// Pure: no network, no React, no Cesium.

import type { SectorRow } from "@/lib/economy/features";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { GicsSector, SectorExposure, SectorMapping } from "./types";

export const GICS_TITLE: Record<GicsSector, string> = {
  energy: "Energy",
  materials: "Materials",
  industrials: "Industrials",
  "consumer-discretionary": "Consumer Discretionary",
  "consumer-staples": "Consumer Staples",
  "health-care": "Health Care",
  financials: "Financials",
  "information-technology": "Information Technology",
  "communication-services": "Communication Services",
  utilities: "Utilities",
  "real-estate": "Real Estate",
  unclassified: "Unclassified",
};

/** The broad SPDR fund per sector. Industry funds are added per rule below. */
export const SECTOR_ETF: Record<GicsSector, string[]> = {
  energy: ["XLE"],
  materials: ["XLB"],
  industrials: ["XLI"],
  "consumer-discretionary": ["XLY"],
  "consumer-staples": ["XLP"],
  "health-care": ["XLV"],
  financials: ["XLF"],
  "information-technology": ["XLK"],
  "communication-services": ["XLC"],
  utilities: ["XLU"],
  "real-estate": ["XLRE"],
  unclassified: [],
};

/** Colour per sector for the globe and the HUD chips. */
export const SECTOR_COLOR: Record<GicsSector, string> = {
  energy: "#FF8A3D",
  materials: "#C9A227",
  industrials: "#8FA8C8",
  "consumer-discretionary": "#F472B6",
  "consumer-staples": "#A3E635",
  "health-care": "#5EF2C2",
  financials: "#4DD8FF",
  "information-technology": "#7CC4FF",
  "communication-services": "#C084FC",
  utilities: "#FDE68A",
  "real-estate": "#FB7185",
  unclassified: "#6E7F8C",
};

/** SIC divisions (OSHA / SEC SIC manual). */
const DIVISIONS: Array<[number, number, string, string]> = [
  [100, 999, "A", "Agriculture, forestry and fishing"],
  [1000, 1499, "B", "Mining"],
  [1500, 1799, "C", "Construction"],
  [2000, 3999, "D", "Manufacturing"],
  [4000, 4999, "E", "Transportation, communications, electric, gas and sanitary services"],
  [5000, 5199, "F", "Wholesale trade"],
  [5200, 5999, "G", "Retail trade"],
  [6000, 6799, "H", "Finance, insurance and real estate"],
  [7000, 8999, "I", "Services"],
  [9100, 9999, "J", "Public administration"],
];

interface Rule {
  from: number;
  to: number;
  gics: GicsSector;
  /** Industry funds appended after the sector fund. */
  extra?: string[];
}

/**
 * SIC range -> GICS sector, first match wins, so specific ranges are listed
 * before the broad ones. Ranges follow the SEC's SIC list; where SIC lumps
 * industries GICS separates (drugs under chemicals, homebuilders under
 * construction, pipelines under gas utilities) the narrower SIC code is
 * pulled out first.
 */
const RULES_RAW: Array<[number, number, GicsSector, string[]?]> = [
  // Mining, oil and gas
  [1311, 1389, "energy", ["XOP", "OIH"]],
  [1200, 1299, "energy"],
  [1000, 1099, "materials"],
  [1400, 1499, "materials"],
  // Construction: operative builders are homebuilders
  [1531, 1531, "consumer-discretionary", ["ITB", "XHB"]],
  [1500, 1799, "industrials"],
  // Agriculture
  [100, 999, "consumer-staples"],
  // Manufacturing
  [2000, 2199, "consumer-staples"],
  [2200, 2399, "consumer-discretionary"],
  [2400, 2499, "materials"],
  [2500, 2599, "consumer-discretionary"],
  [2600, 2699, "materials"],
  [2700, 2799, "communication-services"],
  [2833, 2836, "health-care"],
  [2800, 2899, "materials"],
  [2900, 2999, "energy"],
  [3000, 3099, "materials"],
  [3100, 3199, "consumer-discretionary"],
  [3200, 3399, "materials"],
  [3400, 3499, "industrials"],
  [3570, 3579, "information-technology"],
  [3500, 3599, "industrials"],
  [3630, 3659, "consumer-discretionary"],
  [3674, 3674, "information-technology", ["SMH"]],
  [3660, 3699, "information-technology"],
  [3600, 3629, "industrials"],
  [3711, 3716, "consumer-discretionary"],
  [3700, 3799, "industrials"],
  [3812, 3812, "industrials"],
  [3840, 3851, "health-care"],
  [3860, 3873, "consumer-discretionary"],
  [3800, 3899, "information-technology"],
  [3900, 3999, "consumer-discretionary"],
  // Transportation, communications, utilities
  [4000, 4599, "industrials", ["IYT"]],
  [4600, 4699, "energy"],
  [4700, 4799, "industrials", ["IYT"]],
  [4800, 4899, "communication-services"],
  [4922, 4922, "energy"],
  [4950, 4999, "industrials"],
  [4900, 4949, "utilities"],
  // Wholesale
  [5122, 5122, "health-care"],
  [5140, 5149, "consumer-staples"],
  [5170, 5172, "energy"],
  [5180, 5199, "consumer-staples"],
  [5000, 5099, "industrials"],
  [5100, 5199, "consumer-discretionary"],
  // Retail
  [5331, 5331, "consumer-staples", ["XRT"]],
  [5400, 5499, "consumer-staples", ["XRT"]],
  [5912, 5912, "consumer-staples", ["XRT"]],
  [5200, 5999, "consumer-discretionary", ["XRT"]],
  // Finance, insurance, real estate
  [6020, 6036, "financials", ["KRE"]],
  [6500, 6599, "real-estate"],
  [6798, 6798, "real-estate"],
  [6000, 6799, "financials"],
  // Services
  [7370, 7379, "information-technology"],
  [7310, 7319, "communication-services"],
  [7800, 7899, "communication-services"],
  [8000, 8099, "health-care"],
  [8300, 8399, "health-care"],
  [8731, 8731, "health-care"],
  [7000, 7299, "consumer-discretionary"],
  [7500, 7599, "consumer-discretionary"],
  [7900, 7999, "consumer-discretionary"],
  [8200, 8299, "consumer-discretionary"],
  [7300, 8999, "industrials"],
];
const RULES: Rule[] = RULES_RAW.map(([from, to, gics, extra]) => ({ from, to, gics, extra }));

const UNCLASSIFIED: SectorMapping = { division: { code: "?", title: "Unknown" }, gics: "unclassified", gicsTitle: GICS_TITLE.unclassified, etfs: [] };

/** Map a four-digit SIC code (string or number) to its division, GICS sector and ETFs. Unknown or missing codes are "unclassified". */
export function sicToSector(sic: string | number | null | undefined): SectorMapping {
  const n = typeof sic === "number" ? sic : Number(String(sic ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return UNCLASSIFIED;
  const d = DIVISIONS.find(([a, b]) => n >= a && n <= b);
  const division = d ? { code: d[2], title: d[3] } : { code: "?", title: "Unknown" };
  const rule = RULES.find((r) => n >= r.from && n <= r.to);
  if (!rule) return { division, gics: "unclassified", gicsTitle: GICS_TITLE.unclassified, etfs: [] };
  return { division, gics: rule.gics, gicsTitle: GICS_TITLE[rule.gics], etfs: [...SECTOR_ETF[rule.gics], ...(rule.extra ?? [])] };
}

/**
 * NAICS sector (as BLS QCEW publishes it) -> GICS sector and funds. Same
 * caveats as above; construction is folded into industrials with the
 * homebuilder funds because county construction employment is mostly
 * contractors, and mining (21) goes to energy because oil and gas dominate
 * that sector's US employment.
 */
export const NAICS_TO_GICS: Record<string, { gics: GicsSector; extra?: string[] }> = {
  "11": { gics: "consumer-staples" },
  "21": { gics: "energy", extra: ["XOP", "OIH"] },
  "22": { gics: "utilities" },
  "23": { gics: "industrials", extra: ["ITB", "XHB"] },
  "31-33": { gics: "industrials", extra: ["XLB"] },
  "42": { gics: "industrials" },
  "44-45": { gics: "consumer-discretionary", extra: ["XRT"] },
  "48-49": { gics: "industrials", extra: ["IYT"] },
  "51": { gics: "communication-services", extra: ["XLK"] },
  "52": { gics: "financials", extra: ["KRE"] },
  "53": { gics: "real-estate" },
  "54": { gics: "industrials" },
  "55": { gics: "financials" },
  "56": { gics: "industrials" },
  "61": { gics: "consumer-discretionary" },
  "62": { gics: "health-care" },
  "71": { gics: "communication-services" },
  "72": { gics: "consumer-discretionary" },
  "81": { gics: "consumer-discretionary" },
  "99": { gics: "unclassified" },
};

export const EXPOSURE_METHOD =
  "NAICS sector -> GICS sector by the static table in lib/companies/sectors.ts; lq = sum(emp_i * lq_i) / sum(emp_i) over the NAICS sectors folded into the GICS sector, withheld cells excluded; ETFs are the convention list, not a recommendation";

/**
 * Bridge a county's (or state's) QCEW sector rows to GICS sectors with the
 * location quotient carried through as an employment-weighted mean. Rows
 * BLS withheld contribute nothing. Sorted by lq descending, unclassified
 * last; sectors with no jobs at all are dropped.
 */
export function countySectorExposure(rows: SectorRow[], opts: { period?: string; fips?: string; retrievedAt?: string } = {}): SectorExposure[] {
  const groups = new Map<GicsSector, SectorExposure>();
  for (const r of rows) {
    const m = NAICS_TO_GICS[r.code];
    if (!m) continue;
    let g = groups.get(m.gics);
    if (!g) {
      g = {
        gics: m.gics,
        gicsTitle: GICS_TITLE[m.gics],
        etfs: [...SECTOR_ETF[m.gics]],
        naics: [],
        emp: null,
        lq: null,
        provenance: provenance(source("bls-qcew"), {
          kind: "estimate",
          method: EXPOSURE_METHOD,
          period: opts.period,
          seriesId: opts.fips ? `qcew:${opts.fips}:sectors` : undefined,
          retrievedAt: opts.retrievedAt,
        }),
      };
      groups.set(m.gics, g);
    }
    for (const e of m.extra ?? []) if (!g.etfs.includes(e)) g.etfs.push(e);
    g.naics.push({ code: r.code, title: r.title, emp: r.suppressed ? null : r.emp, lq: r.suppressed ? null : r.lq });
  }
  const out: SectorExposure[] = [];
  for (const g of groups.values()) {
    let emp = 0;
    let wsum = 0;
    let lqw = 0;
    let any = false;
    for (const n of g.naics) {
      if (n.emp != null) {
        emp += n.emp;
        any = true;
      }
      if (n.emp != null && n.lq != null && n.emp > 0) {
        wsum += n.emp;
        lqw += n.emp * n.lq;
      }
    }
    g.emp = any ? emp : null;
    g.lq = wsum > 0 ? Math.round((lqw / wsum) * 100) / 100 : null;
    if (g.emp === null && g.lq === null) continue;
    out.push(g);
  }
  return out.sort((a, b) => {
    if (a.gics === "unclassified") return 1;
    if (b.gics === "unclassified") return -1;
    return (b.lq ?? -1) - (a.lq ?? -1);
  });
}
