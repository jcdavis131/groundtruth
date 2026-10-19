// The indicator registry. Every entry reuses a reader the app already has
// (FRED, BTS, USGS daily values, TWDB) and states, in words, why the series
// matters and where each threshold comes from. Levels that are conventions
// rather than official figures say so in their label.
//
// To add an indicator: append an object here with a unique id, a source that
// exists in lib/provenance/sources.ts, and a fetch() that returns a Series
// with provenance. The tests in registry.test.ts check the rest.

import { borderCrossings, btsIndicators, btsPortStats, fred } from "@/lib/economy/sources";
import { findCrossing, seriesFromCrossing, seriesFromPorts, seriesFromPulse, seriesFromUsgs, twdbStatewide } from "./readers";
import type { Indicator, IndicatorCategory } from "./types";

const FRED_URL = (id: string) => `https://fred.stlouisfed.org/series/${id}`;
const BTS_INDICATORS_URL = "https://data.bts.gov/resource/y5ut-ibwt.json";

/** Shared fetch for a FRED series already listed in FRED_SERIES. */
function fredFetch(fredId: string): Indicator["fetch"] {
  return async (ctx) => {
    const item = await fred(fredId);
    if (!item) throw new Error(`FRED ${fredId}: no rows`);
    return seriesFromPulse(ctx.indicator, item, { sourceId: "fred", upstreamUrl: FRED_URL(fredId) });
  };
}

/** Shared fetch for one of the BTS supply-chain indicators in btsIndicators(). */
function btsFetch(pulseId: string): Indicator["fetch"] {
  return async (ctx) => {
    const item = (await btsIndicators()).find((i) => i.id === pulseId);
    if (!item) throw new Error(`BTS indicator ${pulseId}: not in the latest pull`);
    return seriesFromPulse(ctx.indicator, item, { sourceId: "bts-supply-chain", upstreamUrl: BTS_INDICATORS_URL });
  };
}

/** Shared fetch for a USGS daily-value parameter at one site. */
function usgsFetch(site: string, param: string): Indicator["fetch"] {
  return (ctx) => seriesFromUsgs(ctx.indicator, site, param, ctx.now);
}

const NWS_FLOOD = "NWS National Water Prediction Service flood categories, https://water.noaa.gov/";
const CONVENTION = "convention chosen for this dashboard, not an official level";

export const INDICATORS: readonly Indicator[] = [
  // ---------------------------------------------------------------- water / inland waterways
  {
    id: "mississippi-memphis-stage",
    title: "Mississippi River at Memphis, stage",
    category: "water",
    unit: "ft",
    whyItMatters:
      "Memphis is the reference gauge for the lower Mississippi barge corridor that carries most US grain exports. Low stages force lighter barge drafts and fewer barges per tow; the October 2022 low of about -10.8 ft stranded tows and pushed barge rates to records.",
    source: "usgs-water",
    seriesId: "USGS-07032000:00065",
    geo: { kind: "gauge", id: "USGS-07032000", name: "Mississippi River at Memphis, TN", lon: -90.0768, lat: 35.1231 },
    cadence: "daily",
    thresholds: [
      { level: "watch", op: "<=", value: -5, label: "low water, barge drafts restricted (convention)", citation: "USGS 07032000; 2022 low-water record about -10.8 ft, " + CONVENTION },
      { level: "alert", op: "<=", value: -8, label: "severe low water, tows lightened and split (convention)", citation: "USGS 07032000; 2022 low-water record about -10.8 ft, " + CONVENTION },
      { level: "alert", op: ">=", value: 34, label: "NWS flood stage at Memphis (34 ft)", citation: NWS_FLOOD + " gauge MEMT1" },
    ],
    fetch: usgsFetch("USGS-07032000", "00065"),
    relatedLayers: ["water"],
    flyTo: { lon: -90.0768, lat: 35.1231, height: 30_000 },
  },
  {
    id: "mississippi-stlouis-stage",
    title: "Mississippi River at St. Louis, stage",
    category: "water",
    unit: "ft",
    whyItMatters:
      "St. Louis sits where the Missouri and Illinois join the Mississippi and where lock-free open river begins. Stages near or below zero shrink the channel that grain, fertiliser and coal barges use between the upper river and the Gulf.",
    source: "usgs-water",
    seriesId: "USGS-07010000:00065",
    geo: { kind: "gauge", id: "USGS-07010000", name: "Mississippi River at St. Louis, MO", lon: -90.1797, lat: 38.6289 },
    cadence: "daily",
    thresholds: [
      { level: "watch", op: "<=", value: 0, label: "low water at St. Louis (convention)", citation: "USGS 07010000; " + CONVENTION },
      { level: "alert", op: ">=", value: 30, label: "NWS flood stage at St. Louis (30 ft)", citation: NWS_FLOOD + " gauge EADM7" },
    ],
    fetch: usgsFetch("USGS-07010000", "00065"),
    relatedLayers: ["water"],
    flyTo: { lon: -90.1797, lat: 38.6289, height: 30_000 },
  },
  {
    id: "ohio-louisville-stage",
    title: "Ohio River at Louisville, stage",
    category: "water",
    unit: "ft",
    whyItMatters:
      "The Ohio carries coal, steel inputs and grain to the Mississippi; Louisville's McAlpine Locks is the choke point. High water closes locks and halts tows.",
    source: "usgs-water",
    seriesId: "USGS-03294500:00065",
    geo: { kind: "gauge", id: "USGS-03294500", name: "Ohio River at Louisville, KY", lon: -85.7645, lat: 38.28 },
    cadence: "daily",
    thresholds: [{ level: "alert", op: ">=", value: 23, label: "NWS flood stage at Louisville upper gauge (23 ft)", citation: NWS_FLOOD + " gauge LOUK2" }],
    fetch: usgsFetch("USGS-03294500", "00065"),
    relatedLayers: ["water"],
    flyTo: { lon: -85.7645, lat: 38.28, height: 30_000 },
  },
  {
    id: "missouri-stjoseph-stage",
    title: "Missouri River at St. Joseph, stage",
    category: "water",
    unit: "ft",
    whyItMatters:
      "St. Joseph gauges the Missouri above Kansas City, where the navigation channel and floodplain farmland meet. Flood stage there means levee pressure downstream and interrupted rail and barge traffic.",
    source: "usgs-water",
    seriesId: "USGS-06818000:00065",
    geo: { kind: "gauge", id: "USGS-06818000", name: "Missouri River at St. Joseph, MO", lon: -94.8575, lat: 39.7528 },
    cadence: "daily",
    thresholds: [{ level: "alert", op: ">=", value: 17, label: "NWS flood stage at St. Joseph (17 ft)", citation: NWS_FLOOD + " gauge STJM7" }],
    fetch: usgsFetch("USGS-06818000", "00065"),
    relatedLayers: ["water"],
    flyTo: { lon: -94.8575, lat: 39.7528, height: 30_000 },
  },
  {
    id: "hoover-releases",
    title: "Colorado River below Hoover Dam, flow (Hoover releases)",
    category: "water",
    unit: "ft³/s",
    whyItMatters:
      "This is the water released from Lake Mead to Arizona, California, Nevada and Mexico, not the lake level itself. Releases track the Bureau of Reclamation's delivery schedule, so a sustained change is a policy signal for the lower basin.",
    source: "usgs-water",
    seriesId: "USGS-09421500:00060",
    geo: { kind: "gauge", id: "USGS-09421500", name: "Colorado River below Hoover Dam, AZ-NV", lon: -114.7372, lat: 36.0153 },
    cadence: "daily",
    thresholds: [],
    fetch: usgsFetch("USGS-09421500", "00060"),
    relatedLayers: ["water"],
    flyTo: { lon: -114.7372, lat: 36.0153, height: 25_000 },
  },
  {
    id: "texas-reservoirs-pct-full",
    title: "Texas reservoirs, statewide percent full",
    category: "water",
    unit: "%",
    whyItMatters:
      "Texas cities, power plants and irrigators draw on surface reservoirs whose statewide storage TWDB reports daily. Storage below 70 % has coincided with stage-2 municipal restrictions and curtailed irrigation in past droughts.",
    source: "twdb",
    seriesId: "twdb:statewide:percent_full",
    geo: { kind: "state", id: "48", name: "Texas" },
    cadence: "daily",
    thresholds: [
      { level: "watch", op: "<", value: 70, label: "below 70 % of conservation capacity (convention)", citation: "TWDB Water Data for Texas statewide summary; " + CONVENTION },
      { level: "alert", op: "<", value: 60, label: "below 60 % of conservation capacity (convention)", citation: "TWDB Water Data for Texas statewide summary; " + CONVENTION },
    ],
    invert: true,
    fetch: (ctx) => twdbStatewide(ctx.indicator, ctx.now),
    relatedLayers: ["water"],
    flyTo: { lon: -99.3, lat: 31.2, height: 1_400_000 },
  },

  // ---------------------------------------------------------------- freight
  {
    id: "laredo-trucks",
    title: "Laredo truck crossings, monthly",
    category: "freight",
    unit: "trucks",
    whyItMatters:
      "Laredo is the busiest US land port and the main gate for Mexican auto parts, electronics and produce. A year-over-year fall in truck counts shows up before it does in trade statistics.",
    source: "bts-border",
    seriesId: "bts-border:2304:Trucks",
    geo: { kind: "crossing", id: "2304", name: "Laredo, TX", lon: -99.5075, lat: 27.5036 },
    cadence: "monthly",
    thresholds: [{ level: "watch", op: "<", value: -5, on: "yoyPct", label: "trucks down more than 5 % year over year (convention)", citation: "BTS Border Crossing Entry Data; " + CONVENTION }],
    invert: true,
    fetch: async (ctx) => {
      const { rows } = await borderCrossings();
      const row = findCrossing(rows, "2304", /^Laredo/i, "Texas");
      if (!row) throw new Error("BTS border: Laredo not in the latest pull");
      return seriesFromCrossing(ctx.indicator, row, "Trucks");
    },
    relatedLayers: ["trade"],
    flyTo: { lon: -99.5075, lat: 27.5036, height: 40_000 },
  },
  {
    id: "la-lb-container-teu",
    title: "Los Angeles + Long Beach container volume, annual",
    category: "freight",
    unit: "TEU",
    whyItMatters:
      "San Pedro Bay handles roughly a third of US containerised imports, most of it from Asia. Annual TEU across the two ports is the broadest keyless measure of trans-Pacific goods demand.",
    source: "bts-ports",
    seriesId: "bts-ports:4120+4110:CONTAINER",
    geo: { kind: "port", id: "USLAX+USLGB", name: "Los Angeles and Long Beach", lon: -118.22, lat: 33.74 },
    cadence: "annual",
    thresholds: [{ level: "watch", op: "<", value: -5, on: "yoyPct", label: "TEU down more than 5 % on the prior year (convention)", citation: "BTS Port Performance Freight Statistics; " + CONVENTION }],
    invert: true,
    fetch: async (ctx) => {
      const { byWpi } = await btsPortStats();
      const stats = [byWpi.get(16080), byWpi.get(16070)].filter((s): s is NonNullable<typeof s> => !!s);
      if (stats.length < 2) throw new Error("BTS ports: Los Angeles or Long Beach missing");
      return seriesFromPorts(ctx.indicator, stats);
    },
    relatedLayers: ["trade", "ships"],
    flyTo: { lon: -118.22, lat: 33.74, height: 60_000 },
  },
  {
    id: "ships-awaiting-berth",
    title: "Containerships waiting for a berth, all US ports",
    category: "freight",
    unit: "ships",
    whyItMatters:
      "Ships at anchor waiting for a berth are the visible edge of port congestion. The 2021 queue off Los Angeles and Long Beach passed 100 ships; a normal week is a handful.",
    source: "bts-supply-chain",
    seriesId: "bts:Number of Containerships Awaiting Berths at all U.S. Ports",
    geo: { kind: "us", id: "US" },
    cadence: "weekly",
    thresholds: [
      { level: "watch", op: ">=", value: 20, label: "20 or more ships waiting nationally (convention)", citation: "BTS Supply Chain Indicators; " + CONVENTION },
      { level: "alert", op: ">=", value: 50, label: "50 or more ships waiting nationally (convention)", citation: "BTS Supply Chain Indicators; 2021 queue exceeded 100, " + CONVENTION },
    ],
    fetch: btsFetch("bts-berths"),
    relatedLayers: ["ships", "trade"],
  },
  {
    id: "shanghai-la-rate",
    title: "Shanghai to Los Angeles container rate",
    category: "freight",
    unit: "$ per 40 ft box",
    whyItMatters:
      "The spot price to ship a 40 ft container on the busiest trans-Pacific lane. It moves with vessel capacity, port congestion and tariff front-running, and it feeds into imported goods prices with a lag.",
    source: "bts-supply-chain",
    seriesId: "bts:Freight Rates in $ per 40ft Container from Shanghai to LA",
    geo: { kind: "world", id: "CNSHA-USLAX" },
    cadence: "weekly",
    thresholds: [{ level: "watch", op: ">=", value: 5000, label: "above $5,000 per box, about three times the 2019 level (convention)", citation: "BTS Supply Chain Indicators (Freightos data); " + CONVENTION }],
    fetch: btsFetch("bts-shanghai-la"),
    relatedLayers: ["ships", "trade"],
  },
  {
    id: "diesel-price",
    title: "US diesel retail price",
    category: "energy",
    unit: "$ per gallon",
    whyItMatters:
      "Diesel is the fuel of trucks, trains, tows and tractors, so its price passes straight into freight surcharges and farm costs. The June 2022 peak was $5.81 a gallon.",
    source: "bts-supply-chain",
    seriesId: "bts:U.S. Diesel Sales Prices (in Dollars per Gallon)",
    geo: { kind: "us", id: "US" },
    cadence: "weekly",
    thresholds: [
      { level: "watch", op: ">=", value: 4.5, label: "above $4.50 a gallon (convention)", citation: "BTS Supply Chain Indicators (EIA data); " + CONVENTION },
      { level: "alert", op: ">=", value: 5, label: "above $5.00 a gallon, within 15 % of the 2022 record (convention)", citation: "EIA weekly retail diesel; record $5.81 on 2022-06-20, " + CONVENTION },
    ],
    fetch: btsFetch("bts-diesel"),
  },

  // ---------------------------------------------------------------- energy
  {
    id: "wti-crude",
    title: "WTI crude oil, spot",
    category: "energy",
    unit: "$ per barrel",
    whyItMatters:
      "The US benchmark crude price sets drilling budgets in the Permian and Bakken and feeds gasoline and diesel prices. Dallas Fed Energy Survey respondents reported average breakevens for new wells in the low-to-mid $60s in recent years.",
    source: "fred",
    seriesId: "DCOILWTICO",
    geo: { kind: "us", id: "US" },
    cadence: "daily",
    thresholds: [
      { level: "watch", op: "<=", value: 55, label: "below typical shale new-well breakevens (convention)", citation: "Dallas Fed Energy Survey breakeven questions, https://www.dallasfed.org/research/surveys/des; " + CONVENTION },
      { level: "watch", op: ">=", value: 90, label: "above $90, a level that has preceded demand destruction (convention)", citation: "FRED DCOILWTICO; " + CONVENTION },
    ],
    fetch: fredFetch("DCOILWTICO"),
    relatedLayers: ["ships"],
  },

  // ---------------------------------------------------------------- housing
  {
    id: "mortgage-30y",
    title: "30-year fixed mortgage rate",
    category: "housing",
    unit: "%",
    whyItMatters:
      "The rate on the most common US home loan sets the monthly payment on a given price and so the number of households who can buy. Above 7 % the payment on a median home takes more of a median income than at any time since 2000.",
    source: "fred",
    seriesId: "MORTGAGE30US",
    geo: { kind: "us", id: "US" },
    cadence: "weekly",
    thresholds: [{ level: "watch", op: ">=", value: 7, label: "7 % or higher (convention)", citation: "Freddie Mac PMMS via FRED MORTGAGE30US; " + CONVENTION }],
    fetch: fredFetch("MORTGAGE30US"),
    relatedLayers: ["realestate"],
  },
  {
    id: "housing-starts",
    title: "Housing starts, annual rate",
    category: "housing",
    unit: "thousands of units",
    whyItMatters:
      "New homes started in the month, seasonally adjusted to an annual rate. Starts lead construction employment and lumber, cement and appliance demand by several months.",
    source: "fred",
    seriesId: "HOUST",
    geo: { kind: "us", id: "US" },
    cadence: "monthly",
    thresholds: [{ level: "watch", op: "<", value: -10, on: "yoyPct", label: "starts down more than 10 % year over year (convention)", citation: "Census / HUD New Residential Construction via FRED HOUST; " + CONVENTION }],
    invert: true,
    fetch: fredFetch("HOUST"),
    relatedLayers: ["realestate", "commerce"],
  },
  {
    id: "building-permits",
    title: "Building permits, annual rate",
    category: "housing",
    unit: "thousands of units",
    whyItMatters:
      "Permits are issued before starts, so they are the earliest published read on residential construction. A sustained fall shows builders pulling back before the jobs data does.",
    source: "fred",
    seriesId: "PERMIT",
    geo: { kind: "us", id: "US" },
    cadence: "monthly",
    thresholds: [{ level: "watch", op: "<", value: -10, on: "yoyPct", label: "permits down more than 10 % year over year (convention)", citation: "Census / HUD New Residential Construction via FRED PERMIT; " + CONVENTION }],
    invert: true,
    fetch: fredFetch("PERMIT"),
    relatedLayers: ["realestate", "commerce"],
  },
  {
    id: "case-shiller",
    title: "Case-Shiller US home price index",
    category: "housing",
    unit: "index, Jan 2000 = 100",
    whyItMatters:
      "A repeat-sales index of single-family home prices across the country, published with a two-month lag. A year-over-year fall is rare outside recessions and matters for household wealth and mortgage collateral.",
    source: "fred",
    seriesId: "CSUSHPINSA",
    geo: { kind: "us", id: "US" },
    cadence: "monthly",
    thresholds: [{ level: "watch", op: "<", value: 0, on: "yoyPct", label: "national index below a year earlier (convention)", citation: "S&P CoreLogic Case-Shiller via FRED CSUSHPINSA; " + CONVENTION }],
    fetch: fredFetch("CSUSHPINSA"),
    relatedLayers: ["realestate"],
  },

  // ---------------------------------------------------------------- labour
  {
    id: "unemployment-rate",
    title: "Unemployment rate",
    category: "labour",
    unit: "%",
    whyItMatters:
      "The share of the labour force without work, from the monthly household survey. The Sahm rule observes that a rise of half a point above the prior year's low has marked the start of every US recession since 1970.",
    source: "fred",
    seriesId: "UNRATE",
    geo: { kind: "us", id: "US" },
    cadence: "monthly",
    thresholds: [
      {
        level: "watch",
        op: ">=",
        value: 0.5,
        on: "yoyAbs",
        label: "up 0.5 point or more on a year earlier (Sahm-style, simplified: latest month minus the same month last year)",
        citation: "Sahm, C. (2019), Direct Stimulus Payments to Individuals, Hamilton Project; official rule uses the 3-month average against the prior 12-month low, FRED SAHMREALTIME",
      },
    ],
    fetch: fredFetch("UNRATE"),
    relatedLayers: ["commerce"],
  },

  // ---------------------------------------------------------------- trade
  {
    id: "trade-balance",
    title: "US goods and services trade balance, monthly",
    category: "trade",
    unit: "$ millions",
    whyItMatters:
      "Exports minus imports of goods and services, from the Census / BEA monthly report. Swings of tens of billions in a month usually mean tariff front-running or a gold or pharmaceutical shipment, not a change in trend.",
    source: "fred",
    seriesId: "BOPGSTB",
    geo: { kind: "us", id: "US" },
    cadence: "monthly",
    thresholds: [],
    fetch: fredFetch("BOPGSTB"),
    relatedLayers: ["trade"],
  },

  // ---------------------------------------------------------------- macro
  {
    id: "retail-sales",
    title: "Retail sales excluding food services, monthly",
    category: "macro",
    unit: "$ millions",
    whyItMatters:
      "Nominal store and online sales from the Census monthly retail survey, the first broad read on household spending each month. Because it is nominal, a year-over-year fall means real spending fell by more.",
    source: "fred",
    seriesId: "RSXFS",
    geo: { kind: "us", id: "US" },
    cadence: "monthly",
    thresholds: [{ level: "watch", op: "<", value: 0, on: "yoyPct", label: "nominal sales below a year earlier (convention)", citation: "Census Monthly Retail Trade via FRED RSXFS; " + CONVENTION }],
    invert: true,
    fetch: fredFetch("RSXFS"),
    relatedLayers: ["commerce"],
  },
];

export const INDICATOR_IDS: readonly string[] = INDICATORS.map((i) => i.id);

/** Look up one indicator; undefined for an unknown id. */
export function indicatorById(id: string, registry: readonly Indicator[] = INDICATORS): Indicator | undefined {
  return registry.find((i) => i.id === id);
}

/** Indicators in one category, registry order. */
export function indicatorsInCategory(category: IndicatorCategory, registry: readonly Indicator[] = INDICATORS): Indicator[] {
  return registry.filter((i) => i.category === category);
}
