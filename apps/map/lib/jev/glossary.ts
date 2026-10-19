// Every acronym the Ask Jev panel can show, spelled out (writeups
// jev-2026-10-18: ASK-PANEL-PLAIN-TEXT.md). The first time one appears in an
// answer it is written in full after it, "FEMA (Federal Emergency Management
// Agency)"; after that it carries the expansion as an <abbr> title. A test
// fails on any 2+ capital-letter word in the panel's own text that has no
// entry here, so a new acronym gets its line before it ships.

export const GLOSSARY: Readonly<Record<string, string>> = {
  ATSDR: "Agency for Toxic Substances and Disease Registry",
  BLS: "U.S. Bureau of Labor Statistics",
  CBSA: "Core-Based Statistical Area, a metro or micro area",
  CCN: "the Medicare certification number of a hospital",
  CDC: "Centers for Disease Control and Prevention",
  CMS: "Centers for Medicare & Medicaid Services",
  CSV: "a plain spreadsheet file",
  DHS: "U.S. Department of Homeland Security",
  ECHO: "Enforcement and Compliance History Online",
  EDGAR: "the Securities and Exchange Commission's filings database",
  EPA: "U.S. Environmental Protection Agency",
  FEMA: "Federal Emergency Management Agency",
  FIPS: "the Census code for a state or county",
  NCEI: "National Centers for Environmental Information",
  NID: "National Inventory of Dams",
  NOAA: "National Oceanic and Atmospheric Administration",
  NRI: "National Risk Index",
  NWS: "National Weather Service",
  NYSE: "New York Stock Exchange",
  PFAS: "per- and polyfluoroalkyl substances, long-lasting man-made chemicals",
  PFBA: "perfluorobutanoic acid, one of the long-lasting man-made chemicals",
  PFBS: "perfluorobutanesulfonic acid, one of the long-lasting man-made chemicals",
  PFHxS: "perfluorohexanesulfonic acid, one of the long-lasting man-made chemicals",
  PWSID: "public water system id number",
  QCEW: "Quarterly Census of Employment and Wages",
  SEC: "U.S. Securities and Exchange Commission",
  SPC: "Storm Prediction Center, part of the National Weather Service",
  SVI: "Social Vulnerability Index",
  UCMR: "Unregulated Contaminant Monitoring Rule, the federal program that tests drinking water for unregulated chemicals",
  URL: "web address",
  US: "United States",
  USD: "United States dollars",
  USDA: "U.S. Department of Agriculture",
  USGS: "U.S. Geological Survey",
  ZCTA: "the Census area drawn for a postal code",
  ZHVI: "Zillow Home Value Index",
  ZIP: "postal code",
  ZORI: "Zillow Observed Rent Index",
};

/** A word with two or more capital letters ("FEMA", "PFHxS", "EPA" in "EPA's"). */
export const ACRONYM_TOKEN = /\b[A-Za-z0-9]*[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g;

/** Words with 2+ capitals in `text` that the glossary does not have. Words with a digit are codes (TX2270001), not acronyms. */
export function unglossed(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(ACRONYM_TOKEN)) {
    const w = m[0];
    if (/\d/.test(w) || w in GLOSSARY) continue;
    out.add(w);
  }
  return [...out];
}

/** A run of text: plain, or an acronym written out in full (first use) or with its expansion as a title. */
export type Seg = string | { abbr: string; full: string; first: boolean };

/**
 * Splits text into segments, spelling each acronym out the first time this
 * glosser meets it. One glosser per answer, fed in reading order. It is plain
 * data, built during render and never kept, so a repeated render starts over.
 */
export class Glosser {
  readonly seen: Set<string>;

  constructor(seen: Iterable<string> = []) {
    this.seen = new Set(seen);
  }

  gloss(text: string): Seg[] {
    const out: Seg[] = [];
    let last = 0;
    for (const m of text.matchAll(ACRONYM_TOKEN)) {
      const w = m[0];
      const full = GLOSSARY[w];
      if (!full) continue;
      const at = m.index ?? 0;
      if (at > last) out.push(text.slice(last, at));
      out.push({ abbr: w, full, first: !this.seen.has(w) });
      this.seen.add(w);
      last = at + w.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
}

/** The segments as the text a reader sees (the first use with its expansion in brackets). */
export function segText(segs: readonly Seg[]): string {
  return segs.map((s) => (typeof s === "string" ? s : s.first ? `${s.abbr} (${s.full})` : s.abbr)).join("");
}
