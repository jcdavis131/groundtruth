"use client";
// Permalinks. The URL carries enough to put another person in the same
// place with the same layers, clock and selection:
//
//   ?lat=29.28&lon=-98.34&h=60000&hd=0&p=-55
//   &layers=water,turbidity      exactly these layers on
//   &t=2026-09-02T18:00:00Z      mission clock (omitted while live)
//   &sel=water:usgs:USGS-08180800   selected feature, best effort
//   &report=1                    community water report open
//   &market=1                    market report open
//   &v=2026-08-15                data vintage (pins the mission clock to that day;
//                                history-aware layers will read that release later)
//   &embed=1                     no HUD chrome (iframes)
//   &zoning=47.60670,-122.33250  the zoning answer at this point (lat,lon, 5 decimals);
//                                asked for once the camera is there, with the Zoning layer on
//   &pin=27.8000,-97.3960        the constructs stack anchored at this point (lat,lon)
//   &cmp=27.8800,-97.3200        a second place compared with the pinned one (lat,lon)
//   &space=1                     space-weather panel open
//   &parcel=29.42600,-98.48610   the parcel identified at this point (lat,lon, 5 decimals:
//                                a lot can be narrower than 4 decimals' 11 m); its dossier
//                                opens once the camera is there
//   &ground=29.28000,-98.45000   a "ground here" answer (soil, land cover, hazard class,
//                                slope, elevation) asked at this point (lat,lon, 5 decimals)
//                                once the camera is there, with the layers the link turns on
//   &terrain=1.5                 3D terrain on, at this vertical exaggeration (1 to 3)
//   &slr=3                       the sea level rise scenario, feet above MHHW (1 to 10;
//                                written only while the Sea level rise layer is on)
//   &wb=63116                    the Esri World Imagery Wayback release the Historic
//                                imagery layer draws (written only while it is on and a
//                                release is picked; one Esri no longer lists falls back
//                                to the newest)
//   &ty=1956                     the USGS topographic map edition year the Historic topo
//                                maps layer draws (written only while it is on and a year
//                                is picked; a year with no sheet at the new view is kept
//                                and the layer says so)
//   &ny=2014                     the USDA NAIP year the Aerial photos by year layer draws
//                                (written only while it is on and a year is picked)
//   &sv=2                        the CDC/ATSDR SVI theme the Social vulnerability layer
//                                draws (1-4; written only while it is on and a theme,
//                                not the overall ranking, is picked)
//   &hs=all                      Hospitals draws closed ones too (written only while it
//                                is on and its 'Closed too' chip is on)
//   &bb=3                        the measure the Broadband layer draws (1 underserved
//                                share, 2 fiber share, 3 providers; written only while it
//                                is on and a measure other than the unserved share is picked)
//   &wr=2                        the USFS WRC rank family the Wildfire risk ranks layer
//                                draws (1-3, by the service's aliases; written only while
//                                it is on and not RISK_NATIONAL_RANK)
//   &wrs=state                   the same layer ranks within the state (written only while
//                                it is on and the state rank is picked)
//   &hv=count                    the Housing assistance layer colours by voucher households
//                                (written only while it is on and the count is picked; HUD's
//                                share of renter units is the default)
//   &hp=dda,lihtc                the Housing assistance layer's tax-credit chips: HUD's
//                                Difficult Development Areas and LIHTC properties (written
//                                only while it is on and a chip is on)
//   &aoi=1                       the Area panel open on the drawn area (shape=a:…)
//   &here=29.42410,-98.49360     a "what's here" answer asked at this point (lat,lon,
//                                5 decimals) once the camera is there
//   &shape=a:-98.5,29.4;-98.49,29.4;-98.49,29.41   a drawn area (a:) or line (l:),
//                                vertices as lon,lat to 5 decimals, at most 60;
//                                written last and unescaped so it stays readable
//
// The URL is rewritten with replaceState about once a second while things
// change; nothing here ever pushes history entries.

import { LAYER_IDS, type LayerId } from "@/lib/layers/types";
import { useGlobe, type Selection, type Shape } from "@/lib/store/globe";
import { MAX_POINTS } from "./measure";
import { flyTo, flyToSelection } from "./camera";
import { getRenderer } from "./registry";
import { setMissionTime } from "./clock";
import { getVintage, isValidVintage, useReleases, vintageClockMs } from "@/lib/releases/store";
import { isPersonaId, type PersonaId } from "@/lib/personas/registry";
import { applyPersona, useLens } from "@/lib/personas/store";
import { useStrata, type LonLat } from "@/lib/fabric/strataStore";
import { identifyZoning, useZoningPick } from "@/lib/zoning/pick";
import { zoningPointId } from "@/lib/zoning/dossier";
import { identifyParcel, useParcelPick } from "@/lib/parcels/pick";
import { useSettings } from "@/lib/store/settings";
import { areaRing, useArea } from "@/lib/aoi/store";
import { openHere, useHere } from "@/lib/whatshere/here";
import { identifyGround, isGroundSelection, useGroundPick } from "@/lib/terrain/ground";
import { isSlrFeet } from "@/lib/terrain/products";
import { parseReleaseId } from "@/lib/terrain/wayback";
import { parseTopoYear } from "@/lib/terrain/topo";
import { parseNaipYear } from "@/lib/terrain/naip";
import { parseSviTheme } from "@/lib/civic/svi";
import { parseBroadbandMeasure } from "@/lib/civic/broadband";
import { parseWrcMeasure } from "@/lib/hazards/wrc";
import { parseHousingMeasure } from "@/lib/civic/housing";
import { housingPartsPref } from "@/lib/civic/taxcredit";

/** A broadband measure or WRC rank family from a link: 1 to 3 (0, the default, is never written). */
export function parseMeasureParam(v: string | null | undefined): number | undefined {
  return v != null && /^[1-3]$/.test(v.trim()) ? Number(v.trim()) : undefined;
}

/** An SVI theme from a link: 1 to 4 (the overall ranking, 0, is the default and is never written). */
export function parseSviThemeParam(v: string | null | undefined): number | undefined {
  return v != null && /^[1-4]$/.test(v.trim()) ? Number(v.trim()) : undefined;
}

export interface ShareState {
  lat?: number;
  lon?: number;
  /** Camera height in metres. */
  h?: number;
  /** Heading / pitch in degrees. */
  hd?: number;
  p?: number;
  layers?: LayerId[];
  /** Mission clock, epoch ms. */
  t?: number;
  sel?: Selection;
  report?: boolean;
  market?: boolean;
  /**
   * Data vintage, ISO date (YYYY-MM-DD). Today it pins the mission clock to
   * noon UTC of that day and shows "VINTAGE <date>" in the HUD; layers that
   * can read history (series store, Zillow history) will honour it later.
   */
  vintage?: string;
  /** Lens (who is looking): sets layers, the arrival panel and the camera unless the link carries its own. */
  lens?: PersonaId;
  embed?: boolean;
  /** The point a zoning answer was asked for (a clicked point, not a feed feature). */
  zoning?: LonLat;
  /** The point the constructs stack is anchored to (the "A" of a comparison). */
  pin?: LonLat;
  /** The second place of a comparison ("B"). */
  cmp?: LonLat;
  /** Space-weather panel open. */
  space?: boolean;
  /** A drawn line or area, shown with its measurement. */
  shape?: Shape;
  /** The point a parcel was identified at (the parcels layer's dossier). */
  parcel?: LonLat;
  /** The point a "ground here" answer was asked for (a click on a picture layer, not a feed feature). */
  ground?: LonLat;
  /** The Area panel open on the drawn area. */
  aoi?: boolean;
  /** The point a "what's here" answer was asked for. */
  here?: LonLat;
  /** 3D terrain on, at this vertical exaggeration. */
  terrain?: number;
  /** Sea level rise scenario, whole feet above MHHW. */
  slr?: number;
  /** Esri World Imagery Wayback release id. */
  wb?: number;
  /** USGS historical topographic map edition year (1879-2006). */
  ty?: number;
  /** USDA NAIP year (2010 onward). */
  ny?: number;
  /** CDC/ATSDR SVI theme, 1-4 (0, the overall ranking, is the default and never written). */
  sv?: number;
  /** Hospitals: closed ones too. Open only is the default and is never written. */
  hs?: "all";
  /** Broadband measure, 1-3 (0, the unserved share, is the default and never written). */
  bb?: number;
  /** WRC rank family, 1-3 (0, RISK_*, is the default and never written). */
  wr?: number;
  /** WRC state ranks. National is the default and is never written. */
  wrs?: "state";
  /** Housing: colour by voucher households. HUD's share is the default and is never written. */
  hv?: "count";
  /** Housing: the tax-credit chips on (dda, lihtc). None is the default and is never written. */
  hp?: string;
}

/** Terrain exaggeration from a link: 1 to 3, else undefined. */
export function parseTerrain(v: string | null | undefined): number | undefined {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 3 ? n : undefined;
}

/** "a:lon,lat;lon,lat;…" or "l:…" -> Shape, or undefined when malformed. */
export function parseShape(raw: string | null | undefined): Shape | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^([al]):(.+)$/);
  if (!m) return undefined;
  const points: Array<[number, number]> = [];
  for (const pair of m[2].split(";").slice(0, MAX_POINTS)) {
    const parts = pair.split(",");
    if (parts.length !== 2 || parts.some((x) => x.trim() === "")) return undefined;
    const [lon, lat] = parts.map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return undefined;
    points.push([lon, lat]);
  }
  const kind: Shape["kind"] = m[1] === "a" ? "area" : "line";
  if (points.length < (kind === "area" ? 3 : 2)) return undefined;
  return { kind, points };
}

/** Shape -> "a:lon,lat;…" (lines "l:"), 5 decimals. Only digits, `.`, `-`, `,`, `;`, `:`, `a` and `l`. */
export function shapeParam(s: Shape): string {
  return `${s.kind === "area" ? "a" : "l"}:${s.points
    .slice(0, MAX_POINTS)
    .map(([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`)
    .join(";")}`;
}

/** Only a shape that measures something travels in a link. */
function completeShape(s: Shape | null | undefined): Shape | undefined {
  if (!s) return undefined;
  return s.points.length >= (s.kind === "area" ? 3 : 2) ? s : undefined;
}

/** "lat,lon" in degrees, both in range, else undefined. */
export function parseLatLon(v: string | null | undefined): LonLat | undefined {
  if (!v) return undefined;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

export function formatLatLonParam(p: LonLat): string {
  return `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
}

/** A parcel point keeps 5 decimals (about 1 m): a narrow lot is smaller than 4 decimals' 11 m. */
export function formatParcelParam(p: LonLat): string {
  return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
}

const LAYER_SET = new Set<string>(LAYER_IDS);

export function parseShare(search: string): ShareState {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const num = (k: string) => {
    const v = q.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const out: ShareState = {};
  const lat = num("lat");
  const lon = num("lon");
  if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    out.lat = lat;
    out.lon = lon;
  }
  const h = num("h");
  if (h != null && h > 100 && h < 5e7) out.h = h;
  const hd = num("hd");
  if (hd != null) out.hd = ((hd % 360) + 360) % 360;
  const p = num("p");
  if (p != null && p <= 0 && p >= -90) out.p = p;
  const layers = q.get("layers");
  if (layers != null) {
    out.layers = layers
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is LayerId => LAYER_SET.has(s));
  }
  const t = q.get("t");
  if (t) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) out.t = ms;
  }
  const sel = q.get("sel");
  if (sel) {
    const i = sel.indexOf(":");
    const layer = sel.slice(0, i);
    const id = sel.slice(i + 1);
    if (LAYER_SET.has(layer) && id) out.sel = { layer: layer as LayerId, id };
  }
  if (q.get("report") === "1") out.report = true;
  if (q.get("market") === "1") out.market = true;
  const v = q.get("v");
  if (v && isValidVintage(v)) out.vintage = v;
  const lens = q.get("lens");
  if (isPersonaId(lens)) out.lens = lens;
  if (q.get("embed") === "1") out.embed = true;
  const zoning = parseLatLon(q.get("zoning"));
  if (zoning) out.zoning = zoning;
  const pin = parseLatLon(q.get("pin"));
  if (pin) out.pin = pin;
  const cmp = parseLatLon(q.get("cmp"));
  if (cmp) out.cmp = cmp;
  if (q.get("space") === "1") out.space = true;
  const shape = parseShape(q.get("shape"));
  if (shape) out.shape = shape;
  const parcel = parseLatLon(q.get("parcel"));
  if (parcel) out.parcel = parcel;
  const ground = parseLatLon(q.get("ground"));
  if (ground) out.ground = ground;
  if (q.get("aoi") === "1") out.aoi = true;
  const here = parseLatLon(q.get("here"));
  if (here) out.here = here;
  const terrain = parseTerrain(q.get("terrain"));
  if (terrain != null) out.terrain = terrain;
  const slr = num("slr");
  if (isSlrFeet(slr)) out.slr = slr;
  const wb = parseReleaseId(q.get("wb"));
  if (wb != null) out.wb = wb;
  const ty = parseTopoYear(q.get("ty"));
  if (ty != null) out.ty = ty;
  const ny = parseNaipYear(q.get("ny"));
  if (ny != null) out.ny = ny;
  const sv = parseSviThemeParam(q.get("sv"));
  if (sv != null) out.sv = sv;
  if (q.get("hs") === "all") out.hs = "all";
  const bb = parseMeasureParam(q.get("bb"));
  if (bb != null) out.bb = bb;
  const wr = parseMeasureParam(q.get("wr"));
  if (wr != null) out.wr = wr;
  if (q.get("wrs") === "state") out.wrs = "state";
  if (q.get("hv") === "count") out.hv = "count";
  const hp = housingPartsPref(q.get("hp") ?? "");
  if (hp.length) out.hp = hp.join(",");
  return out;
}

export function shareQuery(s: ShareState): string {
  const q = new URLSearchParams();
  if (s.lat != null && s.lon != null) {
    q.set("lat", s.lat.toFixed(4));
    q.set("lon", s.lon.toFixed(4));
  }
  if (s.h != null) q.set("h", String(Math.round(s.h)));
  if (s.hd != null) {
    const hd = ((s.hd % 360) + 360) % 360;
    if (hd > 0.5 && hd < 359.5) q.set("hd", hd.toFixed(0));
  }
  if (s.p != null) q.set("p", s.p.toFixed(0));
  if (s.layers) q.set("layers", s.layers.join(","));
  if (s.t != null) q.set("t", new Date(s.t).toISOString().slice(0, 19) + "Z");
  // An identified parcel travels as its point; its selection id cannot be looked up in a feed.
  if (s.sel && !(s.parcel && s.sel.layer === "parcels")) q.set("sel", `${s.sel.layer}:${s.sel.id}`);
  if (s.report) q.set("report", "1");
  if (s.market) q.set("market", "1");
  if (s.vintage && isValidVintage(s.vintage)) q.set("v", s.vintage);
  if (s.lens) q.set("lens", s.lens);
  if (s.embed) q.set("embed", "1");
  if (s.zoning) q.set("zoning", `${s.zoning.lat.toFixed(5)},${s.zoning.lon.toFixed(5)}`);
  if (s.pin) q.set("pin", formatLatLonParam(s.pin));
  if (s.cmp) q.set("cmp", formatLatLonParam(s.cmp));
  if (s.space) q.set("space", "1");
  if (s.parcel) q.set("parcel", formatParcelParam(s.parcel));
  if (s.ground) q.set("ground", `${s.ground.lat.toFixed(5)},${s.ground.lon.toFixed(5)}`);
  if (s.terrain != null) q.set("terrain", String(Number(s.terrain.toFixed(2))));
  if (s.slr != null) q.set("slr", String(s.slr));
  if (s.wb != null) q.set("wb", String(s.wb));
  if (s.ty != null) q.set("ty", String(s.ty));
  if (s.ny != null) q.set("ny", String(s.ny));
  if (s.sv != null) q.set("sv", String(s.sv));
  if (s.hs) q.set("hs", s.hs);
  if (s.bb != null) q.set("bb", String(s.bb));
  if (s.wr != null) q.set("wr", String(s.wr));
  if (s.wrs) q.set("wrs", s.wrs);
  if (s.hv) q.set("hv", s.hv);
  if (s.hp) q.set("hp", s.hp);
  // The Area panel belongs to a drawn area; without one it has nothing to show.
  if (s.aoi && completeShape(s.shape)?.kind === "area") q.set("aoi", "1");
  if (s.here) q.set("here", `${s.here.lat.toFixed(5)},${s.here.lon.toFixed(5)}`);
  let str = q.toString();
  // The shape goes last and unescaped (URLSearchParams would write , ; : as
  // %2C %3B %3A), so a link with a drawn area stays readable. Its characters
  // are all legal in a query string; nothing else in the link is touched.
  const shape = completeShape(s.shape);
  if (shape) str += `${str ? "&" : ""}shape=${shapeParam(shape)}`;
  return str ? `?${str}` : "";
}

/** The current cockpit as a ShareState. */
export function currentShare(): ShareState {
  const st = useGlobe.getState();
  const strata = useStrata.getState();
  const on = LAYER_IDS.filter((id) => st.layers[id]);
  const pick = useParcelPick.getState().pick;
  const parcel = st.selected?.layer === "parcels" && pick ? { lat: pick.lat, lon: pick.lon } : undefined;
  const prefs = useSettings.getState().prefs;
  // A ground answer travels as its point: its selection id cannot be looked up in a feed.
  const gp = useGroundPick.getState().pick;
  const ground = gp && isGroundSelection(st.selected) ? { lat: gp.lat, lon: gp.lon } : undefined;
  const here = useHere.getState().pick;
  // A zoning answer travels as its point: its selection id cannot be looked up in a feed.
  const zpick = useZoningPick.getState().pick;
  const zoning = zpick && st.selected?.layer === "zoning" && st.selected.id === zoningPointId(zpick.lon, zpick.lat) ? zpick : undefined;
  return {
    lat: st.view.lat,
    lon: st.view.lon,
    h: st.view.height,
    hd: st.view.heading,
    p: st.view.pitch,
    layers: on,
    t: Math.abs(st.clock.offsetMs) >= 60_000 ? Date.now() + st.clock.offsetMs : undefined,
    sel: zoning || ground || isGroundSelection(st.selected) ? undefined : (st.selected ?? undefined),
    report: st.waterReportOpen || undefined,
    market: st.marketReportOpen || undefined,
    vintage: getVintage() ?? undefined,
    lens: useLens.getState().personaId ?? undefined,
    embed: st.embed || undefined,
    zoning: zoning ? { lat: zoning.lat, lon: zoning.lon } : undefined,
    pin: strata.pin ?? undefined,
    cmp: strata.compare ?? undefined,
    space: st.spaceWeatherOpen || undefined,
    shape: completeShape(st.measure.shape),
    parcel,
    ground,
    terrain: prefs.terrain ? prefs.terrainExaggeration : undefined,
    slr: st.layers.sealevel ? prefs.seaLevelFt : undefined,
    wb: st.layers.wayback && prefs.waybackRelease != null ? prefs.waybackRelease : undefined,
    ty: st.layers.topo && prefs.topoYear != null ? prefs.topoYear : undefined,
    ny: st.layers.naip && prefs.naipYear != null ? prefs.naipYear : undefined,
    sv: st.layers.vulnerability && prefs.sviTheme !== "0" ? parseSviTheme(prefs.sviTheme) : undefined,
    hs: st.layers.hospitals && prefs.hospitalStatus === "all" ? "all" : undefined,
    bb: st.layers.broadband && parseBroadbandMeasure(prefs.broadbandMeasure) !== 0 ? parseBroadbandMeasure(prefs.broadbandMeasure) : undefined,
    wr: st.layers.wildfirerisk && parseWrcMeasure(prefs.wrcMeasure) !== 0 ? parseWrcMeasure(prefs.wrcMeasure) : undefined,
    wrs: st.layers.wildfirerisk && prefs.wrcScope === "state" ? "state" : undefined,
    hv: st.layers.housing && parseHousingMeasure(prefs.housingMeasure) === 1 ? "count" : undefined,
    hp: st.layers.housing && housingPartsPref(prefs.housingParts).length ? housingPartsPref(prefs.housingParts).join(",") : undefined,
    aoi: useArea.getState().open && areaRing(st.measure.shape) ? true : undefined,
    here: here ? { lat: here.lat, lon: here.lon } : undefined,
  };
}

export function shareUrl(s: ShareState = currentShare()): string {
  const base = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  return base + shareQuery(s);
}

/** Keep the address bar in sync with the cockpit (replaceState, throttled). */
export function startUrlSync(): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = "";
  const write = () => {
    timer = null;
    const next = shareQuery(currentShare());
    if (next === last) return;
    last = next;
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${next}`);
    } catch {
      /* some embedders forbid it */
    }
  };
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(write, 1000);
  };
  const unsub = useGlobe.subscribe((s, prev) => {
    if (
      s.view !== prev.view ||
      s.layers !== prev.layers ||
      s.clock.offsetMs !== prev.clock.offsetMs ||
      s.selected !== prev.selected ||
      s.waterReportOpen !== prev.waterReportOpen ||
      s.marketReportOpen !== prev.marketReportOpen ||
      s.spaceWeatherOpen !== prev.spaceWeatherOpen ||
      s.measure.shape !== prev.measure.shape
    ) {
      schedule();
    }
  });
  const unsubReleases = useReleases.subscribe((s, prev) => {
    if (s.vintage !== prev.vintage) schedule();
  });
  const unsubLens = useLens.subscribe((s, prev) => {
    if (s.personaId !== prev.personaId) schedule();
  });
  const unsubStrata = useStrata.subscribe((s, prev) => {
    if (s.pin !== prev.pin || s.compare !== prev.compare) schedule();
  });
  const unsubZoning = useZoningPick.subscribe((s, prev) => {
    if (s.pick !== prev.pick) schedule();
  });
  const unsubParcel = useParcelPick.subscribe((s, prev) => {
    if (s.pick?.lon !== prev.pick?.lon || s.pick?.lat !== prev.pick?.lat) schedule();
  });
  const unsubPrefs = useSettings.subscribe((s, prev) => {
    const a = s.prefs;
    const b = prev.prefs;
    if (a.terrain !== b.terrain || a.terrainExaggeration !== b.terrainExaggeration || a.seaLevelFt !== b.seaLevelFt || a.waybackRelease !== b.waybackRelease || a.topoYear !== b.topoYear || a.naipYear !== b.naipYear || a.sviTheme !== b.sviTheme || a.hospitalStatus !== b.hospitalStatus || a.broadbandMeasure !== b.broadbandMeasure || a.wrcMeasure !== b.wrcMeasure || a.wrcScope !== b.wrcScope || a.housingMeasure !== b.housingMeasure || a.housingParts !== b.housingParts) schedule();
  });
  const unsubGround = useGroundPick.subscribe((s, prev) => {
    if (s.pick?.lon !== prev.pick?.lon || s.pick?.lat !== prev.pick?.lat) schedule();
  });
  const unsubArea = useArea.subscribe((s, prev) => {
    if (s.open !== prev.open) schedule();
  });
  const unsubHere = useHere.subscribe((s, prev) => {
    if (s.pick?.lon !== prev.pick?.lon || s.pick?.lat !== prev.pick?.lat) schedule();
  });
  return () => {
    unsub();
    unsubReleases();
    unsubLens();
    unsubStrata();
    unsubZoning();
    unsubParcel();
    unsubPrefs();
    unsubGround();
    unsubArea();
    unsubHere();
    if (timer) clearTimeout(timer);
  };
}

/**
 * Apply a parsed share state to a ready globe: layers, clock, camera, report,
 * and the selection once its layer has loaded (best effort, ~20 s).
 */
export function applyShare(s: ShareState, opts: { fly?: boolean } = {}): void {
  const st = useGlobe.getState();
  // A lens goes first so an explicit layer list or panel in the same link wins over its defaults.
  if (s.lens) applyPersona(s.lens, { fly: opts.fly !== false && s.lat == null, configure: true });
  if (s.layers) {
    for (const id of LAYER_IDS) st.setLayer(id, s.layers.includes(id));
  }
  if (s.t != null) setMissionTime(s.t);
  if (s.vintage) {
    useReleases.getState().setVintage(s.vintage);
    // An explicit clock wins; otherwise the vintage pins the clock to that day.
    if (s.t == null) setMissionTime(vintageClockMs(s.vintage));
  }
  // The constructs stack and a comparison: anchor first, so the layer asks for the linked point.
  if (s.pin || s.cmp) {
    const strata = useStrata.getState();
    if (s.pin) strata.setPin(s.pin);
    else if (s.lat != null && s.lon != null) strata.setPin({ lat: s.lat, lon: s.lon });
    st.setLayer("constructs", true);
    if (s.cmp) void strata.setCompare(s.cmp);
  }
  // A shared zoning answer: the layer on, and the point asked about once the camera has arrived.
  if (s.zoning) {
    const z = s.zoning;
    st.setLayer("zoning", true);
    setTimeout(() => void identifyZoning(z.lon, z.lat), opts.fly !== false && s.lat != null ? 4200 : 300);
  }
  if (s.report) st.setWaterReportOpen(true);
  if (s.market) st.setMarketReportOpen(true);
  if (s.space) st.setSpaceWeatherOpen(true);
  // Terrain and the sea level scenario are display settings: a link that carries them sets them.
  if (s.terrain != null || s.slr != null || s.wb != null || s.ty != null || s.ny != null || s.sv != null || s.hs != null || s.bb != null || s.wr != null || s.wrs != null || s.hv != null || s.hp != null) {
    const set = useSettings.getState().setPref;
    if (s.terrain != null) {
      set("terrain", true);
      set("terrainExaggeration", s.terrain);
    }
    if (s.slr != null) set("seaLevelFt", s.slr);
    // An id Esri does not list is kept as asked; the layer falls back to the newest and says so.
    if (s.wb != null) set("waybackRelease", s.wb);
    // A year with no sheet at the view is kept as asked; the layer says which editions are here.
    if (s.ty != null) set("topoYear", s.ty);
    // A year NAIP did not fly at the view is kept as asked; the layer says so.
    if (s.ny != null) set("naipYear", s.ny);
    if (s.sv != null) set("sviTheme", String(s.sv));
    if (s.hs) set("hospitalStatus", s.hs);
    if (s.bb != null) set("broadbandMeasure", String(s.bb));
    if (s.wr != null) set("wrcMeasure", String(s.wr));
    if (s.wrs) set("wrcScope", s.wrs);
    if (s.hv) set("housingMeasure", "1");
    if (s.hp) set("housingParts", s.hp);
  }
  // A shared ground answer: asked once the camera has arrived, of the layers now on.
  if (s.ground) {
    const g = s.ground;
    setTimeout(() => void identifyGround(g.lon, g.lat), opts.fly !== false && s.lat != null ? 4200 : 300);
  }
  // A shared shape is shown with its readout, not left in drawing mode.
  if (s.shape) st.setMeasure({ mode: "off", shape: s.shape, elevation: null });
  if (s.aoi && s.shape?.kind === "area") useArea.getState().setOpen(true);
  // A shared "what's here": asked once the camera has arrived.
  if (s.here) {
    const h = s.here;
    setTimeout(() => void openHere(h.lon, h.lat), opts.fly !== false && s.lat != null ? 4200 : 300);
  }
  if (opts.fly !== false && s.lat != null && s.lon != null) {
    flyTo(s.lon, s.lat, { height: s.h ?? 120_000, pitchDeg: s.p ?? -55, headingDeg: s.hd ?? 0, durationS: 4 });
  }
  // A shared parcel: the layer on, and its dossier asked for once the camera has arrived.
  if (s.parcel) {
    const pt = s.parcel;
    st.setLayer("parcels", true);
    setTimeout(() => void identifyParcel(pt.lon, pt.lat), opts.fly !== false && s.lat != null ? 4200 : 300);
  }
  if (s.sel && !(s.parcel && s.sel.layer === "parcels")) {
    const sel = s.sel;
    const started = Date.now();
    const tryPick = () => {
      const f = getRenderer(sel.layer)?.getFeature(sel.id);
      if (f) {
        useGlobe.getState().select(sel, f);
        flyToSelection(sel);
        return;
      }
      if (Date.now() - started < 20_000) setTimeout(tryPick, 700);
      else useGlobe.getState().pushLog({ level: "warn", text: `Shared object ${sel.id} is not in the ${sel.layer} feed right now.` });
    };
    setTimeout(tryPick, 1500);
  }
}

export async function copyShareLink(): Promise<string> {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    useGlobe.getState().pushLog({ level: "info", text: "Link copied. It carries the view, the layers, the clock, the vintage, the selection (an identified parcel as its point), open reports, any comparison and a drawn shape." });
  } catch {
    useGlobe.getState().pushLog({ level: "warn", text: `Clipboard blocked; the link is ${url}` });
  }
  return url;
}
