// The sourceId -> publisher host table cite-check will fetch from, and what a record URL must contain to be this
// item's. A host not in the table is never fetched. The regexes are copied from RECORD_HOSTS in
// lib/mcp/world.test.ts (written there independently of world.ts); a follow-up PR makes that test import this file.

import type { CiteItem } from "./types";

export const RECORD_HOSTS: Record<string, RegExp> = {
  "census-tigerweb": /^https:\/\/tigerweb\.geo\.census\.gov\/arcgis\/rest\/services\//,
  "nws-api": /^https:\/\/api\.weather\.gov\//,
  "usgs-wbd": /^https:\/\/hydro\.nationalmap\.gov\//,
  "fema-nfhl": /^https:\/\/hazards\.fema\.gov\//,
  "epa-ecoregions": /^https:\/\/geodata\.epa\.gov\//,
  "usgs-epqs": /^https:\/\/epqs\.nationalmap\.gov\//,
  "fema-nri": /^https:\/\/services\.arcgis\.com\/XG15cJAlne2vxtgt\/arcgis\/rest\/services\/National_Risk_Index_Counties\//,
  "fema-openfema": /^https:\/\/www\.fema\.gov\/api\/open\//,
  usdm: /^https:\/\/usdmdataservices\.unl\.edu\//,
  "usgs-earthquakes": /^https:\/\/earthquake\.usgs\.gov\//,
  "bls-qcew": /^https:\/\/data\.bls\.gov\/cew\//,
  "cdc-svi": /^https:\/\/services3\.arcgis\.com\/ZvidGQkLaDJxRSJ2\//,
  "hifld-hospitals": /^https:\/\/services\.arcgis\.com\/XG15cJAlne2vxtgt\/arcgis\/rest\/services\/Hospitals_RAPT\//,
  "cms-provider-data": /^https:\/\/data\.cms\.gov\/provider-data\//,
  "usace-nid": /^https:\/\/geospatial\.sec\.usace\.army\.mil\//,
  "sec-edgar": /^https:\/\/data\.sec\.gov\//,
  "epa-cws-boundaries": /^https:\/\/services\.arcgis\.com\/cJ9YHowT8TU7DUyn\/arcgis\/rest\/services\/Water_System_Boundaries\//,
  "epa-ucmr5-pat": /^https:\/\/services\.arcgis\.com\/cJ9YHowT8TU7DUyn\/arcgis\/rest\/services\/PFAS_Analytic_Tools_Layers\//,
};

/**
 * User-Agent strings, as the app already sends them (lib/server/ua.ts USER_AGENT; lib/companies/edgar.ts
 * SEC_USER_AGENT). SEC and BLS answer 403 to a string carrying a GitHub URL or a "curl" token, so neither
 * carries one. A test reads both source files and fails if these drift from them.
 */
export const USER_AGENT = "embedding-atlas/0.1 (+https://eye.jcamd.com; open-source globe)";
export const SEC_USER_AGENT = "embedding-atlas/0.1 contact: jcdavis131@gmail.com";

export function userAgentFor(url: string): string {
  return /^https:\/\/(?:data|www)\.sec\.gov\//.test(url) ? SEC_USER_AGENT : USER_AGENT;
}

/** TIGERweb tigerWMS_Current layer per fact, as lib/mcp/world.test.ts TIGER_FACT_LAYERS. */
export const TIGER_FACT_LAYERS: Record<string, number[]> = {
  county: [82],
  "county touching the box": [82],
  state: [80],
  "census tract": [8],
  "ZIP code area (ZCTA)": [2],
  "city or town": [28],
  "congressional district": [54],
  "school district": [14, 16, 18],
  "metro or micro area (CBSA)": [91, 93],
};

const dec = (u: string): string => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

/**
 * What the record URL must contain for this item, taken from the item (its code, period, fact), never from the URL.
 * An empty list means the item names nothing the URL could be checked against (the matcher then reads the id out of
 * the reply). A string is matched against the decoded URL.
 */
export function requiredIds(item: CiteItem): Array<string | RegExp> | { refused: string } {
  const code = item.code ?? "";
  switch (item.sourceId) {
    case "census-tigerweb": {
      const layers = TIGER_FACT_LAYERS[item.fact];
      if (!layers) return { refused: `no TIGERweb layer is known for the fact "${item.fact}"` };
      if (!code) return { refused: "the item has no GEOID" };
      return [`GEOID='${code}'`, new RegExp(`/tigerWMS_Current/MapServer/(${layers.join("|")})/query\\?`)];
    }
    case "nws-api": {
      if (/^NWS alert$/.test(item.fact)) return { refused: "an NWS alert is a live event and expires; its record cannot be re-fetched later" };
      return ["/points/"];
    }
    case "usgs-epqs":
      return ["x=", "&y="];
    case "fema-nfhl":
      return item.fact === "NFIP community" ? [`CID='${code}'`] : ["geometry="];
    case "usgs-wbd":
      return [`huc12='${code}'`];
    case "epa-ecoregions":
      return [`US_L3CODE='${code}'`];
    case "fema-nri":
      return [/STCOFIPS='\d{5}'/];
    case "cdc-svi":
      return [/FIPS='\d{5}'/];
    case "fema-openfema":
      return item.fact === "FEMA declaration" ? [`disasterNumber eq ${code.replace(/^[A-Z]+-/, "")}`] : [/fipsStateCode eq '\d{2}'/, /fipsCountyCode eq '\d{3}'/];
    case "usdm": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.period ?? "");
      if (!m) return { refused: "the item states no map date" };
      const d = `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
      return [/aoi=\d{5}&/, `startdate=${d}&`, `enddate=${d}&`, /[?&]statisticsType=2$/];
    }
    case "bls-qcew": {
      const m = /^(\d{4}) Q([1-4])$/.exec(item.period ?? "");
      if (!m) return { refused: "the item states no QCEW quarter" };
      return [new RegExp(`/${m[1]}/${m[2]}/area/(\\d{5}|\\d{2}000)\\.csv$`)];
    }
    case "hifld-hospitals":
      return [`ID='${code.replace(/^hifld-hosp:/, "")}'`];
    case "cms-provider-data":
      return [`=${code}&`];
    case "usace-nid":
      return [`NIDID='${code.replace(/^nid:/, "")}'`];
    case "sec-edgar":
      return [`CIK${code.replace(/^CIK /, "").padStart(10, "0")}.json`];
    case "epa-cws-boundaries":
      return [`PWSID='${code}'`];
    case "epa-ucmr5-pat": {
      const c = item.fact.replace(/^UCMR 5 highest single result: /, "");
      return [`F_PWS_ID='${code}'`, ...(c !== item.fact ? [`Contaminant='${c}'`] : [])];
    }
    default:
      return { refused: `no id rule for ${item.sourceId}` };
  }
}

/** Why the item's record URL cannot be fetched: its source is not in the table, the host is wrong, or an id the item names is absent. Null if it can. */
export function refusal(item: CiteItem): string | null {
  const url = item.upstreamRecordUrl;
  if (!url) return null;
  const host = RECORD_HOSTS[item.sourceId];
  if (!host) return `source ${item.sourceId} is not in the host table`;
  if (!host.test(url)) return `the record URL is not on ${item.sourceId}'s own host`;
  const ids = requiredIds(item);
  if (!Array.isArray(ids)) return ids.refused;
  const d = dec(url);
  for (const id of ids) {
    if (typeof id === "string" ? !d.includes(id) : !id.test(d)) return `the record URL does not name ${typeof id === "string" ? id : id.source}`;
  }
  return null;
}

/**
 * A short file-safe key for the record this URL names, for the recorded fixture's file name. A readable part from the
 * id in the URL, then a hash of the whole URL so two queries on one id (UCMR contaminants) never share a file.
 */
export function recordIdOf(sourceId: string, url: string): string {
  const d = dec(url);
  const m = (re: RegExp): string => re.exec(d)?.slice(1).join("-") ?? "";
  let key = "";
  switch (sourceId) {
    case "census-tigerweb":
      key = m(/MapServer\/(\d+)\/query\?where=GEOID='([^']+)'/);
      break;
    case "nws-api":
      key = m(/points\/([-\d.]+),([-\d.]+)/);
      break;
    case "fema-openfema":
      key = m(/disasterNumber eq (\d+)/) || m(/fipsStateCode eq '(\d+)' and fipsCountyCode eq '(\d+)'/);
      break;
    case "bls-qcew":
      key = m(/\/(\d{4})\/(\d)\/area\/(\w+)\.csv/);
      break;
    case "usdm":
      key = m(/aoi=(\d+)&startdate=([\d/]+)&/).replace(/\//g, "_");
      break;
    case "fema-nri":
    case "cdc-svi":
      key = m(/(?:STCOFIPS|FIPS)='(\d+)'/);
      break;
    case "cms-provider-data":
      key = m(/value\]=(\w+)&/);
      break;
    case "usace-nid":
      key = m(/NIDID='(\w+)'/);
      break;
    case "sec-edgar":
      key = m(/(CIK\d+)\.json/);
      break;
    case "epa-cws-boundaries":
      key = m(/PWSID='(\w+)'/);
      break;
    case "epa-ucmr5-pat":
      key = m(/F_PWS_ID='(\w+)'(?: AND UCMR_Cycle='[^']*')?(?: AND Contaminant='(\w+)')?/);
      break;
    case "hifld-hospitals":
      key = m(/ID='(\w+)'/);
      break;
    case "usgs-wbd":
      key = m(/huc12='(\w+)'/);
      break;
    case "epa-ecoregions":
      key = m(/US_L3CODE='(\w+)'/);
      break;
    case "fema-nfhl":
      key = m(/CID='(\w+)'/) || m(/geometry=([-\d.]+),([-\d.]+)/);
      break;
    case "usgs-epqs":
      key = m(/x=([-\d.]+)&y=([-\d.]+)/);
      break;
    default:
      key = "";
  }
  key = key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "record";
  return `${key}.${fnv(url)}`;
}

/** 8 hex chars of an FNV-1a hash: a stable short suffix, not a security hash. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
