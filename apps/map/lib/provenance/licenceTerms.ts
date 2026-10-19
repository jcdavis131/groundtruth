// Licence vocabulary for sources. A SourceRef may carry `licenseId`, a key in
// LICENCE_TERMS, next to its free-text `license` string. The string stays as the
// human note: it holds the caveats ("not legal documents", "owner names redacted
// under Daniel's Law", required credit lines) that an id can't. The id is what a
// script or an MCP caller can look up in one place.
//
// Not the business-licence data in lib/layers/licences.ts or lib/permits/licences.ts.
//
// Idea from awesome-selfhosted's licenses.yml (a controlled list of SPDX ids plus
// named entries). That list is CC-BY-SA-3.0; nothing was copied from it. Every
// entry below is a fact: an id, a name and the URL of the terms.
//
// Rules for filling `licenseId` in sources.ts:
// - Only when the source's own string maps to an entry with confidence. Leave it
//   out otherwise; the lint lists every source without one.
// - The id names the terms on what we actually fetch. `esri-mla` is for items Esri
//   authored or summarised (World Imagery Wayback, Esri's FCC summary layer). A
//   government dataset that an Esri-hosted item merely re-serves under the MLA gets
//   no id: the government string and the MLA disagree, so the string carries both.
// - `us-gov-work` is for works of the U.S. federal government, which 17 U.S.C. 105
//   leaves outside copyright. It is not for state, county or city data, even when
//   the publisher calls that data public, and not for federal compilations of
//   records that others wrote or submitted (EDGAR filings, the National Address
//   Database, PAD-US, the National Inventory of Dams, landslide and fault
//   inventories built from state surveys, EONET's relayed events).

export type LicenceKind = "spdx" | "named";

export interface LicenceTerm {
  /** SPDX licence id, or a named id for terms SPDX doesn't list. */
  id: string;
  kind: LicenceKind;
  /** The name as the terms give it. */
  name: string;
  /** Where the terms are published. */
  url: string;
}

const spdx = (id: string, name: string): LicenceTerm => ({ id, kind: "spdx", name, url: `https://spdx.org/licenses/${id}.html` });

export const LICENCE_TERMS = {
  "CC-BY-4.0": spdx("CC-BY-4.0", "Creative Commons Attribution 4.0 International"),
  "CC-BY-SA-4.0": spdx("CC-BY-SA-4.0", "Creative Commons Attribution Share Alike 4.0 International"),
  "CC0-1.0": spdx("CC0-1.0", "Creative Commons Zero v1.0 Universal"),
  "ODbL-1.0": spdx("ODbL-1.0", "Open Data Commons Open Database License v1.0"),
  "PDDL-1.0": spdx("PDDL-1.0", "Open Data Commons Public Domain Dedication & License 1.0"),
  MIT: spdx("MIT", "MIT License"),
  "us-gov-work": { id: "us-gov-work", kind: "named", name: "U.S. Government work, not subject to copyright (17 U.S.C. 105)", url: "https://www.copyright.gov/title17/92chap1.html#105" },
  "esri-mla": { id: "esri-mla", kind: "named", name: "Esri Master License Agreement", url: "https://www.esri.com/en-us/legal/terms/full-master-agreement" },
  "fred-terms": { id: "fred-terms", kind: "named", name: "FRED Legal Notices, Information and Disclaimers", url: "https://fred.stlouisfed.org/legal/" },
  "zillow-research-terms": { id: "zillow-research-terms", kind: "named", name: "Zillow Research data terms of use", url: "https://www.zillow.com/research/data/" },
  "opensky-terms": { id: "opensky-terms", kind: "named", name: "OpenSky Network terms of use", url: "https://opensky-network.org/about/terms-of-use" },
  "copernicus-sentinel-data": { id: "copernicus-sentinel-data", kind: "named", name: "Legal notice on the use of Copernicus Sentinel Data and Service Information", url: "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice" },
  "natural-earth-terms": { id: "natural-earth-terms", kind: "named", name: "Natural Earth terms of use (public domain)", url: "https://www.naturalearthdata.com/about/terms-of-use/" },
  "ogl-british-columbia": { id: "ogl-british-columbia", kind: "named", name: "Open Government Licence - British Columbia", url: "https://www2.gov.bc.ca/gov/content/data/policy-standards/open-data/open-government-licence-bc" },
  "sg-open-data-1.0": { id: "sg-open-data-1.0", kind: "named", name: "Singapore Open Data Licence version 1.0", url: "https://data.gov.sg/open-data-licence" },
  "tfl-open-data-terms": { id: "tfl-open-data-terms", kind: "named", name: "Transport for London transport data service terms and conditions", url: "https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service" },
  "gdelt-terms": { id: "gdelt-terms", kind: "named", name: "GDELT Project terms of use", url: "https://www.gdeltproject.org/about.html#termsofuse" },
  "youtube-terms": { id: "youtube-terms", kind: "named", name: "YouTube Terms of Service", url: "https://www.youtube.com/t/terms" },
  "chicago-data-terms": { id: "chicago-data-terms", kind: "named", name: "City of Chicago data portal terms of use", url: "https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html" },
} as const satisfies Record<string, LicenceTerm>;

export type LicenceId = keyof typeof LICENCE_TERMS;

export function isLicenceId(id: string): id is LicenceId {
  return Object.prototype.hasOwnProperty.call(LICENCE_TERMS, id);
}

export function licenceTerm(id: string): LicenceTerm | undefined {
  return isLicenceId(id) ? LICENCE_TERMS[id] : undefined;
}

export interface LicenceLint {
  /** Sources whose licenseId isn't in LICENCE_TERMS. The lint fails on these. */
  unknown: Array<{ source: string; licenseId: string }>;
  /** Sources with no licenseId. Reported, not failed. */
  missing: string[];
  /** Sources with a known licenseId. */
  mapped: number;
}

/** Check every source's licenseId against the vocabulary. */
export function lintLicences(sources: Record<string, { id: string; licenseId?: string }>): LicenceLint {
  const out: LicenceLint = { unknown: [], missing: [], mapped: 0 };
  for (const [key, ref] of Object.entries(sources)) {
    if (ref.licenseId === undefined) out.missing.push(key);
    else if (!isLicenceId(ref.licenseId)) out.unknown.push({ source: key, licenseId: ref.licenseId });
    else out.mapped++;
  }
  return out;
}
