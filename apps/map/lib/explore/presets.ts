// Curated starting points. Each one is just a permalink: a place, a height
// and which layers to switch on. The blurbs say what the layers will show
// there, not facts about the water; the data loads live when you arrive.
//
// Every preset below was probed against the USGS Water Data API on
// 2026-09-10 (gauges and wells inside a one-degree box) before it was
// listed, so none of them lands on an empty map. The hazards & land presets
// were probed on 2026-09-25 with the exact box each layer requests. Fires
// move, so the wildfire preset has no fixed place: it resolves when clicked.
// The terrain & soils presets were probed on 2026-09-26 at the point each one
// asks about (Soil Data Access, the WHP identify on a 0.05° grid, the NOAA
// 3 ft tile over Galveston Island, 3DEP EPQS and the contour render).
// The infrastructure, air and events presets were probed on 2026-09-26 by
// running each layer's own fetch at the preset's view against /api/infra,
// /api/cameras, /api/air and /api/events, so the counts in their blurbs are
// what that box held that day.
// The parcel presets were probed on 2026-09-26 through /api/parcels with the
// outline box the layer asks for at their height and an identify at the
// target; each opens the record of a publicly owned parcel.

import type { LayerFeature, LayerId } from "@/lib/layers/types";
import type { ShareState } from "@/lib/globe/share";
import type { FireExtra } from "@/lib/hazards/features";
import type { LonLat } from "@/lib/fabric/strataStore";
import { AIRNOW_ENABLED } from "@/lib/air/airnow";

export interface Preset {
  id: string;
  title: string;
  region: string;
  blurb: string;
  lon: number;
  lat: number;
  height: number;
  layers: LayerId[];
  /** Seconds the tour lingers here. */
  dwellS?: number;
  /** Open the community water report on arrival. */
  report?: boolean;
  /** Open the market report on arrival. */
  market?: boolean;
  /** Gallery section; water presets carry no group. */
  group?: "markets" | "constructs" | "hazards" | "terrain" | "infrastructure" | "parcels" | "civic";
  /** Open a "ground here" answer at this point on arrival (picture layers). */
  ground?: LonLat;
  /** Turn 3D terrain on at this exaggeration. */
  terrain?: number;
  /** Sea level rise scenario, feet above MHHW. */
  slr?: number;
  /** Open the parcel dossier at the target on arrival (parcels layer). */
  parcel?: boolean;
  /**
   * For places that move (the largest fire): where to go right now, asked
   * when the preset is used. The lat/lon above are the fallback.
   */
  resolve?: () => Promise<Partial<ShareState> | null>;
}

/** The current WFIGS perimeter with the most acres: its anchor, a height that frames it, and a selection. */
async function largestFire(): Promise<Partial<ShareState> | null> {
  const res = await fetch("/api/hazards?op=wildfire");
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: { features?: LayerFeature[] } };
  let best: LayerFeature | null = null;
  for (const f of j.data?.features ?? []) {
    const x = f.properties.extra as FireExtra;
    if (!x.hasPerimeter || x.type !== "WF") continue;
    if (!best || (x.acres ?? 0) > ((best.properties.extra as FireExtra).acres ?? 0)) best = f;
  }
  if (!best) return null;
  const g = best.geometry;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : [];
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const r of rings) for (const [lon, lat] of r) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  if (!Number.isFinite(w)) return null;
  const [lon, lat] = best.properties.anchor ?? [(w + e) / 2, (s + n) / 2];
  const spanKm = Math.max(e - w, n - s) * 111;
  return { lon, lat, h: Math.min(400_000, Math.max(40_000, spanKm * 2_200)), sel: { layer: "wildfire", id: best.properties.id } };
}

const ALL_PRESETS: Preset[] = [
  {
    id: "planet",
    title: "The planet's water",
    region: "whole Earth",
    blurb: "Every named river and lake from orbit with this week's US Drought Monitor classes draped on the ground. Descend below 1,500 km anywhere in the United States and the gauges appear.",
    lon: -97.7,
    lat: 30,
    height: 12_000_000,
    layers: ["water", "groundwater"],
    dwellS: 18,
  },
  {
    id: "bexar-reservoirs",
    title: "Calaveras & Braunig",
    region: "San Antonio, Texas",
    blurb: "Two reservoirs and the Medina River at 60 km: turbidity chips computed in your browser from the latest clear Sentinel-2 pass, next to USGS turbidity gauges with their reading at the overpass. This is the scene family the physics was validated on.",
    lon: -98.34,
    lat: 29.28,
    height: 60_000,
    layers: ["water", "turbidity", "groundwater"],
    dwellS: 45,
    report: true,
  },
  {
    id: "edwards-aquifer",
    title: "Edwards Aquifer wells",
    region: "San Antonio, Texas",
    blurb: "USGS monitoring wells labelled by the aquifer they tap, the drought class under the city, and stream gauges with full quality panels (oxygen, pH, conductance, turbidity). Open the water report for the arithmetic.",
    lon: -98.49,
    lat: 29.42,
    height: 120_000,
    layers: ["water", "groundwater"],
    dwellS: 30,
    report: true,
  },
  {
    id: "highland-lakes",
    title: "Highland Lakes",
    region: "Austin, Texas",
    blurb: "Texas Water Development Board reservoirs with percent-full and USGS reservoir gauges along the Colorado River chain. The report weights storage by capacity here, the one place the data allows it.",
    lon: -97.9,
    lat: 30.4,
    height: 120_000,
    layers: ["water", "groundwater"],
    dwellS: 30,
    report: true,
  },
  {
    id: "lake-mead",
    title: "Lake Mead & Hoover Dam",
    region: "Nevada / Arizona",
    blurb: "The densest water-quality instrumentation the presets were probed against: dozens of USGS turbidity and dissolved-oxygen gauges around the reservoir, with satellite turbidity chips to compare against them.",
    lon: -114.74,
    lat: 36.05,
    height: 150_000,
    layers: ["water", "turbidity", "groundwater"],
    dwellS: 45,
  },
  {
    id: "chesapeake",
    title: "Chesapeake Bay",
    region: "Annapolis, Maryland",
    blurb: "An estuary rather than a lake: USGS turbidity gauges on the tributaries, monitoring wells on the coastal plain, and Sentinel-2 chips over the bay itself.",
    lon: -76.45,
    lat: 38.95,
    height: 120_000,
    layers: ["water", "turbidity"],
    dwellS: 40,
  },
  {
    id: "lake-erie",
    title: "Western Lake Erie",
    region: "Toledo, Ohio",
    blurb: "The shallow western basin at 150 km with gauges on the Maumee and its neighbours, wells inland, and satellite turbidity chips across the open water.",
    lon: -83.4,
    lat: 41.7,
    height: 150_000,
    layers: ["water", "turbidity", "groundwater"],
    dwellS: 40,
  },
  {
    id: "okeechobee",
    title: "Lake Okeechobee",
    region: "Florida",
    blurb: "A large, shallow lake at 150 km: stream gauges on the canals, wells across the surrounding basin and turbidity chips over the lake.",
    lon: -80.8,
    lat: 26.95,
    height: 150_000,
    layers: ["water", "turbidity", "groundwater"],
    dwellS: 40,
  },
  {
    id: "baton-rouge",
    title: "Mississippi & Atchafalaya",
    region: "Baton Rouge, Louisiana",
    blurb: "Stream gauges with NWS flood categories along the lower Mississippi and the Atchafalaya basin at 200 km; drop below 100 km over the delta for satellite turbidity at 20 m.",
    lon: -91.3,
    lat: 30,
    height: 200_000,
    layers: ["water", "groundwater"],
    dwellS: 30,
  },
  {
    id: "el-paso",
    title: "Rio Grande at El Paso",
    region: "Texas / New Mexico",
    blurb: "A groundwater story: USGS wells on both sides of the river, the aquifers they draw from, and the drought class over the border basin.",
    lon: -106.5,
    lat: 31.75,
    height: 120_000,
    layers: ["groundwater", "water"],
    dwellS: 30,
    report: true,
  },
  // ---- Trade & markets (probed against /api/economy on 2026-09-10)
  {
    id: "world-trade",
    title: "Who trades with whom",
    region: "whole Earth",
    group: "markets",
    blurb: "Countries shaded by goods-and-services trade from the World Bank, the twenty largest labelled with exports. Click any country and its top export markets and import sources arrive as arcs from WITS.",
    lon: -40,
    lat: 25,
    height: 16_000_000,
    layers: ["trade"],
    dwellS: 25,
  },
  {
    id: "la-long-beach",
    title: "Los Angeles & Long Beach",
    region: "San Pedro Bay, California",
    group: "markets",
    blurb: "The two busiest container ports in the country side by side with their BTS TEU history, the counties around them with jobs, wages and home values, and the market report open.",
    lon: -118.22,
    lat: 33.76,
    height: 90_000,
    layers: ["trade", "commerce", "realestate"],
    dwellS: 40,
    market: true,
  },
  {
    id: "houston-ship-channel",
    title: "Houston Ship Channel",
    region: "Texas Gulf Coast",
    group: "markets",
    blurb: "Houston, Texas City, Freeport, Beaumont and Port Arthur: tonnage leaders with their top commodities, beside Harris County's jobs and wages.",
    lon: -95.0,
    lat: 29.7,
    height: 140_000,
    layers: ["trade", "commerce"],
    dwellS: 35,
  },
  {
    id: "laredo",
    title: "Laredo crossings",
    region: "US–Mexico border, Texas",
    group: "markets",
    blurb: "The busiest truck crossing in North America with 25 months of BTS counts, the other Rio Grande ports of entry, and Webb County's jobs.",
    lon: -99.5,
    lat: 27.55,
    height: 160_000,
    layers: ["trade", "commerce"],
    dwellS: 35,
  },
  {
    id: "detroit-windsor",
    title: "Detroit–Windsor",
    region: "US–Canada border, Michigan",
    group: "markets",
    blurb: "The Ambassador Bridge crossing and Port Huron, Detroit's harbour, and Wayne County's sector mix and home values.",
    lon: -83.05,
    lat: 42.3,
    height: 160_000,
    layers: ["trade", "commerce", "realestate"],
    dwellS: 30,
  },
  {
    id: "austin-housing",
    title: "Austin housing",
    region: "Central Texas",
    group: "markets",
    blurb: "Travis, Williamson and Hays counties coloured by the one-year change in Zillow's typical home value, with rents, wages and the mortgage-against-wages estimate in the market report.",
    lon: -97.75,
    lat: 30.3,
    height: 160_000,
    layers: ["realestate", "commerce"],
    dwellS: 35,
    market: true,
  },
  {
    id: "bay-area-values",
    title: "Bay Area values",
    region: "Northern California",
    group: "markets",
    blurb: "The most expensive counties in the country next to the Port of Oakland, with price-to-rent and years-of-wages lines showing what those values mean against local pay.",
    lon: -122.2,
    lat: 37.6,
    height: 220_000,
    layers: ["realestate", "commerce", "trade"],
    dwellS: 35,
    market: true,
  },
  {
    id: "states-markets",
    title: "Fifty states",
    region: "United States",
    group: "markets",
    blurb: "Every state coloured by the one-year change in typical home value with statewide jobs and wages; descend below 2,500 km anywhere and the counties take over.",
    lon: -97,
    lat: 39,
    height: 6_500_000,
    layers: ["realestate", "commerce"],
    dwellS: 25,
  },
  {
    id: "constructs-austin",
    title: "What governs downtown Austin",
    region: "Central Texas",
    group: "constructs",
    blurb: "Thirty-odd constructs float over one block of Congress Avenue: city, county, three legislative districts, school district, tract, metro, six nested watersheds, two ecoregions, a flood zone, a forecast office and three federal regions. Select one to see the gauges and companies inside it.",
    lon: -97.74,
    lat: 30.27,
    height: 60_000,
    layers: ["constructs", "water", "companies"],
    dwellS: 35,
  },
  {
    id: "constructs-field-texas",
    title: "Where Texas's watersheds are busiest",
    region: "Texas",
    group: "constructs",
    blurb: "Subbasins (HUC-8) float over Texas and rise with what the physical layers put inside them: stream gauges, aircraft, company headquarters, earthquakes. Zoom in and subwatersheds emerge; switch the point of view in Layers to see counties or districts instead.",
    lon: -97.7,
    lat: 29.6,
    height: 420_000,
    layers: ["field", "water", "aircraft", "companies", "earthquakes"],
    dwellS: 35,
  },
  {
    id: "constructs-bexar",
    title: "San Antonio's water constructs",
    region: "South Texas",
    group: "constructs",
    blurb: "The watershed chain the San Antonio River drains through, the Blackland Prairie ecoregion and the county and districts over it, with the city's gauges and wells joined to each one by location.",
    lon: -98.49,
    lat: 29.42,
    height: 90_000,
    layers: ["constructs", "water", "groundwater"],
    dwellS: 30,
  },
  // ---- Hazards & land (probed on 2026-09-25 with each layer's own request box)
  {
    id: "largest-fire",
    title: "The largest fire burning now",
    region: "United States · chosen when you click",
    group: "hazards",
    blurb: "Resolves on arrival: the current WFIGS perimeter with the most acres, selected, with its percent contained and how old the perimeter is, and the satellite hotspots of the last 24 hours around it.",
    lon: -113,
    lat: 42,
    height: 3_500_000,
    layers: ["wildfire", "fires", "hazards"],
    dwellS: 35,
    resolve: largestFire,
  },
  {
    id: "hazards-world",
    title: "Hazards worldwide",
    region: "whole Earth",
    group: "hazards",
    blurb: "Every event GDACS marks current, cyclones, floods, droughts, volcanoes, wildfires and quakes, with GDACS's own Green / Orange / Red level and the Orange and Red ones labelled; NASA EONET volcanoes; every FIRMS hotspot of the last 24 hours binned from orbit. Green GDACS quakes that USGS also has are left to the Earthquakes layer. Descend over the United States for NWS warnings.",
    lon: 10,
    lat: 15,
    height: 16_000_000,
    layers: ["hazards", "fires", "earthquakes"],
    dwellS: 25,
  },
  {
    id: "sa-floodplain",
    title: "San Antonio River floodplain",
    region: "Downtown San Antonio, Texas",
    group: "hazards",
    blurb: "FEMA's regulatory flood map at street scale: about a hundred zones, AE and A along the river and its creeks, one with a published base flood elevation of 634.5 ft (NAVD88) at the target. A map of the 1 % annual-chance floodplain, not a forecast.",
    lon: -98.4883,
    lat: 29.4232,
    height: 3_000,
    layers: ["flood", "water"],
    dwellS: 30,
  },
  {
    id: "mitchell-lake",
    title: "Mitchell Lake wetlands",
    region: "South San Antonio, Texas",
    group: "hazards",
    blurb: "About four hundred National Wetlands Inventory polygons around a shallow lake and the Medina and San Antonio river corridors: freshwater ponds, riverine channels, emergent marsh, each with its Cowardin code and acres. NWI mapped them from March 1983 colour-infrared photographs, so the shoreline and marsh may have moved since.",
    lon: -98.43,
    lat: 29.28,
    height: 7_000,
    layers: ["wetlands", "water"],
    dwellS: 30,
  },
  {
    id: "government-canyon",
    title: "Government Canyon",
    region: "Bexar County, Texas",
    group: "hazards",
    blurb: "A 12,344-acre state natural area PAD-US lists as open access, GAP status 2, among some 1,400 public and protected areas around San Antonio, from Joint Base San Antonio to Corps of Engineers lake lands: fee lands filled by whether the public may enter, easements outlined with who holds them, and the owner and manager of every unit as PAD-US publishes them.",
    lon: -98.7556,
    lat: 29.5737,
    height: 40_000,
    layers: ["publiclands", "water"],
    dwellS: 30,
  },
  // ---- Terrain & soils (probed on 2026-09-26 at the point each asks about)
  {
    id: "brackenridge-contours",
    title: "Brackenridge Park in 2 ft contours",
    region: "San Antonio, Texas",
    group: "terrain",
    blurb: "USGS's 2 ft contour lines at street scale, drawn from the 3DEP bare-earth DEM, which here is 1 m lidar (the elevation service reports a 1 m source at the park), over USGS shaded relief. The dossier gives the ground elevation at the target, about 205 m.",
    lon: -98.4718,
    lat: 29.461,
    height: 2_500,
    layers: ["contours", "relief", "water"],
    ground: { lon: -98.4718, lat: 29.461 },
    dwellS: 30,
  },
  {
    id: "bexar-soils",
    title: "South Bexar County soils",
    region: "San Antonio, Texas",
    group: "terrain",
    blurb: "NRCS SSURGO soil map units outlined with their symbols. At the target, San Antonio clay loam, 1 to 3 percent slopes: all areas prime farmland by NRCS's classification, NCCPI 0.455, which NRCS calls moderate inherent productivity. Click anywhere else for its soil. A survey rating, never a price.",
    lon: -98.45,
    lat: 29.28,
    height: 9_000,
    layers: ["soils", "water"],
    ground: { lon: -98.45, lat: 29.28 },
    dwellS: 30,
  },
  {
    id: "front-range-whp",
    title: "Front Range foothills, wildfire hazard in 3D",
    region: "Colorado Springs, Colorado",
    group: "terrain",
    blurb: "USFS Wildfire Hazard Potential over the foothills west of the city, with keyless 3D terrain at 1.5×: high and very high classes (4 and 5) on the slopes west of the city and non-burnable (6) where the probe grid crossed the city. At the target, class 5, very high. An index for long-term fuels planning, not a map of risk and not a forecast.",
    lon: -104.95,
    lat: 38.85,
    height: 30_000,
    layers: ["firehazard", "wildfire"],
    ground: { lon: -104.95, lat: 38.85 },
    terrain: 1.5,
    dwellS: 30,
  },
  {
    id: "galveston-slr",
    title: "Galveston at 3 ft of sea level rise",
    region: "Galveston Island, Texas",
    group: "terrain",
    blurb: "NOAA's 3 ft scenario above today's highest high tides: water depth in blue (darker is deeper, the bay and the Gulf included) and NOAA's low-lying areas in green. A screening-level scenario that shows the scale of flooding, not the exact location, and not when.",
    lon: -94.85,
    lat: 29.27,
    height: 45_000,
    layers: ["sealevel", "water"],
    slr: 3,
    dwellS: 30,
  },
  // ---- Infrastructure, air and events (probed on 2026-09-26 with each layer's own request)
  {
    id: "round-rock-grid",
    title: "The grid around Round Rock",
    region: "North of Austin, Texas",
    group: "infrastructure",
    blurb: "HIFLD's archived map of transmission lines of 69 kV and above, about 300 segments inside the dashed box, 33 of them at 345 kV, with the substations HIFLD names at their ends (Round Rock South on the 138 kV lines, Round Rock Northeast on the 345 kV), and the power plants EIA-860M lists within reach. The line map's last update was 2024-09-30.",
    lon: -97.68,
    lat: 30.51,
    height: 60_000,
    layers: ["transmission", "plants"],
    dwellS: 30,
  },
  {
    id: "ship-channel-pipelines",
    title: "Pipelines of the Houston Ship Channel",
    region: "Houston, Texas",
    group: "infrastructure",
    blurb: "EIA's national pipeline maps, about 1,500 segments in the box, most of them natural gas, with the crude oil systems EIA names (Seaway, Longhorn, BridgeTex, Houston–Houma…) and the operator EIA publishes on each, beside the area's power plants. Generalized routes with no diameter or depth: not for locating a line.",
    lon: -95.1,
    lat: 29.72,
    height: 150_000,
    layers: ["pipelines", "plants"],
    dwellS: 30,
  },
  {
    id: "texas-power",
    title: "Power plants of Texas",
    region: "Texas and its neighbours",
    group: "infrastructure",
    blurb: "About 1,150 plants of 50 MW or more from EIA-860M's monthly inventory within 600 km, coloured by the technology with the most nameplate capacity (gas, wind, solar, coal, nuclear, storage) and sized by it, with planned additions. Descend below 250 km for every plant down to 1 MW.",
    lon: -98,
    lat: 31,
    height: 1_200_000,
    layers: ["plants"],
    dwellS: 25,
  },
  {
    id: "kansas-city-rail",
    title: "Kansas City rail hub",
    region: "Kansas City, Missouri and Kansas",
    group: "infrastructure",
    blurb: "About 1,850 segments of the FRA's North American Rail Network in the dashed box: main lines, branches and some 700 yard tracks, Amtrak routes, the subdivisions FRA names, and the owning railroads' reporting marks on each segment.",
    lon: -94.6,
    lat: 39.1,
    height: 30_000,
    layers: ["rail"],
    dwellS: 25,
  },
  {
    id: "okc-sections",
    title: "Oklahoma City in townships and sections",
    region: "Oklahoma City, Oklahoma",
    group: "infrastructure",
    blurb: "BLM's Public Land Survey System grid, about 730 sections in the dashed box, labelled with BLM's section numbers, in townships of the Indian Meridian. Type a description like T12N R3W S33 OK in the search palette to fly to one section. A survey grid for reference, not a parcel boundary.",
    lon: -97.45,
    lat: 35.47,
    height: 15_000,
    layers: ["plss"],
    dwellS: 25,
  },
  {
    id: "bay-area-faults",
    title: "Bay Area faults",
    region: "San Francisco Bay, California",
    group: "infrastructure",
    blurb: "About 1,860 USGS Quaternary fault traces around the Bay, the San Andreas, Hayward, Calaveras, Concord and Greenville among them, coloured by the age of their most recent movement in USGS's classes (about 450 historic), dashed where the trace is inferred, with slip rates. Beside today's earthquakes; not a forecast.",
    lon: -122.1,
    lat: 37.7,
    height: 120_000,
    layers: ["faults", "earthquakes"],
    dwellS: 30,
  },
  {
    id: "seattle-landslides",
    title: "Seattle's mapped landslides",
    region: "Seattle, Washington",
    group: "infrastructure",
    blurb: "About 1,900 landslides from the USGS national compilation in the dashed box, almost all from Washington's own inventory, with their type, date where known and the inventory's link. Coverage is where someone mapped: none shown is not none there.",
    lon: -122.33,
    lat: 47.6,
    height: 20_000,
    layers: ["landslides"],
    dwellS: 25,
  },
  {
    id: "highland-lakes-dams",
    title: "Dams of the Highland Lakes",
    region: "Central Texas",
    group: "infrastructure",
    blurb: "About 465 dams from the USACE National Inventory of Dams, from Mansfield (3,223,000 acre-ft) and Buchanan to farm ponds, about 200 of them rated High hazard potential: the damage a failure would cause downstream, not the dam's condition. Condition assessments where the regulator published one; no owner names.",
    lon: -98.2,
    lat: 30.5,
    height: 200_000,
    layers: ["dams", "water"],
    dwellS: 30,
  },
  {
    id: "texas-airports",
    title: "Texas public-use airports",
    region: "Texas",
    group: "infrastructure",
    blurb: "About 330 FAA public-use airports, heliports and seaplane bases in the 8° box, with the FAA location id, ICAO code, field elevation and whether an instrument approach is published. Private-use strips are left out on purpose. Not for navigation.",
    lon: -97.5,
    lat: 30.5,
    height: 800_000,
    layers: ["airports"],
    dwellS: 25,
  },
  {
    id: "pikes-peak-geology",
    title: "Pikes Peak granite",
    region: "Colorado Springs, Colorado",
    group: "infrastructure",
    blurb: "Macrostrat's geologic map over the Front Range, coloured by age. At the target, the Rocks of Pikes Peak Batholith (Mesoproterozoic granite, 1,000 to 1,600 million years), from the State Geologic Map Compilation, with coarser maps' units beside it. Click anywhere for the unit there.",
    lon: -104.95,
    lat: 38.85,
    height: 60_000,
    layers: ["geology"],
    ground: { lon: -104.95, lat: 38.85 },
    dwellS: 30,
  },
  {
    id: "la-freeway-cams",
    title: "Los Angeles freeway cameras",
    region: "Los Angeles, California",
    group: "infrastructure",
    blurb: "Caltrans CWWP2 cameras within reach of downtown, about 1,900, each with its live still, the route and the direction word Caltrans publishes. Positions are Caltrans's; no bearing is drawn.",
    lon: -118.25,
    lat: 34.05,
    height: 40_000,
    layers: ["cameras"],
    dwellS: 25,
  },
  {
    id: "us-air-quality",
    title: "Air quality monitors, this hour",
    region: "North America",
    group: "infrastructure",
    blurb: "About 3,600 active AirNow monitoring sites with AirNow's NowCast AQI (ozone, PM2.5, PM10) and 1-hour NO₂ AQI for the newest hour, computed from the concentrations each reporting agency sent, coloured in EPA's AQI colours by the site's highest pollutant AQI; sites with no AQI this hour are drawn not rated. PRELIMINARY data, not fully verified or validated.",
    lon: -97,
    lat: 39,
    height: 6_000_000,
    layers: ["airquality"],
    dwellS: 25,
  },
  {
    id: "world-events",
    title: "Conflict events in the news",
    region: "The world",
    group: "infrastructure",
    blurb: "Conflict events GDELT coded from the last three hours of the world's news, counted at the city each was placed in, about 300 cities: protests, threats, assaults, fighting, by CAMEO class, with the sites that reported them. City-level only, no actor names, no article links; counts of reports, not verified incidents.",
    lon: 20,
    lat: 25,
    height: 16_000_000,
    layers: ["events"],
    dwellS: 25,
  },
  {
    id: "alamo-parcel",
    title: "The Alamo's parcel",
    region: "Downtown San Antonio, Texas",
    group: "parcels",
    blurb: "About 500 lot lines from TxGIO's StratMap copy of the Bexar Appraisal District roll, with the Alamo's own record open: owner State of Texas, a 2025 market value of $200,000,000 as the district publishes it, its legal description and the date of the roll. Click any other lot for its record; owners appear only for the one parcel you click, and nothing searches them.",
    lon: -98.4861,
    lat: 29.426,
    height: 1_500,
    layers: ["parcels"],
    parcel: true,
    dwellS: 30,
  },
  {
    id: "houston-city-hall",
    title: "Houston City Hall",
    region: "Downtown Houston, Texas",
    group: "parcels",
    blurb: "Some 750 lot lines from the Harris Central Appraisal District around City Hall, whose record opens with the City of Houston as owner, the 2026 appraised and market value of $19,625,000 and HCAD's new-owner date (1988), as HCAD publishes them. Where HCAD flags a record confidential it shows no owner name, and this app shows that owner as withheld and leaves out the mailing address too.",
    lon: -95.3693,
    lat: 29.7604,
    height: 1_500,
    layers: ["parcels"],
    parcel: true,
    dwellS: 30,
  },
  {
    id: "helena-capitol",
    title: "Montana State Capitol",
    region: "Helena, Montana",
    group: "parcels",
    blurb: "About 750 lot lines from the Montana Cadastral Framework, and the Capitol grounds' record from the Department of Revenue: owner, 2026 values and legal description, the NAD address points on the parcel, and the BLM Public Land Survey section it lies in (T10N R3W, section 32, Montana Meridian).",
    lon: -112.0181,
    lat: 46.5857,
    height: 1_500,
    layers: ["parcels"],
    parcel: true,
    dwellS: 30,
  },
  // ---- Zoning & permits (probed on 2026-09-26 with each layer's own request box at the preset's height)
  {
    id: "seattle-zoning",
    title: "Downtown Seattle zoning",
    region: "Seattle, Washington",
    group: "civic",
    blurb: "125 district outlines around the Central Library, coloured by Seattle's own categories (downtown, commercial, residential, major institutions), and the 20 building permits the city issued there in the last 30 days. Click the ground for a district's overlays, ordinance and code chapter: at the library it is DOC1 U/450-U, Downtown Office Core 1, ordinance 125291, in effect since 2017-05-14.",
    lon: -122.3325,
    lat: 47.6067,
    height: 3_000,
    layers: ["zoning", "permits"],
    dwellS: 30,
  },
  {
    id: "chicago-loop-permits",
    title: "Chicago Loop permits",
    region: "The Loop, Chicago",
    group: "civic",
    blurb: "About 200 building permits the city issued in the last 30 days within a kilometre of Daley Plaza, larger dots for larger reported costs, over 159 zoning outlines, most of them planned developments. Daley Plaza itself is DC-16; each permit opens with its work, cost, fee, status and parcel PINs.",
    lon: -87.6305,
    lat: 41.8842,
    height: 3_500,
    layers: ["permits", "zoning"],
    dwellS: 30,
  },
  {
    id: "denver-civic-zoning",
    title: "Denver Civic Center",
    region: "Denver, Colorado",
    group: "civic",
    blurb: "68 district outlines from Denver's zoning code, coloured by Denver's own district types. The City and County Building is D-CV, Downtown - Civic, from ordinance 333 of 2010; click any lot for its overlays, waivers, conditions and PUD.",
    lon: -104.9903,
    lat: 39.7393,
    height: 3_000,
    layers: ["zoning"],
    dwellS: 25,
  },
  {
    id: "houston-channel-permits",
    title: "Houston Ship Channel permits",
    region: "Harris County, Texas",
    group: "civic",
    blurb: "301 Clean Water Act (NPDES) and 65 Clean Air Act facilities within about 5 km of the channel, each with ECHO's own compliance words: 29 carry a violation or noncompliance, and the 10 ECHO lists as Unknown are drawn in the not-rated violet. Beside them, the Corps of Engineers' dredging, dock and bulkhead actions along the channel (its search returns 300 at most). Houston itself has no zoning.",
    lon: -95.12,
    lat: 29.74,
    height: 20_000,
    layers: ["envpermits"],
    dwellS: 30,
  },
  {
    id: "midtown-licences",
    title: "Midtown Manhattan licences",
    region: "Midtown, New York City",
    group: "civic",
    blurb: "About 1,400 licensed premises within a kilometre of the Empire State Building from the State Liquor Authority and the city's consumer protection department (restaurants, bars, home improvement contractors), by trade name; 31 at apartment or unit addresses are withheld as likely homes. The building's own lot is C5-3 and C6-4.5 in the Midtown special district.",
    lon: -73.9857,
    lat: 40.7484,
    height: 2_000,
    layers: ["licences", "zoning"],
    dwellS: 25,
  },
];

/** The presets this deployment shows: air quality waits on AIRNOW_ENABLED (lib/air/airnow.ts). */
export const PRESETS: Preset[] = ALL_PRESETS.filter((p) => AIRNOW_ENABLED || !p.layers.includes("airquality"));

/** The infrastructure gallery's title, which names air only while the air layer is on. */
export const INFRA_GROUP_TITLE = AIRNOW_ENABLED ? "Infrastructure, air & events" : "Infrastructure & events";

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

export function presetShare(p: Preset): ShareState {
  return {
    lat: p.lat,
    lon: p.lon,
    h: p.height,
    layers: p.layers,
    report: p.report || undefined,
    market: p.market || undefined,
    ground: p.ground,
    terrain: p.terrain,
    slr: p.slr,
    parcel: p.parcel ? { lat: p.lat, lon: p.lon } : undefined,
  };
}

/** presetShare, with a moving preset resolved to where it is now (falls back to the fixed place). */
export async function presetTarget(p: Preset): Promise<ShareState> {
  const base = presetShare(p);
  if (!p.resolve) return base;
  try {
    const r = await p.resolve();
    return r ? { ...base, ...r } : base;
  } catch {
    return base;
  }
}

/** Presets in gallery order, grouped. */
export const PRESET_GROUPS: Array<{ title: string; presets: Preset[] }> = [
  { title: "Water", presets: PRESETS.filter((p) => !p.group) },
  { title: "Trade & markets", presets: PRESETS.filter((p) => p.group === "markets") },
  { title: "Constructs", presets: PRESETS.filter((p) => p.group === "constructs") },
  { title: "Hazards & land", presets: PRESETS.filter((p) => p.group === "hazards") },
  { title: "Terrain & soils", presets: PRESETS.filter((p) => p.group === "terrain") },
  { title: INFRA_GROUP_TITLE, presets: PRESETS.filter((p) => p.group === "infrastructure") },
  { title: "Parcels & ownership", presets: PRESETS.filter((p) => p.group === "parcels") },
  { title: "Zoning & permits", presets: PRESETS.filter((p) => p.group === "civic") },
];
