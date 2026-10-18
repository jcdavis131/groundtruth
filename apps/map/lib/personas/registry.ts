// Lenses: who is looking, and therefore which layers turn on, where the globe
// lands, which panel opens first and which chips lead the phone nav. A lens is
// data, so adding one is one object here; nothing else in the app enumerates
// them. Every lens can still reach every layer through the Layers panel.

import type { LayerId } from "@/lib/layers/types";
import type { CategoryFilter } from "@/lib/indicators/store";
import type { EntityKind } from "@/lib/screener/fields";

export type PersonaId = "realestate" | "economist" | "trader" | "water" | "logistics" | "banking" | "civic" | "explorer";

/** Panels a lens can open on arrival; ids match lib/personas/actions.ts. */
export type PanelId = "layers" | "strata" | "water" | "market" | "space" | "measure" | "signals" | "screen" | "releases" | "watch" | "explore" | "teleport" | "share";

export interface PersonaStep {
  text: string;
  /** Tapping the step opens this panel. */
  panel?: PanelId;
}

export interface Persona {
  id: PersonaId;
  title: string;
  /** One word for the phone nav chip. */
  short: string;
  /** Who this is for, one line, shown on the picker card. */
  who: string;
  /** What you get, one line. */
  tagline: string;
  /** Lucide icon name resolved in components/hud/PersonaPicker.tsx. */
  icon: "Home" | "LineChart" | "CandlestickChart" | "Droplets" | "Ship" | "Landmark" | "Layers" | "Globe2";
  color: string;
  /** Layers switched on (every other layer goes off). */
  layers: LayerId[];
  /** Layers that stay off on phones because they cost too much (kept in `layers` for desktop). */
  heavy?: LayerId[];
  start: { lon: number; lat: number; height: number; label: string };
  /** Panel opened on arrival. */
  open?: PanelId;
  indicatorCategory?: CategoryFilter;
  screener?: { kind: EntityKind; query: string };
  /** Nav chip order on phones; chips not listed follow in default order. */
  nav: PanelId[];
  /** Explore preset ids shown first under "For your lens". */
  presets: string[];
  /** First steps, shown once per lens in a "Start here" card. */
  steps: PersonaStep[];
  /** Words the voice intent parser maps to this lens. */
  aliases: string[];
}

export const PERSONAS: Persona[] = [
  {
    id: "realestate",
    title: "Real estate",
    short: "Realty",
    who: "Agents, investors, appraisers, relocation",
    tagline: "Home values, rents, affordability and jobs for every county, with the arithmetic shown.",
    icon: "Home",
    color: "#f7b955",
    layers: ["realestate", "commerce", "water"],
    start: { lon: -97.75, lat: 30.3, height: 160_000, label: "Austin housing" },
    open: "market",
    indicatorCategory: "housing",
    screener: { kind: "county", query: "home.yoyPct > 5 AND jobs.yoy.emp > 0 SORT momentum DESC LIMIT 50" },
    nav: ["market", "screen", "signals", "watch", "layers", "releases", "explore", "share", "water"],
    presets: ["austin-housing", "bay-area-values", "states-markets"],
    steps: [
      { text: "Open the market report for the county under the reticle: typical home value, rent, mortgage against wages.", panel: "market" },
      { text: "Screen every county by momentum, price-to-rent or one-year change.", panel: "screen" },
      { text: "Watch a county and get an RSS feed when its numbers move.", panel: "watch" },
    ],
    aliases: ["realtor", "real estate", "real estate agent", "broker", "appraiser", "home buyer", "investor", "landlord"],
  },
  {
    id: "economist",
    title: "Economist",
    short: "Econ",
    who: "Macro, regional and labour economists, journalists",
    tagline: "Nineteen named indicators, the release calendar, movers since the last release, and history with citations.",
    icon: "LineChart",
    color: "#5ef2c2",
    layers: ["commerce", "trade", "realestate"],
    start: { lon: -97, lat: 39, height: 6_500_000, label: "the United States" },
    open: "signals",
    indicatorCategory: "all",
    screener: { kind: "county", query: "jobs.yoy.emp < 0 AND avgWeeklyWage.yoyPct > 0 SORT jobs.yoy.emp ASC LIMIT 50" },
    nav: ["signals", "releases", "screen", "market", "watch", "layers", "explore", "share", "water"],
    presets: ["states-markets", "world-trade", "laredo"],
    steps: [
      { text: "Read the signals: river stages, freight, housing, energy, labour and trade, each with its threshold and source.", panel: "signals" },
      { text: "Check the release calendar and what moved since the last release.", panel: "releases" },
      { text: "Screen counties or countries, then export the CSV with provenance footers.", panel: "screen" },
    ],
    aliases: ["economist", "macro", "analyst", "researcher", "journalist", "policy"],
  },
  {
    id: "trader",
    title: "Trader",
    short: "Trader",
    who: "Equity, commodity and macro traders",
    tagline: "Freight and energy signals, public companies at their HQ, port congestion nowcasts, watchlists with alerts.",
    icon: "CandlestickChart",
    color: "#ff5ea8",
    layers: ["companies", "trade", "ships", "aircraft"],
    heavy: ["aircraft"],
    start: { lon: -118.22, lat: 33.76, height: 90_000, label: "Los Angeles and Long Beach" },
    open: "signals",
    indicatorCategory: "freight",
    screener: { kind: "port", query: "teu.yoyPct < 0 SORT teu DESC LIMIT 30" },
    nav: ["signals", "watch", "screen", "market", "layers", "releases", "explore", "share", "water"],
    presets: ["la-long-beach", "houston-ship-channel", "world-trade"],
    steps: [
      { text: "Freight and energy signals first: Laredo trucks, LA and Long Beach TEU, ships waiting for a berth, diesel, WTI.", panel: "signals" },
      { text: "Tap a company for its filings, XBRL facts and sector ETF bridge; zoom below 3,000 km to see them.", panel: "layers" },
      { text: "Put ports, counties and indicators on a watchlist and subscribe to the feed.", panel: "watch" },
    ],
    aliases: ["trader", "stock trader", "markets", "portfolio manager", "pm", "hedge fund", "quant"],
  },
  {
    id: "water",
    title: "Water & ecology",
    short: "Water",
    who: "Biologists, hydrologists, water utilities, conservation",
    tagline: "Rivers, reservoirs, wells, drought, gauge chemistry and Sentinel-2 turbidity computed in your browser.",
    icon: "Droplets",
    color: "#6fc3ff",
    layers: ["water", "groundwater", "turbidity"],
    start: { lon: -98.34, lat: 29.28, height: 60_000, label: "Calaveras and Braunig lakes" },
    open: "water",
    indicatorCategory: "water",
    screener: { kind: "county", query: "SORT home.yoyPct DESC LIMIT 20" },
    nav: ["water", "layers", "signals", "watch", "explore", "share", "releases", "screen", "market"],
    presets: ["bexar-reservoirs", "edwards-aquifer", "chesapeake", "lake-erie", "lake-mead"],
    steps: [
      { text: "Open the water report: drought class, reservoir storage, gauge flood status and chemistry, wells and aquifers.", panel: "water" },
      { text: "Tap a gauge for a year of daily values; below 300 km the turbidity chips appear next to the gauges.", panel: "layers" },
      { text: "Watch a gauge and get an alert when the stage crosses a level.", panel: "watch" },
    ],
    aliases: ["biologist", "hydrologist", "ecologist", "water", "environmental", "conservation", "utility", "scientist"],
  },
  {
    id: "logistics",
    title: "Supply chain",
    short: "Supply",
    who: "Logistics, shipping, freight and trade operations",
    tagline: "Harbours with TEU history, land crossings with monthly trucks, live ships and cargo flights, port vessel counts.",
    icon: "Ship",
    color: "#7cffb2",
    layers: ["trade", "ships", "aircraft"],
    heavy: ["aircraft"],
    start: { lon: -99.5, lat: 27.55, height: 160_000, label: "the Laredo crossings" },
    open: "signals",
    indicatorCategory: "freight",
    screener: { kind: "crossing", query: "SORT trucks DESC LIMIT 30" },
    nav: ["signals", "screen", "layers", "watch", "releases", "explore", "share", "market", "water"],
    presets: ["laredo", "la-long-beach", "houston-ship-channel", "detroit-windsor"],
    steps: [
      { text: "Freight signals: truck crossings, container volume, ships waiting for a berth, the Shanghai to LA box rate.", panel: "signals" },
      { text: "Rank crossings by trucks or ports by TEU, then export.", panel: "screen" },
      { text: "Tap a harbour for its volumes; tap a crossing for 25 months of counts.", panel: "layers" },
    ],
    aliases: ["logistics", "supply chain", "shipping", "freight", "trade", "operations", "importer", "exporter"],
  },
  {
    id: "banking",
    title: "Public finance",
    short: "Finance",
    who: "Bankers, municipal analysts, grant writers, local government",
    tagline: "Bank offices and county deposit markets, federal obligations per county, jobs and wages, water stress.",
    icon: "Landmark",
    color: "#c9a3ff",
    layers: ["banks", "spending", "commerce", "water"],
    start: { lon: -97.75, lat: 30.3, height: 250_000, label: "Travis County" },
    open: "market",
    indicatorCategory: "labour",
    screener: { kind: "county", query: "jobs.emp > 50000 SORT avgWeeklyWage.yoyPct DESC LIMIT 50" },
    nav: ["market", "layers", "screen", "signals", "watch", "releases", "explore", "share", "water"],
    presets: ["austin-housing", "states-markets"],
    steps: [
      { text: "Tap a county for federal obligations by award family and dollars per covered job, with recipients and agencies.", panel: "layers" },
      { text: "Tap a bank office for deposits, the county deposit market and its HHI.", panel: "layers" },
      { text: "The market report adds home values, wages and the companies headquartered there.", panel: "market" },
    ],
    aliases: ["banker", "banking", "public finance", "municipal", "muni", "government", "grant", "treasurer", "city"],
  },
  {
    id: "civic",
    title: "Civic & planning",
    short: "Civic",
    who: "Planners, local government, journalists, civic technologists, students",
    tagline: "Every jurisdiction, district, watershed and ecoregion over a place, lit by what the physical layers put inside it.",
    icon: "Layers",
    color: "#c4b5fd",
    layers: ["constructs", "field", "alerts", "water", "companies", "banks", "earthquakes"],
    start: { lon: -97.74, lat: 30.27, height: 90_000, label: "downtown Austin" },
    open: "layers",
    nav: ["layers", "explore", "teleport", "water", "market", "signals", "screen", "releases", "watch", "share"],
    presets: ["constructs-austin", "constructs-field-texas", "constructs-bexar"],
    steps: [
      { text: "Tap the white Here node for every construct over the camera target, grouped by point of view." },
      { text: "Pick a point of view for the construct field and zoom: states give way to counties, water regions to subwatersheds.", panel: "layers" },
      { text: "Select a watershed and trace where its water goes; gauges along the way are joined to it." },
    ],
    aliases: ["civic", "planner", "planning", "jurisdiction", "district", "constructs", "urbanist"],
  },
  {
    id: "explorer",
    title: "Explorer",
    short: "All",
    who: "Everyone else: the spy-satellite view of the planet",
    tagline: "Live aircraft, ships, satellites, earthquakes and launches, plus every layer above when you want it.",
    icon: "Globe2",
    color: "#ffffff",
    layers: ["aircraft", "ships", "satellites", "earthquakes", "launches", "water"],
    heavy: ["satellites", "aircraft"],
    start: { lon: -97.74, lat: 30.27, height: 12_000_000, label: "orbit" },
    nav: ["layers", "explore", "teleport", "water", "market", "signals", "screen", "releases", "watch", "share"],
    presets: ["planet", "bexar-reservoirs", "world-trade"],
    steps: [
      { text: "Tap anything on the globe for its dossier; the layers panel says what each feed covers.", panel: "layers" },
      { text: "Explore has curated places and a guided tour.", panel: "explore" },
    ],
    aliases: ["explorer", "everything", "default", "all", "spy", "tourist", "curious"],
  },
];

export const PERSONA_BY_ID: Record<PersonaId, Persona> = Object.fromEntries(PERSONAS.map((p) => [p.id, p])) as Record<PersonaId, Persona>;

export function isPersonaId(v: unknown): v is PersonaId {
  return typeof v === "string" && v in PERSONA_BY_ID;
}

/** Map a spoken or typed word ("realtor", "hydrologist") to a lens. */
export function personaFromWords(text: string): Persona | null {
  const t = text.toLowerCase();
  for (const p of PERSONAS) {
    if (t.includes(p.id) || t.includes(p.title.toLowerCase())) return p;
    if (p.aliases.some((a) => t.includes(a))) return p;
  }
  return null;
}
