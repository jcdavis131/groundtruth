"use client";
// The one command registry every voice path talks to.
//
//   Web Speech API  ->  local intent parser  ->  runCommand()
//   ElevenLabs agent -> clientTools           ->  runCommand()
//   Vapi assistant   -> function-call message ->  runCommand()
//
// Each command returns a short sentence the agent can speak back.

import { useTrace } from "@/lib/fabric/traceStore";
import { upstreamAreaKm2, useUpstream } from "@/lib/fabric/upstreamStore";
import { useTeleport } from "@/lib/live/teleportStore";
import { flyTo, flyToSelection, homeView, startFollowing, stopFollowing } from "@/lib/globe/camera";
import { goLive, setMissionTime } from "@/lib/globe/clock";
import { allFeatures } from "@/lib/globe/registry";
import { LAYERS, LAYER_BY_ID } from "@/lib/layers";
import type { LayerId } from "@/lib/layers/types";
import { useGlobe } from "@/lib/store/globe";
import { geocode, heightForPlace } from "@/components/hud/SearchCommand";
import { formatDistance, formatLatLon } from "@/lib/globe/geo";
import { speakReport } from "@/lib/water/report";
import { reportFromGlobe } from "@/lib/water/reportClient";
import { speakMarketReport } from "@/lib/economy/report";
import { marketReportFromGlobe } from "@/lib/economy/reportClient";
import { PRESETS, presetTarget } from "@/lib/explore/presets";
import { applyShare } from "@/lib/globe/share";
import { useIndicators } from "@/lib/indicators/store";
import { useReleases, isValidVintage, vintageClockMs } from "@/lib/releases/store";
import { useWatchlists } from "@/lib/watch/store";
import { useScreener } from "@/lib/screener/store";
import { ENTITY_KINDS, type EntityKind } from "@/lib/screener/fields";
import { useDesk } from "@/lib/desk/store";
import { PERSONAS, personaFromWords } from "@/lib/personas/registry";
import { applyPersona, useLens } from "@/lib/personas/store";
import { useStrata } from "@/lib/fabric/strataStore";
import { currentFabric, useAscend } from "@/lib/fabric/strataClient";
import { compareFabrics, compareSummary } from "@/lib/fabric/compare";
import type { Fabric } from "@/lib/fabric/types";

export interface JsonSchema {
  type: "object";
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
}

export interface CommandDef {
  name: string;
  description: string;
  parameters: JsonSchema;
  run: (args: Record<string, unknown>) => Promise<string>;
}

const LAYER_ALIASES: Record<string, LayerId> = {
  aircraft: "aircraft",
  airplanes: "aircraft",
  planes: "aircraft",
  flights: "aircraft",
  flight: "aircraft",
  jets: "aircraft",
  ships: "ships",
  ship: "ships",
  vessels: "ships",
  boats: "ships",
  satellites: "satellites",
  satellite: "satellites",
  sats: "satellites",
  orbit: "satellites",
  earthquakes: "earthquakes",
  quakes: "earthquakes",
  seismic: "earthquakes",
  cameras: "cameras",
  webcams: "cameras",
  cctv: "cameras",
  launches: "launches",
  rockets: "launches",
  rocket: "launches",
  water: "water",
  "national risk index": "riskindex",
  "risk index": "riskindex",
  "disaster risk": "riskindex",
  "natural hazard risk": "riskindex",
  "hazard risk": "riskindex",
  "community health": "health",
  "health estimates": "health",
  "places data": "health",
  "diabetes rate": "health",
  "chronic disease": "health",
  health: "health",
  "social vulnerability index": "vulnerability",
  "social vulnerability": "vulnerability",
  "vulnerable communities": "vulnerability",
  svi: "vulnerability",
  "broadband availability": "broadband",
  "internet access": "broadband",
  "fiber internet": "broadband",
  broadband: "broadband",
  internet: "broadband",
  fiber: "broadband",
  "wildfire risk to communities": "wildfirerisk",
  "wildfire risk ranks": "wildfirerisk",
  "wildfire ranking": "wildfirerisk",
  "wildfire risk": "wildfirerisk",
  "housing assistance": "housing",
  "housing vouchers": "housing",
  "housing choice vouchers": "housing",
  "section 8": "housing",
  "qualified census tracts": "housing",
  "qualified census tract": "housing",
  qct: "housing",
  "tax credit properties": "housing",
  "tax-credit properties": "housing",
  lihtc: "housing",
  "difficult development areas": "housing",
  "difficult development area": "housing",
  dda: "housing",
  "landslide susceptibility": "landslidesusc",
  "landslide susceptible terrain": "landslidesusc",
  "trust land": "tribal",
  "bia land": "tribal",
  reservations: "tribal",
  "hospital ratings": "hospitals",
  "hospital star ratings": "hospitals",
  "trauma centers": "hospitals",
  "trauma centres": "hospitals",
  hospitals: "hospitals",
  hospital: "hospitals",
  "public schools": "schools",
  "school locations": "schools",
  schools: "schools",
  "national heritage": "heritage",
  "national parks": "heritage",
  "national park units": "heritage",
  "heritage areas": "heritage",
  battlefields: "heritage",
  "unesco sites": "heritage",
  "aerial photos by year": "naip",
  "aerial photographs": "naip",
  "aerial photos": "naip",
  naip: "naip",
  "rivers and streams": "hydro",
  "stream network": "hydro",
  streams: "hydro",
  hydrography: "hydro",
  nhd: "hydro",
  rivers: "water",
  river: "water",
  lakes: "water",
  lake: "water",
  reservoirs: "water",
  reservoir: "water",
  gauges: "water",
  "stream gauges": "water",
  floods: "water",
  flooding: "water",
  hydrology: "water",
  groundwater: "groundwater",
  aquifers: "groundwater",
  aquifer: "groundwater",
  wells: "groundwater",
  drought: "groundwater",
  turbidity: "turbidity",
  sediment: "turbidity",
  "water quality": "turbidity",
  "satellite water": "turbidity",
  trade: "trade",
  ports: "trade",
  port: "trade",
  harbours: "trade",
  harbors: "trade",
  shipping: "trade",
  borders: "trade",
  "border crossings": "trade",
  crossings: "trade",
  commerce: "commerce",
  jobs: "commerce",
  employment: "commerce",
  wages: "commerce",
  business: "commerce",
  economy: "commerce",
  "real estate": "realestate",
  housing: "realestate",
  "home values": "realestate",
  homes: "realestate",
  rents: "realestate",
  property: "realestate",
  "property values": "realestate",
  companies: "companies",
  "public companies": "companies",
  "listed companies": "companies",
  stocks: "companies",
  tickers: "companies",
  banks: "banks",
  "bank branches": "banks",
  deposits: "banks",
  spending: "spending",
  "federal spending": "spending",
  "federal dollars": "spending",
  contracts: "spending",
  grants: "spending",
  constructs: "constructs",
  "place fabric": "constructs",
  jurisdictions: "constructs",
  districts: "constructs",
  watersheds: "constructs",
  boundaries: "constructs",
  field: "field",
  "construct field": "field",
  emergence: "field",
  // "alerts" is the Live warnings layer's own id; "warnings" goes there too.
  warnings: "alerts",
  "live warnings": "alerts",
  wildfire: "wildfire",
  wildfires: "wildfire",
  "fire perimeters": "wildfire",
  fires: "fires",
  fire: "fires",
  hotspots: "fires",
  "active fires": "fires",
  firms: "fires",
  hazards: "hazards",
  "hazard alerts": "hazards",
  "weather alerts": "hazards",
  disasters: "hazards",
  volcanoes: "hazards",
  "flood zones": "flood",
  floodplain: "flood",
  "flood map": "flood",
  fema: "flood",
  wetlands: "wetlands",
  wetland: "wetlands",
  marsh: "wetlands",
  "public lands": "publiclands",
  "public land": "publiclands",
  "protected areas": "publiclands",
  parks: "publiclands",
  "national forests": "publiclands",
  "shaded relief": "relief",
  hillshade: "relief",
  relief: "relief",
  slope: "slope",
  slopes: "slope",
  steepness: "slope",
  contours: "contours",
  contour: "contours",
  "contour lines": "contours",
  "topo lines": "contours",
  soils: "soils",
  soil: "soils",
  "soil survey": "soils",
  farmland: "soils",
  "wildfire hazard": "firehazard",
  "wildfire hazard potential": "firehazard",
  "wildfire potential": "firehazard",
  "fire hazard": "firehazard",
  "land cover": "landcover",
  landcover: "landcover",
  nlcd: "landcover",
  "sea level rise": "sealevel",
  "sea-level rise": "sealevel",
  "sea level": "sealevel",
  "historic places": "historic",
  "historic place": "historic",
  "historic sites": "historic",
  "national register": "historic",
  "historic landmarks": "historic",
  landmarks: "historic",
  historic: "historic",
  "critical habitat": "crithab",
  "endangered species": "crithab",
  "threatened species": "crithab",
  endangered: "crithab",
  "contaminated sites": "contaminants",
  contamination: "contaminants",
  contaminants: "contaminants",
  "superfund sites": "contaminants",
  "national priorities list": "contaminants",
  "npl sites": "contaminants",
  "leaking underground storage tanks": "ust",
  "underground storage tanks": "ust",
  "leaking tanks": "ust",
  "storage tanks": "ust",
  lust: "ust",
  "formerly used defense sites": "contaminants",
  "old military sites": "contaminants",
  fuds: "contaminants",
  munitions: "contaminants",
  superfund: "contaminants",
  brownfields: "contaminants",
  brownfield: "contaminants",
  "toxic release inventory": "contaminants",
  "toxic releases": "contaminants",
  "hazardous waste": "contaminants",
  "historic imagery": "wayback",
  "historical imagery": "wayback",
  "historical aerials": "wayback",
  "historical aerial": "wayback",
  "historic aerials": "wayback",
  "old imagery": "wayback",
  "old satellite imagery": "wayback",
  wayback: "wayback",
  "drinking water pfas": "pfas",
  "pfas in water": "pfas",
  "forever chemicals": "pfas",
  pfas: "pfas",
  "impaired waters": "impaired",
  "impaired water": "impaired",
  "303d list": "impaired",
  "303d": "impaired",
  "polluted waters": "impaired",
  "polluted water": "impaired",
  "water quality listings": "impaired",
  "historic topo maps": "topo",
  "historical topo maps": "topo",
  "historic topographic maps": "topo",
  "historical topographic maps": "topo",
  "historic maps": "topo",
  "historical maps": "topo",
  "historical topo": "topo",
  "old topo maps": "topo",
  "old maps": "topo",
  "topographic maps": "topo",
  "topo maps": "topo",
  // Infrastructure and geohazards. "planes" stays with aircraft and "reservoirs" with surface water.
  "transmission lines": "transmission",
  transmission: "transmission",
  "power lines": "transmission",
  "power grid": "transmission",
  grid: "transmission",
  pipelines: "pipelines",
  pipeline: "pipelines",
  "gas pipelines": "pipelines",
  "oil pipelines": "pipelines",
  "power plants": "plants",
  "power stations": "plants",
  "nuclear plants": "plants",
  "nuclear power plants": "plants",
  plants: "plants",
  rail: "rail",
  railroads: "rail",
  railways: "rail",
  "rail lines": "rail",
  railroad: "rail",
  trains: "rail",
  airports: "airports",
  airport: "airports",
  airfields: "airports",
  heliports: "airports",
  dams: "dams",
  dam: "dams",
  faults: "faults",
  "fault lines": "faults",
  "quaternary faults": "faults",
  landslides: "landslides",
  landslide: "landslides",
  mudslides: "landslides",
  geology: "geology",
  "geologic map": "geology",
  bedrock: "geology",
  rocks: "geology",
  plss: "plss",
  "survey grid": "plss",
  townships: "plss",
  sections: "plss",
  "public land survey": "plss",
  "air quality": "airquality",
  "air pollution": "airquality",
  aqi: "airquality",
  smog: "airquality",
  airnow: "airquality",
  "news events": "events",
  "conflict events": "events",
  gdelt: "events",
  protests: "events",
  parcels: "parcels",
  parcel: "parcels",
  "parcel lines": "parcels",
  "lot lines": "parcels",
  "property lines": "parcels",
  "tax parcels": "parcels",
  zoning: "zoning",
  "zoning districts": "zoning",
  "zoning map": "zoning",
  "land use": "zoning",
  "building permits": "permits",
  "construction permits": "permits",
  "permits": "permits",
  "business licences": "licences",
  "business licenses": "licences",
  "liquor licences": "licences",
  "liquor licenses": "licences",
  licences: "licences",
  licenses: "licences",
  "environmental permits": "envpermits",
  "discharge permits": "envpermits",
  "clean water act": "envpermits",
  "army corps permits": "envpermits",
};

export function resolveLayer(word: string | undefined): LayerId | null {
  if (!word) return null;
  const w = word.toLowerCase().trim();
  // An alias counts only for a layer that is registered (air quality can be switched off).
  const id = LAYER_ALIASES[w] ?? (w as LayerId);
  return LAYER_BY_ID[id] ? id : null;
}

async function goToPlace(place: string, altitudeKm?: number): Promise<string> {
  const hits = await geocode(place);
  if (hits.length === 0) return `I could not find a place called ${place}.`;
  const h = hits[0];
  const height = altitudeKm ? altitudeKm * 1000 : heightForPlace(h);
  flyTo(h.lon, h.lat, { height });
  return `Moving over ${h.name.split(",").slice(0, 2).join(",")}.`;
}

/** Switch the constructs stack on and wait (up to ~15 s) for it to land under the camera. */
async function stackReady(): Promise<Fabric | null> {
  const g = useGlobe.getState();
  g.setLayer("constructs", true);
  useStrata.getState().setRailOpen(true);
  for (let i = 0; i < 30; i++) {
    const f = currentFabric();
    if (f?.nodes.length && !useGlobe.getState().status.constructs?.loading) return f;
    await new Promise((r) => setTimeout(r, 500));
  }
  return currentFabric();
}

export const COMMANDS: CommandDef[] = [
  {
    name: "fly_to_place",
    description: "Move the camera over a named place (city, country, airport, landmark).",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "Place name, e.g. 'Austin, Texas' or 'Heathrow'" },
        altitude_km: { type: "number", description: "Optional camera altitude in kilometres" },
      },
      required: ["place"],
    },
    run: async (a) => goToPlace(String(a.place ?? ""), a.altitude_km ? Number(a.altitude_km) : undefined),
  },
  {
    name: "show_layer",
    description: "Turn a data layer on or off, optionally moving over a place first.",
    parameters: {
      type: "object",
      properties: {
        layer: {
          type: "string",
          description: "Layer id",
          enum: LAYERS.map((l) => l.id),
        },
        on: { type: "boolean", description: "true to show, false to hide" },
        place: { type: "string", description: "Optional place to fly to" },
      },
      required: ["layer", "on"],
    },
    run: async (a) => {
      const id = resolveLayer(String(a.layer ?? ""));
      if (!id) return `Unknown layer ${a.layer}.`;
      const on = a.on !== false && a.on !== "false";
      useGlobe.getState().setLayer(id, on);
      const label = LAYER_BY_ID[id]?.label ?? id;
      let msg = `${label} ${on ? "on" : "off"}.`;
      if (a.place) msg = `${await goToPlace(String(a.place))} ${msg}`;
      return msg;
    },
  },
  {
    name: "find_object",
    description: "Find a flight, ship, satellite or camera among loaded objects by callsign, name or id and fly to it.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Callsign, vessel name, satellite name, MMSI or ICAO hex" },
        follow: { type: "boolean", description: "Keep the camera locked on it" },
      },
      required: ["query"],
    },
    run: async (a) => {
      const q = String(a.query ?? "").trim().toLowerCase().replace(/\s+/g, "");
      if (!q) return "What should I look for?";
      let best: { score: number; layer: LayerId; id: string; name: string } | null = null;
      for (const f of allFeatures()) {
        const p = f.properties;
        // The outline of a land layer's loaded box is not something to find.
        if (p.kind === "loaded-box") continue;
        // A label-only name (a LIHTC project's) is never matched: "" equals, starts and contains no query.
        const name = p.nameNotSearchable ? "" : p.name.toLowerCase().replace(/\s+/g, "");
        const id = p.id.toLowerCase();
        let score = 0;
        if (name === q || id === q) score = 3;
        else if (name.startsWith(q) || id.startsWith(q)) score = 2;
        else if (name.includes(q)) score = 1;
        if (score > (best?.score ?? 0)) best = { score, layer: p.layer, id: p.id, name: p.name };
      }
      if (!best) return `No loaded object matches ${a.query}. Try turning on the right layer or moving closer.`;
      const follow = a.follow === true || a.follow === "true";
      flyToSelection({ layer: best.layer, id: best.id }, follow);
      return `${follow ? "Tracking" : "Found"} ${best.name}.`;
    },
  },
  {
    name: "follow_selected",
    description: "Lock or release the camera on the currently selected object.",
    parameters: {
      type: "object",
      properties: { on: { type: "boolean", description: "true to follow, false to release" } },
      required: ["on"],
    },
    run: async (a) => {
      const on = a.on !== false && a.on !== "false";
      if (on) {
        if (!useGlobe.getState().selected) return "Nothing is selected.";
        startFollowing();
        return "Camera locked.";
      }
      stopFollowing();
      return "Camera released.";
    },
  },
  {
    name: "set_time",
    description: "Move the mission clock: back or forward by minutes, or snap to live.",
    parameters: {
      type: "object",
      properties: {
        offset_minutes: { type: "number", description: "Offset from now in minutes; negative = past" },
        live: { type: "boolean", description: "true to return to live time" },
      },
    },
    run: async (a) => {
      if (a.live === true || a.live === "true" || a.offset_minutes == null) {
        goLive();
        return "Mission clock is live.";
      }
      const m = Number(a.offset_minutes);
      setMissionTime(Date.now() + m * 60_000);
      return `Mission clock set to ${m < 0 ? Math.abs(m) + " minutes ago" : m + " minutes ahead"}.`;
    },
  },
  {
    name: "home_view",
    description: "Zoom out to the whole planet.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      homeView();
      return "Pulling back to orbit.";
    },
  },
  {
    name: "water_report",
    description:
      "Community water report for a place or the current view: drought class, reservoir levels, stream gauge flood status and quality screening, groundwater wells and aquifers, satellite turbidity, and an explicit supply-stress estimate.",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "Optional place to fly to first, e.g. 'San Antonio'" },
      },
    },
    run: async (a) => {
      const st = useGlobe.getState();
      let prefix = "";
      if (a.place) prefix = (await goToPlace(String(a.place), 120)) + " ";
      st.setLayer("water", true);
      st.setLayer("groundwater", true);
      st.setWaterReportOpen(true);
      // Give the layers a moment to land before reading them.
      await new Promise((r) => setTimeout(r, a.place ? 6000 : 1500));
      const v = useGlobe.getState().view;
      const report = reportFromGlobe(v.lon, v.lat);
      return prefix + speakReport(report);
    },
  },
  {
    name: "trace_downstream",
    description:
      "Follow the water from a place or the current view to the sea: the chain of USGS subwatersheds (HUC-12) it drains through, drawn on the globe, and how it ends (ocean, closed basin, Mexico, Canada).",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "Optional place to fly to first, e.g. 'Austin'" },
      },
    },
    run: async (a) => {
      let prefix = "";
      if (a.place) prefix = (await goToPlace(String(a.place), 120)) + " ";
      const st = useGlobe.getState();
      st.setLayer("water", true);
      const v = st.view;
      await useTrace.getState().run(v.lon, v.lat);
      const t = useTrace.getState();
      if (!t.steps.length) return prefix + `I could not trace the water here${t.error ? `: ${t.error}` : "."}`;
      return (
        prefix +
        `From ${t.startName}, the water passes through ${t.steps.length} subwatersheds` +
        `${t.terminal ? ` to the ${t.terminal}` : ", and I stopped before it reached the end"}. The path is drawn on the globe.`
      );
    },
  },
  {
    name: "trace_upstream",
    description:
      "Show everything that drains to a place or the current view: its catchment as whole USGS watersheds, the area, and what the gauges inside it read against normal for today.",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "Optional place to fly to first, e.g. 'Austin'" },
      },
    },
    run: async (a) => {
      let prefix = "";
      if (a.place) prefix = (await goToPlace(String(a.place), 120)) + " ";
      const v = useGlobe.getState().view;
      await useUpstream.getState().run(v.lon, v.lat);
      const u = useUpstream.getState();
      if (!u.cover.length) return prefix + `I could not find what drains here${u.error ? `: ${u.error}` : "."}`;
      const { km2 } = upstreamAreaKm2(u);
      return prefix + `${u.huc12s.toLocaleString("en-US")} subwatersheds drain to ${u.startName}${km2 ? `, about ${Math.round(km2).toLocaleString("en-US")} square kilometres` : ""}. The catchment is drawn on the globe.`;
    },
  },
  {
    name: "teleport",
    description: "Teleport to wherever the world is doing something unusual right now: NWS warnings rated Severe or Extreme and M4.5+ earthquakes, strongest first. Say it again for the next one.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const t = useTeleport.getState();
      if (t.active && t.items.length) t.next();
      else await t.start();
      const s = useTeleport.getState();
      const item = s.items[s.index];
      if (!item) return s.error ? `I could not reach the live feeds: ${s.error}` : "Nothing rated Severe or Extreme is active right now. A quiet planet.";
      return `${item.title}: ${item.subtitle}.`;
    },
  },
  {
    name: "market_report",
    description:
      "Market report for a place or the current view: typical home value and rent with one- and five-year changes, a mortgage-against-wages estimate, jobs and wages, the nearest ports and border crossings, and a momentum index with its formula.",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "Optional place to fly to first, e.g. 'Austin'" },
      },
    },
    run: async (a) => {
      const st = useGlobe.getState();
      let prefix = "";
      if (a.place) prefix = (await goToPlace(String(a.place), 150)) + " ";
      st.setLayer("realestate", true);
      st.setLayer("commerce", true);
      st.setLayer("trade", true);
      st.setMarketReportOpen(true);
      await new Promise((r) => setTimeout(r, a.place ? 7000 : 2000));
      const v = useGlobe.getState().view;
      return prefix + speakMarketReport(marketReportFromGlobe(v.lon, v.lat));
    },
  },
  {
    name: "explore_preset",
    description:
      "Jump to one of the curated explorations (a place with the right layers switched on: water, ports, housing markets, constructs, fires, flood zones, wetlands, public lands), or start the guided tour.",
    parameters: {
      type: "object",
      properties: {
        preset: { type: "string", description: "Preset id or a word from its title", enum: PRESETS.map((p) => p.id) },
        tour: { type: "boolean", description: "true to start the guided tour instead" },
      },
    },
    run: async (a) => {
      const st = useGlobe.getState();
      if (a.tour === true || a.tour === "true") {
        st.setTour({ active: true, index: 0, startedAt: Date.now(), paused: false });
        return "Starting the tour.";
      }
      const q = String(a.preset ?? "").toLowerCase();
      const p = PRESETS.find((x) => x.id === q) ?? PRESETS.find((x) => `${x.title} ${x.region}`.toLowerCase().includes(q));
      if (!p) return `No preset matches ${a.preset}. Try one of: ${PRESETS.map((x) => x.title).join(", ")}.`;
      applyShare(await presetTarget(p));
      return `${p.title}, ${p.region}. ${p.blurb}`;
    },
  },
  {
    name: "open_panel",
    description: "Open or close one of the practitioner panels: the screener, the named indicators, the release calendar (or its movers tab), the watchlist, or desk mode.",
    parameters: {
      type: "object",
      properties: {
        panel: { type: "string", description: "Which panel", enum: ["screener", "indicators", "releases", "movers", "watchlist", "desk", "hud", "lens"] },
        on: { type: "boolean", description: "true to open (default), false to close" },
      },
      required: ["panel"],
    },
    run: async (a) => {
      const on = a.on !== false && a.on !== "false";
      switch (String(a.panel)) {
        case "screener":
          useScreener.getState().setOpen(on);
          return on ? "Screener open. Say 'screen counties where rents rising and jobs falling'." : "Screener closed.";
        case "indicators":
          useIndicators.getState().setOpen(on);
          return on ? "Indicators open." : "Indicators closed.";
        case "releases":
          useReleases.getState().setTab("calendar");
          useReleases.getState().setReleasesOpen(on);
          return on ? "Release calendar open." : "Releases closed.";
        case "movers":
          useReleases.getState().setTab("movers");
          useReleases.getState().setReleasesOpen(on);
          return on ? "Showing the biggest movers since the last release." : "Releases closed.";
        case "watchlist":
          useWatchlists.getState().setOpen(on);
          return on ? "Watchlist open. Say 'watch this' to add the selected object." : "Watchlist closed.";
        case "lens":
          useLens.getState().setPickerOpen(on);
          return on ? "Pick a lens." : "Lens picker closed.";
        case "hud":
          useDesk.getState().setMode("hud");
          return "Back to the HUD.";
        case "desk":
          useDesk.getState().setMode(on ? "desk" : "hud");
          return on ? "Desk mode on." : "Back to the HUD.";
        default:
          return `Unknown panel ${a.panel}.`;
      }
    },
  },
  {
    name: "screen",
    description: "Run a screen: rank and filter counties, states, ports, border crossings or countries with the screener query language, e.g. 'rent.yoyPct > 5 AND jobs.yoy.emp < 0 SORT momentum DESC'.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", description: "Entity kind", enum: [...ENTITY_KINDS] },
        query: { type: "string", description: "Screener query text; plain phrases like 'rents rising and jobs falling' are mapped to the nearest preset" },
      },
      required: ["kind", "query"],
    },
    run: async (a) => {
      const kind = String(a.kind ?? "county") as EntityKind;
      if (!ENTITY_KINDS.includes(kind)) return `Unknown kind ${a.kind}.`;
      const raw = String(a.query ?? "").trim();
      const phrases: Array<[RegExp, string]> = [
        [/rent.*(rising|up).*jobs.*(falling|down)/, "rent.yoyPct > 0 AND jobs.yoy.emp < 0 SORT rent.yoyPct DESC"],
        [/cheapest price.to.rent|price.to.rent/, "priceToRent > 0 SORT priceToRent ASC"],
        [/hottest|momentum/, "SORT momentum DESC"],
        [/busiest|trucks/, "SORT trucks DESC"],
        [/losing (teu|containers)|teu (falling|down)/, "teu.yoyPct < 0 SORT teu DESC"],
        [/surplus/, "balance > 0 SORT balance DESC"],
        [/deficit/, "balance < 0 SORT balance ASC"],
      ];
      const hit = phrases.find(([re]) => re.test(raw.toLowerCase()));
      const queryText = hit ? hit[1] : raw;
      const st = useScreener.getState();
      st.setOpen(true);
      await st.runScreen({ kind, queryText });
      const after = useScreener.getState();
      if (after.error) return `Screen failed: ${after.error}`;
      return `${after.rows.length} ${kind === "country" ? "countries" : kind === "county" ? "counties" : kind + "s"} match. Top: ${after.rows.slice(0, 3).map((r) => r.name).join(", ")}.`;
    },
  },
  {
    name: "watch_selected",
    description: "Add the selected county, state, port, crossing, gauge or company to the active watchlist.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const res = useWatchlists.getState().addSelection();
      useWatchlists.getState().setOpen(true);
      return res.ok ? "Added to your watchlist." : `Could not add it: ${res.reason ?? "select a county, port, crossing, gauge or company first"}.`;
    },
  },
  {
    name: "set_vintage",
    description: "Pin a data vintage date (YYYY-MM-DD) on the permalink and the mission clock, or clear it when no date is given.",
    parameters: {
      type: "object",
      properties: { date: { type: "string", description: "ISO date, e.g. 2026-08-15; omit to clear" } },
    },
    run: async (a) => {
      const d = a.date ? String(a.date) : "";
      if (!d) {
        useReleases.getState().setVintage(null);
        goLive();
        return "Vintage cleared; back to live.";
      }
      if (!isValidVintage(d)) return `${d} is not a valid date.`;
      useReleases.getState().setVintage(d);
      setMissionTime(vintageClockMs(d));
      return `Vintage pinned to ${d}.`;
    },
  },
  {
    name: "set_lens",
    description: "Switch the lens (who is looking): real estate, economist, trader, water and ecology, supply chain, public finance, or explorer. Sets layers, the arrival panel and the camera.",
    parameters: {
      type: "object",
      properties: {
        lens: { type: "string", description: "Lens id or a role word such as 'realtor' or 'hydrologist'", enum: PERSONAS.map((p) => p.id) },
      },
      required: ["lens"],
    },
    run: async (a) => {
      const p = personaFromWords(String(a.lens ?? ""));
      if (!p) {
        useLens.getState().setPickerOpen(true);
        return `I do not know that lens. Pick one: ${PERSONAS.map((x) => x.title).join(", ")}.`;
      }
      applyPersona(p.id);
      return `Lens: ${p.title}. ${p.tagline} Landing on ${p.start.label}.`;
    },
  },
  {
    name: "ascend",
    description:
      "Powers of Ten: fly up through the constructs stack at a place or the current view, one construct at a time from the smallest (flood zone, tract, subwatershed) to the country, each framed with its name, area and what is loaded inside it. Any tap or key stops it.",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "Optional place to fly to first, e.g. 'Corpus Christi'" },
      },
    },
    run: async (a) => {
      let prefix = "";
      if (a.place) {
        prefix = (await goToPlace(String(a.place), 40)) + " ";
        useStrata.getState().setPin(null);
        await new Promise((r) => setTimeout(r, 4500));
      }
      const f = await stackReady();
      if (!f?.nodes.length) return prefix + "The constructs stack did not load here, so there is nothing to ascend through.";
      if (!useAscend.getState().start()) return prefix + "I could not start the ascent.";
      const steps = useAscend.getState().steps;
      const first = f.nodes.find((n) => n.id === steps[0]);
      const last = f.nodes.find((n) => n.id === steps[steps.length - 1]);
      return prefix + `Ascending through ${steps.length} constructs, from ${first?.name ?? "the ground"} to ${last?.name ?? "the top"}.`;
    },
  },
  {
    name: "compare_places",
    description:
      "Compare two places by the constructs they sit inside: which they share (same county, same watershed) and where they differ (different congressional district, different school district). Drops pin B on the globe, marks the shared constructs and puts the comparison in the share link.",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "The second place (B), e.g. 'Portland, Texas'" },
        from: { type: "string", description: "Optional first place (A); defaults to the current view" },
      },
      required: ["place"],
    },
    run: async (a) => {
      let prefix = "";
      if (a.from) {
        prefix = (await goToPlace(String(a.from), 60)) + " ";
        useStrata.getState().setPin(null);
        await new Promise((r) => setTimeout(r, 4500));
      }
      const hits = await geocode(String(a.place ?? ""));
      if (!hits.length) return prefix + `I could not find a place called ${a.place}.`;
      const f = await stackReady();
      if (!f?.nodes.length) return prefix + "The constructs stack did not load here, so there is nothing to compare.";
      const strata = useStrata.getState();
      strata.setPin({ lon: f.point.lon, lat: f.point.lat });
      await strata.setCompare({ lon: hits[0].lon, lat: hits[0].lat });
      const b = useStrata.getState().compareFabric;
      const name = hits[0].name.split(",").slice(0, 2).join(",");
      if (!b) return prefix + `I could not read the constructs at ${name}${useStrata.getState().compareError ? `: ${useStrata.getState().compareError}` : "."}`;
      const c = compareFabrics(f, b);
      return prefix + `Compared with ${name}: ${compareSummary(c) || "nothing in common among the usual constructs"}. ${c.shared} shared, ${c.differs} different.`;
    },
  },
  {
    name: "describe_view",
    description: "Summarise what the operator is looking at: camera target, altitude, layer counts, selection.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const s = useGlobe.getState();
      const parts = [`Camera over ${formatLatLon(s.view.lat, s.view.lon)} at ${formatDistance(s.view.height)}.`];
      const on = LAYERS.filter((l) => s.layers[l.id]);
      if (on.length) {
        parts.push(
          "Layers: " +
            on.map((l) => `${l.label} ${s.status[l.id]?.count ?? 0}${l.simulated ? " simulated" : ""}`).join(", ") +
            ".",
        );
      }
      if (s.selectedFeature) parts.push(`Selected ${s.selectedFeature.properties.name}.`);
      return parts.join(" ");
    },
  },
];

export const COMMAND_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

export async function runCommand(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const cmd = COMMAND_BY_NAME.get(name);
  if (!cmd) return `Unknown command ${name}.`;
  try {
    const out = await cmd.run(args);
    useGlobe.getState().pushLog({ level: "info", text: `VOICE ${name} → ${out}` });
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    useGlobe.getState().pushLog({ level: "warn", text: `VOICE ${name} failed: ${msg}` });
    return `That failed: ${msg}`;
  }
}

/** OpenAI-style function definitions (what Vapi and ElevenLabs both accept). */
export function toolDefinitions() {
  return COMMANDS.map((c) => ({
    type: "function" as const,
    function: { name: c.name, description: c.description, parameters: c.parameters },
  }));
}
