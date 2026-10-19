"use client";
// How each layer is drawn. Data layers (lib/layers/*) know nothing about
// Cesium; this file maps their GeoJSON onto glyphs, colours, labels and, for
// moving things, a position-at-time function.

import type { LayerId } from "@/lib/layers/types";
import type { LayerStyle } from "./renderer";
import { destination } from "./geo";
import { periodMs, satPosition, type SatExtra } from "@/lib/layers/satellites";
import { issPositionAt, type IssExtra } from "@/lib/layers/iss";
import { satWorker } from "./satWorker";
import type { LaunchExtra } from "@/lib/layers/launches";
import { vehiclePosition, type VehicleExtra } from "@/lib/layers/traffic";
import { groundwaterStyle, turbidityStyle, waterStyle } from "./waterStyles";
import { commerceStyle, realestateStyle, tradeStyle } from "./economyStyles";
import { companiesStyle } from "./companyStyles";
import { bankStyle, spendingStyle } from "./financeStyles";
import { gasForecastStyle, gasPricesStyle } from "./gasStyles";
import {
  datacentersStyle,
  ercotPricesStyle,
  globalGenerationStyle,
  usElectricityPricesStyle,
} from "./energyStyles";
import { constructsStyle } from "./constructStyles";
import { fieldStyle } from "./fieldStyles";
import { alertsStyle } from "./alertStyles";
import { firesStyle, hazardsStyle, wildfireStyle } from "./hazardStyles";
import { floodStyle, heritageStyle, historicStyle, impairedStyle, pfasStyle, publiclandsStyle, tribalStyle, wetlandsStyle } from "./landStyles";
import { contoursStyle, crithabStyle, firehazardStyle, hydroStyle, landcoverStyle, landslidesuscStyle, naipStyle, reliefStyle, sealevelStyle, slopeStyle, soilsStyle, topoStyle, waybackStyle } from "./terrainStyles";
import {
  airportsStyle,
  airqualityStyle,
  damsStyle,
  hospitalsStyle,
  eventsStyle,
  faultsStyle,
  geologyStyle,
  landslidesStyle,
  pipelinesStyle,
  plantsStyle,
  plssStyle,
  railStyle,
  transmissionStyle,
} from "./infraStyles";
import { parcelsStyle } from "./parcelStyles";
import { contaminantsStyle, envpermitsStyle, licencesStyle, permitsStyle, schoolsStyle, ustStyle, zoningStyle } from "./civicStyles";
import { broadbandStyle, healthStyle, housingStyle, riskindexStyle, vulnerabilityStyle, wildfireriskStyle } from "./indexStyles";

/** Distinctive major-group colours for the occupations layer: one hue per SOC major group. */
const OCCUPATION_COLORS: Record<string, string> = {
  "11-0000": "#F5B849", // Management
  "13-0000": "#E8A33D", // Business & financial operations
  "15-0000": "#4DD8FF", // Computer & mathematical
  "17-0000": "#7DD3FC", // Architecture & engineering
  "19-0000": "#A78BFA", // Life, physical & social science
  "21-0000": "#F472B6", // Community & social service
  "23-0000": "#FB7185", // Legal
  "25-0000": "#FACC15", // Educational instruction & library
  "27-0000": "#E879F9", // Arts, design, entertainment, sports & media
  "29-0000": "#5EEAD4", // Healthcare practitioners & technical
  "31-0000": "#6EE7B7", // Healthcare support
  "33-0000": "#94A3B8", // Protective service
  "35-0000": "#FB923C", // Food preparation & serving
  "37-0000": "#A3A380", // Building & grounds cleaning & maintenance
  "39-0000": "#F9A8D4", // Personal care & service
  "41-0000": "#FCA5A5", // Sales & related
  "43-0000": "#C4B5FD", // Office & administrative support
  "45-0000": "#84CC16", // Farming, fishing & forestry
  "47-0000": "#D97706", // Construction & extraction
  "49-0000": "#B45309", // Installation, maintenance & repair
  "51-0000": "#60A5FA", // Production
  "53-0000": "#38BDF8", // Transportation & material moving
};

export const occupationsStyle: LayerStyle = {
  color: "#7DD3A8",
  icon: () => "jobs",
  iconSize: 20,
  colorFor: (f) => OCCUPATION_COLORS[f.properties.kind ?? ""] ?? "#7DD3A8",
  label: (f) => f.properties.name,
  labelMax: 24,
  scaleByDistance: [3e5, 1.0, 8e6, 0.25],
};

/** Temperature ramp for the weather layer (°C). */
function tempColor(t: number | null): string {
  if (t == null) return "#8A93A6";
  if (t <= 0) return "#A5D8FF";
  if (t <= 10) return "#7DD3FC";
  if (t <= 20) return "#A8E6A0";
  if (t <= 30) return "#F5C849";
  return "#FF6B3D";
}

interface WeatherExtra {
  tempC?: number | null;
  windMs?: number | null;
  windDirTo?: number;
  barbLenM?: number;
}

export const weatherStyle: LayerStyle = {
  color: "#7DD3FC",
  pointSize: (f) => {
    const x = f.properties.extra as WeatherExtra | undefined;
    return Math.min(11, 4.5 + (x?.windMs ?? 0) * 0.45);
  },
  colorFor: (f) => tempColor((f.properties.extra as WeatherExtra | undefined)?.tempC ?? null),
  label: (f) => f.properties.name,
  labelMax: 25,
  // Wind barb: a short line from the sample point in the direction the wind
  // blows toward, length ∝ speed. Calm points get no barb.
  lines: (f) => {
    const x = f.properties.extra as WeatherExtra | undefined;
    if (x?.windDirTo == null || (x.windMs ?? 0) < 0.5) return null;
    if (f.geometry.type !== "Point") return null;
    const [lon, lat] = f.geometry.coordinates;
    const [blon, blat] = destination(lat, lon, x.windDirTo, x.barbLenM ?? 20_000);
    return [
      {
        positions: [
          [lon, lat, 0],
          [blon, blat, 0],
        ],
        color: "#EAF4FF",
        alpha: 0.85,
        width: 1.5,
      },
    ];
  },
  scaleByDistance: [3e5, 1.0, 8e6, 0.3],
};

const SPORTS_COLORS: Record<string, string> = {
  in: "#4ADE80", // live now
  pre: "#F5B849", // upcoming
  post: "#8A93A6", // final
};

export const sportsStyle: LayerStyle = {
  color: "#4ADE80",
  pointSize: (f) => (f.properties.kind === "in" ? 8.5 : 5),
  colorFor: (f) => SPORTS_COLORS[f.properties.kind ?? ""] ?? "#4ADE80",
  label: (f) => f.properties.name,
  labelMax: 40,
  scaleByDistance: [3e5, 1.0, 8e6, 0.3],
};

/** Dead-reckon a moving surface/air object from its last report for up to 90 s. */
function extrapolate(
  lon: number,
  lat: number,
  alt: number,
  heading: number | undefined,
  speed: number | undefined,
  observedAt: number | undefined,
  timeMs: number,
  maxSeconds = 90,
): [number, number, number] {
  if (heading == null || speed == null || observedAt == null) return [lon, lat, alt];
  const dt = (timeMs - observedAt) / 1000;
  if (dt <= 0 || dt > maxSeconds) return [lon, lat, alt];
  const [nlon, nlat] = destination(lat, lon, heading, speed * dt);
  return [nlon, nlat, alt];
}

export const aircraftStyle: LayerStyle = {
  color: "#4DD8FF",
  icon: (f) => (f.properties.kind === "rotorcraft" ? "heli" : "plane"),
  iconSize: 26,
  colorFor: (f) => {
    if (f.properties.kind === "military") return "#FFB000";
    if ((f.properties.altitude ?? 1) < 1) return "#7A8A94";
    return "#4DD8FF";
  },
  label: (f) => f.properties.name,
  labelMax: 90,
  trail: true,
  tickMs: 250,
  // Full glyph up close; a 4 px speck from orbit so a global view reads as a
  // density map instead of a blue smear.
  scaleByDistance: [2e5, 1.0, 4e6, 0.16],
  translucencyByDistance: [1.5e6, 1.0, 1.2e7, 0.6],
  position: (f, t) => {
    if (f.geometry.type !== "Point") return null;
    const [lon, lat, alt] = f.geometry.coordinates;
    const p = f.properties;
    return extrapolate(lon, lat, alt ?? p.altitude ?? 0, p.heading, p.speed, p.observedAt, t);
  },
};

const SAT_COLORS: Record<string, string> = {
  station: "#FFFFFF",
  military: "#FFB000",
  navigation: "#9AD1FF",
  constellation: "#8C8CA8",
  "earth-observation": "#B8F5D8",
  geostationary: "#D9C2FF",
  science: "#FFD9F2",
  new: "#5EF2C2",
  satellite: "#E6E6FA",
};

export const satellitesStyle: LayerStyle = {
  color: "#E6E6FA",
  icon: (f) => (f.properties.kind === "station" ? "sat" : null),
  iconSize: 22,
  pointSize: (f) => (f.properties.kind === "constellation" ? 3 : f.properties.kind === "military" ? 6 : 4.5),
  colorFor: (f) => SAT_COLORS[f.properties.kind ?? "satellite"] ?? "#E6E6FA",
  label: (f) => f.properties.name,
  labelMax: 40,
  tickMs: 1000,
  position: (f, t) => {
    const extra = f.properties.extra as SatExtra | undefined;
    if (!extra) return null;
    // Worker-propagated when available (thousands of objects stay smooth);
    // main-thread SGP4 otherwise.
    if (satWorker.active) return satWorker.position(f.properties.id) ?? null;
    return satPosition(extra.omm, t);
  },
  selectedLines: (f, t) => {
    const extra = f.properties.extra as SatExtra | undefined;
    if (!extra) return null;
    const period = periodMs(extra.omm);
    const steps = 120;
    const positions: [number, number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const p = satPosition(extra.omm, t - period / 2 + (period * i) / steps);
      if (p) positions.push(p);
    }
    return positions.length > 2
      ? [{ positions, color: SAT_COLORS[f.properties.kind ?? "satellite"], width: 1.2, alpha: 0.7, glow: true }]
      : null;
  },
};

export const issStyle: LayerStyle = {
  color: "#FFFFFF",
  icon: () => "sat",
  iconSize: 24,
  label: (f) => f.properties.name,
  labelMax: 10,
  // The orbit trail is the renderer's recorded position history; positions
  // between the 10 s polls are interpolated so the trail draws smoothly.
  trail: true,
  tickMs: 1000,
  scaleByDistance: [1e6, 1.0, 2e7, 0.35],
  position: (f, t) => {
    const x = f.properties.extra as IssExtra | undefined;
    if (!x) return null;
    // Reduced motion: hold the latest real fix, never animate between polls.
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return [x.cur.lon, x.cur.lat, x.cur.altM];
    }
    return issPositionAt(x, t);
  },
};

const SHIP_COLORS: Record<string, string> = {
  military: "#FFB000",
  "law-enforcement": "#FFB000",
  "search-and-rescue": "#FF6B3D",
  tanker: "#F5B849",
  cargo: "#79E6A8",
  passenger: "#9AD1FF",
  "high-speed": "#9AD1FF",
  fishing: "#B8F5D8",
  tug: "#C9D1A8",
  pilot: "#C9D1A8",
  towing: "#C9D1A8",
  sailing: "#E6E6FA",
  pleasure: "#E6E6FA",
  vessel: "#79E6A8",
};

export const shipsStyle: LayerStyle = {
  color: "#79E6A8",
  icon: () => "ship",
  iconSize: 18,
  colorFor: (f) => SHIP_COLORS[f.properties.kind ?? "vessel"] ?? "#79E6A8",
  label: (f) => f.properties.name,
  labelMax: 60,
  trail: true,
  tickMs: 500,
  scaleByDistance: [4e4, 1.0, 3e6, 0.35],
  position: (f, t) => {
    if (f.geometry.type !== "Point") return null;
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;
    return extrapolate(lon, lat, 0, p.heading, p.speed, p.observedAt, t, 180);
  },
};

export const earthquakesStyle: LayerStyle = {
  color: "#FF6B3D",
  pointSize: (f) => {
    const mag = (f.properties.extra as { mag?: number } | undefined)?.mag ?? 0;
    return Math.max(4, 3 + mag * 2.6);
  },
  colorFor: (f) => {
    const mag = (f.properties.extra as { mag?: number } | undefined)?.mag ?? 0;
    if (mag >= 6) return "#FF2D2D";
    if (mag >= 5) return "#FF4D3D";
    if (mag >= 4) return "#FF6B3D";
    if (mag >= 2.5) return "#FF9A5C";
    return "#C77A5A";
  },
  label: (f) => f.properties.name,
  labelMax: 30,
};

export const camerasStyle: LayerStyle = {
  color: "#F5B849",
  icon: () => "cam",
  iconSize: 18,
  colorFor: (f) => (f.properties.imageUrl ? "#F5B849" : "#8A7A55"),
  label: (f) => f.properties.name,
  labelMax: 0,
  scaleByDistance: [1.5e4, 1.0, 6e5, 0.3],
};

const LAUNCH_COLORS: Record<string, string> = {
  "in-flight": "#FF3DAE",
  go: "#FF3DAE",
  tbc: "#D95FA0",
  tbd: "#9A5B80",
  hold: "#F5B849",
  previous: "#6E5266",
  success: "#6E5266",
  failure: "#7A3A3A",
};

const FLIGHT_MS = 10 * 60_000;

export const launchesStyle: LayerStyle = {
  color: "#FF3DAE",
  icon: (f) => (f.properties.kind === "in-flight" ? "rocket" : "pad"),
  iconSize: 22,
  colorFor: (f) => LAUNCH_COLORS[f.properties.kind ?? "tbd"] ?? "#FF3DAE",
  label: (f) => {
    const x = f.properties.extra as LaunchExtra | undefined;
    if (!x) return f.properties.name;
    const dt = x.netMs - Date.now();
    const abs = Math.abs(dt);
    const d = Math.floor(abs / 86_400_000);
    const h = Math.floor((abs % 86_400_000) / 3_600_000);
    const m = Math.floor((abs % 3_600_000) / 60_000);
    const tag = d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
    return `${f.properties.name.split("|")[0].trim()} T${dt >= 0 ? "-" : "+"}${tag}`;
  },
  labelMax: 80,
  // Only launches inside a ±12 h window (or in flight) get a standing label.
  labelWhen: (f, t) => {
    const x = f.properties.extra as LaunchExtra | undefined;
    if (!x) return false;
    return f.properties.kind === "in-flight" || Math.abs(x.netMs - t) < 12 * 3600_000;
  },
  tickMs: 250,
  scaleByDistance: [5e5, 1.0, 2e7, 0.6],
  position: (f, t) => {
    if (f.geometry.type !== "Point") return null;
    const [lon, lat] = f.geometry.coordinates;
    const x = f.properties.extra as LaunchExtra | undefined;
    if (!x?.trajectory) return [lon, lat, 0];
    const dt = t - x.netMs;
    if (dt < 0 || dt > FLIGHT_MS || x.status === "Failure" || x.status === "TBD") return [lon, lat, 0];
    const track = x.trajectory.track;
    const s = (dt / FLIGHT_MS) * (track.length - 1);
    const i = Math.min(track.length - 2, Math.floor(s));
    const k = s - i;
    const a = track[i];
    const b = track[i + 1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  },
  lines: (f, t) => {
    const x = f.properties.extra as LaunchExtra | undefined;
    if (!x?.trajectory) return null;
    const dt = x.netMs - t;
    // Only the launches happening within a day (either side) get an ascent arc,
    // so the globe is not covered in thirty dashed lines.
    if (dt > 24 * 3600_000 || dt < -24 * 3600_000) return null;
    return [{ positions: x.trajectory.track, color: "#FF3DAE", alpha: 0.45, width: 1.5, dashed: true }];
  },
  selectedLines: (f) => {
    const x = f.properties.extra as LaunchExtra | undefined;
    if (!x?.trajectory) return null;
    return [{ positions: x.trajectory.track, color: "#FF7AD1", alpha: 0.9, width: 2.5, glow: true }];
  },
};

export const wikipediaStyle: LayerStyle = {
  color: "#EDE9E3",
  pointSize: () => 6,
  label: (f) => f.properties.name,
  labelMax: 30,
  scaleByDistance: [3e5, 1.0, 8e6, 0.3],
};

export const wikidayStyle: LayerStyle = {
  color: "#A78BFA",
  pointSize: () => 6.5,
  label: (f) => f.properties.name,
  labelMax: 20,
  scaleByDistance: [3e5, 1.0, 8e6, 0.3],
};

export const trafficStyle: LayerStyle = {
  color: "#B48CFF",
  pointSize: () => 3.5,
  colorFor: (f) => (f.properties.kind === "road" ? "#7A5CC7" : "#B48CFF"),
  labelMax: 0,
  tickMs: 100,
  position: (f, t) => {
    if (f.properties.kind !== "vehicle") return null;
    const v = f.properties.extra as VehicleExtra | undefined;
    return v ? vehiclePosition(v, t) : null;
  },
  lines: (f) => {
    if (f.geometry.type !== "LineString") return null;
    return [
      {
        positions: f.geometry.coordinates as [number, number, number][],
        color: "#B48CFF",
        alpha: 0.22,
        width: 1.2,
      },
    ];
  },
};

export const STYLES: Partial<Record<LayerId, LayerStyle>> = {
  aircraft: aircraftStyle,
  ships: shipsStyle,
  satellites: satellitesStyle,
  iss: issStyle,
  earthquakes: earthquakesStyle,
  cameras: camerasStyle,
  traffic: trafficStyle,
  launches: launchesStyle,
  water: waterStyle,
  groundwater: groundwaterStyle,
  turbidity: turbidityStyle,
  trade: tradeStyle,
  commerce: commerceStyle,
  realestate: realestateStyle,
  companies: companiesStyle,
  banks: bankStyle,
  spending: spendingStyle,
  occupations: occupationsStyle,
  gasprices: gasPricesStyle,
  gasforecast: gasForecastStyle,
  ercotprices: ercotPricesStyle,
  uselectricity: usElectricityPricesStyle,
  globalgeneration: globalGenerationStyle,
  datacenters: datacentersStyle,
  weather: weatherStyle,
  wildfire: wildfireStyle,
  fires: firesStyle,
  hazards: hazardsStyle,
  flood: floodStyle,
  wetlands: wetlandsStyle,
  publiclands: publiclandsStyle,
  historic: historicStyle,
  heritage: heritageStyle,
  impaired: impairedStyle,
  pfas: pfasStyle,
  crithab: crithabStyle,
  wayback: waybackStyle,
  topo: topoStyle,
  hydro: hydroStyle,
  naip: naipStyle,
  relief: reliefStyle,
  slope: slopeStyle,
  contours: contoursStyle,
  soils: soilsStyle,
  firehazard: firehazardStyle,
  landslidesusc: landslidesuscStyle,
  landcover: landcoverStyle,
  sealevel: sealevelStyle,
  transmission: transmissionStyle,
  pipelines: pipelinesStyle,
  plants: plantsStyle,
  rail: railStyle,
  airports: airportsStyle,
  dams: damsStyle,
  faults: faultsStyle,
  landslides: landslidesStyle,
  geology: geologyStyle,
  plss: plssStyle,
  airquality: airqualityStyle,
  events: eventsStyle,
  parcels: parcelsStyle,
  zoning: zoningStyle,
  permits: permitsStyle,
  licences: licencesStyle,
  envpermits: envpermitsStyle,
  contaminants: contaminantsStyle,
  ust: ustStyle,
  riskindex: riskindexStyle,
  health: healthStyle,
  schools: schoolsStyle,
  hospitals: hospitalsStyle,
  vulnerability: vulnerabilityStyle,
  broadband: broadbandStyle,
  housing: housingStyle,
  wildfirerisk: wildfireriskStyle,
  tribal: tribalStyle,
  sports: sportsStyle,
  constructs: constructsStyle,
  field: fieldStyle,
  wikipedia: wikipediaStyle,
  wikiday: wikidayStyle,
  alerts: alertsStyle,
};

/** Camera range (m) to sit at when following an object of a given layer. */
export const FOLLOW_RANGE: Record<LayerId, number> = {
  aircraft: 30_000,
  ships: 10_000,
  satellites: 2_500_000,
  iss: 1_500_000,
  earthquakes: 250_000,
  cameras: 2_500,
  traffic: 2_000,
  launches: 400_000,
  water: 15_000,
  groundwater: 15_000,
  turbidity: 6_000,
  trade: 40_000,
  commerce: 150_000,
  realestate: 150_000,
  companies: 20_000,
  employers: 20_000,
  banks: 20_000,
  spending: 150_000,
  occupations: 400_000,
  gasprices: 400_000,
  gasforecast: 400_000,
  ercotprices: 400_000,
  uselectricity: 400_000,
  globalgeneration: 400_000,
  datacenters: 20_000,
  weather: 500_000,
  wildfire: 60_000,
  fires: 20_000,
  hazards: 250_000,
  flood: 3_000,
  wetlands: 3_000,
  publiclands: 40_000,
  historic: 2_000,
  heritage: 150_000,
  impaired: 3_000,
  pfas: 4_000,
  crithab: 20_000,
  wayback: 5_000,
  topo: 5_000,
  hydro: 5_000,
  naip: 5_000,
  // Picture layers have no features to follow; a "ground here" answer sits at its click.
  relief: 5_000,
  slope: 5_000,
  contours: 2_000,
  soils: 5_000,
  firehazard: 20_000,
  landslidesusc: 20_000,
  landcover: 10_000,
  sealevel: 20_000,
  transmission: 15_000,
  pipelines: 20_000,
  plants: 8_000,
  rail: 5_000,
  airports: 10_000,
  dams: 6_000,
  faults: 20_000,
  landslides: 3_000,
  geology: 20_000,
  plss: 6_000,
  airquality: 20_000,
  events: 150_000,
  parcels: 800,
  zoning: 3_000,
  permits: 1_500,
  licences: 1_000,
  envpermits: 8_000,
  contaminants: 8_000,
  ust: 120_000,
  riskindex: 200_000,
  health: 200_000,
  schools: 8_000,
  hospitals: 60_000,
  vulnerability: 200_000,
  broadband: 200_000,
  housing: 30_000,
  wildfirerisk: 200_000,
  tribal: 300_000,
  sports: 500_000,
  constructs: 150_000,
  field: 400_000,
  wikipedia: 150_000,
  wikiday: 250_000,
  alerts: 600_000,
  // Particle-flow layers have no followable objects; a global view is the
  // only sensible follow range (unreachable in practice: nothing to select).
  windflow: 20_000_000,
  oceanflow: 20_000_000,
};
