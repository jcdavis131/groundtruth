// The land report for a drawn area: what the loaded land, infrastructure
// and hazard layers say about the ground inside it, each figure with the
// arithmetic that produced it. Nothing is fetched and nothing is modelled:
//
//   area          the Measure tool's area on the authalic sphere
//   polygon share samples on a regular grid inside the area; a sample counts
//                 for a class when it falls in a loaded polygon of that class.
//                 share = samples in the class / samples the layer loaded
//   line length   each line cut into steps of at most 200 m; a step counts when
//                 its midpoint is inside. length = Σ counted steps
//   point counts  features whose position is inside, and sums of values their
//                 publishers give (a plant's nameplate MW)
//
// A layer that is off, still loading or failing is listed as missing, never
// as zero; samples outside the box a layer loaded are "not loaded", never
// "none", and so is a class whose service did not answer (a pipeline
// commodity). A line length or a count over an area that runs past the loaded box,
// or from an answer that hit a record limit or was coarsened, says it is
// partial. Pure, tested.

import type { LayerFeature, LayerId, LoadedBoxExtra } from "@/lib/layers/types";
import type { Access, FloodZoneExtra, PublicLandExtra, WetlandExtra } from "@/lib/land/features";
import type { FaultExtra, PipelineExtra, PipelineKind, RailExtra, TransmissionExtra } from "@/lib/infra/features";
import { FAULT_AGE_LEGEND, PIPELINE_LABEL } from "@/lib/infra/features";
import type { PlantExtra } from "@/lib/infra/plants";
import { countable } from "./area";
import { featureInside, inBox, lengthInside, lineParts, pointInPolygon, polygons, ringBox, sampleGrid, type Box, type Ring } from "./geometry";

export interface ReportLine {
  label: string;
  value: string;
  /** The arithmetic that produced the value, with its inputs. */
  formula?: string;
}

export interface ReportSection {
  title: string;
  source: string;
  lines: ReportLine[];
  notes?: string[];
}

export interface AreaReport {
  areaM2: number;
  samples: number;
  spacingM: number;
  sections: ReportSection[];
  /** Layers the report would read that are off or have no answer, and why. */
  missing: string[];
}

export interface ReportInput {
  ring: Ring;
  areaM2: number;
  features: LayerFeature[];
  /** Layers on and answering (a finished, successful fetch). */
  answering: ReadonlySet<LayerId>;
  on: Partial<Record<LayerId, boolean>>;
  /** Layer labels for the missing list. */
  labels?: Partial<Record<LayerId, string>>;
}

const fmtPct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`;
const fmtKm = (m: number) => (m >= 10_000 ? `${(m / 1000).toFixed(0)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const fmtArea = (m2: number) => {
  const acres = m2 / 4046.8564224;
  return m2 >= 1e6 ? `${(m2 / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} km² (${Math.round(acres).toLocaleString("en-US")} acres)` : `${Math.round(m2).toLocaleString("en-US")} m² (${acres.toLocaleString("en-US", { maximumFractionDigits: 1 })} acres)`;
};

interface PolyIndex {
  f: LayerFeature;
  box: Box;
  polys: number[][][][];
}

function indexPolygons(fs: LayerFeature[]): PolyIndex[] {
  const out: PolyIndex[] = [];
  for (const f of fs) {
    const polys = polygons(f.geometry);
    if (!polys.length) continue;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const p of polys) {
      const b = ringBox(p[0] ?? []);
      w = Math.min(w, b[0]);
      s = Math.min(s, b[1]);
      e = Math.max(e, b[2]);
      n = Math.max(n, b[3]);
    }
    out.push({ f, box: [w, s, e, n], polys });
  }
  return out;
}

function containing(idx: PolyIndex[], lon: number, lat: number, want?: (f: LayerFeature) => boolean): LayerFeature | null {
  for (const p of idx) {
    if (!inBox(lon, lat, p.box)) continue;
    if (want && !want(p.f)) continue;
    if (p.polys.some((poly) => pointInPolygon(lon, lat, poly))) return p.f;
  }
  return null;
}

/** The box a near-only layer drew as its dashed "loaded area", if it has one. */
function loadedBoxOf(fs: LayerFeature[]): Box | null {
  const b = fs.find((f) => f.properties.kind === "loaded-box");
  if (!b || b.geometry.type !== "Polygon") return null;
  return ringBox(b.geometry.coordinates[0]);
}

/** What the loaded box says the answer left out (record limit, coarsening, a size floor). */
function loadedExtraOf(fs: LayerFeature[]): LoadedBoxExtra {
  return (fs.find((f) => f.properties.kind === "loaded-box")?.properties.extra as LoadedBoxExtra | undefined) ?? {};
}

const boxWithin = (a: Box, b: Box) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const boxesMeet = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** How much of the area a near-only layer's answer covers: all of it, part of it, or none. */
function coverage(own: LayerFeature[], area: Box): "all" | "part" | "none" | "unknown" {
  const loaded = loadedBoxOf(own);
  if (!loaded) return "unknown";
  if (boxWithin(area, loaded)) return "all";
  return boxesMeet(area, loaded) ? "part" : "none";
}

/** Notes for an answer that is partial: the area runs past the loaded box, the record limit, coarsened outlines. */
function partialNotes(own: LayerFeature[], area: Box, what: string, limitOrder?: string): string[] {
  const notes: string[] = [];
  const x = loadedExtraOf(own);
  if (coverage(own, area) === "part") notes.push(`Part of the area lies outside the box this layer loaded: ${what} cover only the loaded part, so they are not totals. Move the camera over the area, or draw a smaller one.`);
  if (x.truncated) notes.push(`The service's record limit was hit when this layer loaded${limitOrder ? ` (${limitOrder} first)` : ""}: ${what} are a floor, not a total. Zoom in for the rest.`);
  if (x.coarsenedForSize) notes.push(`Outlines were coarsened to fit the response: ${what} are approximate.`);
  return notes;
}

interface ShareSpec {
  layer: LayerId;
  title: string;
  source: string;
  /** Class of a polygon feature, or null to skip it for the class tally. */
  classOf: (f: LayerFeature) => string | null;
  /** What a loaded sample in no polygon means. */
  none: string;
  notes?: string[];
}

function shareSection(spec: ShareSpec, all: LayerFeature[], samples: [number, number][], spacingM: number, areaM2: number): ReportSection {
  const own = all.filter((f) => f.properties.layer === spec.layer);
  const loaded = loadedBoxOf(own);
  const idx = indexPolygons(own.filter((f) => f.properties.kind !== "loaded-box" && spec.classOf(f) != null));
  const tally = new Map<string, number>();
  let n = 0;
  let none = 0;
  for (const [lon, lat] of samples) {
    if (loaded && !inBox(lon, lat, loaded)) continue;
    n++;
    const f = containing(idx, lon, lat);
    if (!f) {
      none++;
      continue;
    }
    const c = spec.classOf(f)!;
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  const lines: ReportLine[] = [];
  const notes = [...(spec.notes ?? [])];
  if (loaded && n < samples.length) notes.push(`${samples.length - n} of ${samples.length} samples fall outside the box this layer loaded: not loaded, not "none".`);
  if (n === 0) {
    lines.push({ label: "loaded samples", value: "none", formula: "the area lies outside the box this layer loaded; move the camera over it" });
    return { title: spec.title, source: spec.source, lines, notes };
  }
  for (const [c, h] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push({ label: c, value: `${fmtPct(h / n)} · about ${fmtArea((h / n) * areaM2 * (n / samples.length))}`, formula: `${h} of ${n} loaded samples = ${fmtPct(h / n)}; area ≈ share × drawn area × loaded fraction` });
  }
  lines.push({ label: spec.none, value: fmtPct(none / n), formula: `${none} of ${n} loaded samples` });
  notes.push(`Samples on a ${Math.round(spacingM)} m grid; a feature narrower than that can be missed or over-counted.`);
  return { title: spec.title, source: spec.source, lines, notes };
}

interface LengthSpec {
  layer: LayerId;
  title: string;
  source: string;
  classOf: (f: LayerFeature) => string;
  /** Which segments the route returns first when the record limit is hit. */
  limitOrder?: string;
  /** The class label of a part the loaded box lists as missing (its service did not answer). */
  missingLabel?: (part: string) => string;
}

function lengthSection(spec: LengthSpec, all: LayerFeature[], ring: Ring): ReportSection | null {
  const box = ringBox(ring);
  const own = all.filter((f) => f.properties.layer === spec.layer);
  // Every line layer draws its loaded box whenever it loaded anything: none means nothing
  // was loaded (the camera is above the heights it loads at), and an area outside it is unloaded.
  const cover = coverage(own, box);
  if (cover === "unknown" || cover === "none")
    return {
      title: spec.title,
      source: spec.source,
      lines: [
        {
          label: "inside the area",
          value: "not loaded",
          formula: cover === "none" ? "the area lies outside the box this layer loaded; move the camera over it" : "this layer has loaded nothing here (it loads only near the camera); move the camera down over the area",
        },
      ],
    };
  const notes = partialNotes(own, box, "lengths", spec.limitOrder);
  // A class whose service did not answer is "not loaded", never left out (which would read as none).
  const unanswered: ReportLine[] = (loadedExtraOf(own).missing ?? []).map((k) => ({
    label: spec.missingLabel?.(k) ?? k,
    value: "not loaded",
    formula: "the service did not answer when this layer loaded; its lines are missing, not absent",
  }));
  const by = new Map<string, { m: number; n: number }>();
  for (const f of own) {
    if (!countable(f)) continue;
    let m = 0;
    for (const part of lineParts(f.geometry)) m += lengthInside(part, ring, box);
    if (m <= 0) continue;
    const c = spec.classOf(f);
    const cur = by.get(c) ?? { m: 0, n: 0 };
    cur.m += m;
    cur.n++;
    by.set(c, cur);
  }
  if (!by.size) return { title: spec.title, source: spec.source, lines: [{ label: "inside the area", value: "none of the loaded lines" }, ...unanswered], notes };
  const lines = [...by.entries()]
    .sort((a, b) => b[1].m - a[1].m)
    .map(([c, v]) => ({ label: c, value: fmtKm(v.m), formula: `Σ of 200 m steps whose midpoint is inside, over ${v.n} loaded segment${v.n === 1 ? "" : "s"}` }));
  return { title: spec.title, source: spec.source, lines: [...lines, ...unanswered], notes };
}

const ACCESS_WORD: Record<Access, string> = { open: "open access", restricted: "restricted access", closed: "closed", unknown: "access unknown" };

const LAND_LAYERS: LayerId[] = ["flood", "wetlands", "publiclands"];
const LINE_LAYERS: LayerId[] = ["transmission", "pipelines", "rail", "faults"];

export function areaReport(input: ReportInput): AreaReport {
  const { ring, areaM2, features, answering, on } = input;
  const label = (l: LayerId) => input.labels?.[l] ?? l;
  const { points, spacingM } = sampleGrid(ring, 2500);
  const sections: ReportSection[] = [];
  const missing: string[] = [];

  sections.push({
    title: "Drawn area",
    source: "Measure tool",
    lines: [{ label: "area", value: fmtArea(areaM2), formula: "spherical excess on the authalic sphere, Rq = 6,371,007.2 m (the Measure tool's formula)" }],
  });

  const shares: ShareSpec[] = [
    {
      layer: "flood",
      title: "Flood zones (FEMA)",
      source: "FEMA NFHL layer 28 · regulatory map, not a forecast",
      classOf: (f) => {
        const x = f.properties.extra as FloodZoneExtra | undefined;
        if (!x) return null;
        if (x.hazard === "sfha" || x.hazard === "coastal") return `1 % annual-chance floodplain (zone ${x.zone})`;
        if (x.hazard === "undetermined") return "zone D: no FEMA analysis (not rated)";
        return `zone ${x.zone}${x.subtype ? ` (${x.subtype.toLowerCase()})` : ""}`;
      },
      none: "in no FEMA zone that loaded",
    },
    {
      layer: "wetlands",
      title: "Wetlands (NWI)",
      source: "USFWS National Wetlands Inventory · mapped from dated imagery",
      classOf: (f) => (f.properties.extra as WetlandExtra | undefined)?.type ?? "unclassified",
      none: "not in a mapped wetland",
    },
    {
      layer: "publiclands",
      title: "Public & protected lands (PAD-US)",
      source: "USGS PAD-US 4.1 · access codes are not permission to enter",
      classOf: (f) => {
        const x = f.properties.extra as PublicLandExtra | undefined;
        if (!x || x.category !== "Fee") return null;
        const mgr = f.properties.details?.manager;
        return `${ACCESS_WORD[x.access]}${mgr ? `, managed by ${mgr}` : ""}`;
      },
      none: "in no PAD-US fee unit",
      notes: ["Fee units only: easements and designations overlap them and are not counted as public land."],
    },
  ];
  for (const s of shares) {
    if (!on[s.layer]) missing.push(`${label(s.layer)}: off (switch it on to include it)`);
    else if (!answering.has(s.layer)) missing.push(`${label(s.layer)}: no answer yet, or it failed`);
    else sections.push(shareSection(s, features, points, spacingM, areaM2));
  }

  const lengths: LengthSpec[] = [
    { layer: "transmission", title: "Transmission lines (HIFLD archive)", source: "HIFLD, last updated 2024-09-30", limitOrder: "highest voltage", classOf: (f) => { const x = f.properties.extra as TransmissionExtra | undefined; return x?.kv != null ? `${x.kv} kV` : "voltage not published"; } },
    {
      layer: "pipelines",
      title: "Pipelines (EIA, generalized)",
      source: "EIA pipeline maps",
      limitOrder: "in each service's own order",
      classOf: (f) => PIPELINE_LABEL[(f.properties.extra as PipelineExtra | undefined)?.commodity ?? "natgas"],
      missingLabel: (k) => PIPELINE_LABEL[k as PipelineKind] ?? k,
    },
    { layer: "rail", title: "Rail (FRA/BTS)", source: "North American Rail Network", limitOrder: "longest segments", classOf: (f) => (f.properties.extra as RailExtra | undefined)?.cls ?? "rail" },
    { layer: "faults", title: "Quaternary faults (USGS)", source: "USGS Qfaults · not a forecast", limitOrder: "longest traces", classOf: (f) => FAULT_AGE_LEGEND[(f.properties.extra as FaultExtra | undefined)?.ageClass ?? "unspecified"] },
  ];
  for (const s of lengths) {
    if (!on[s.layer]) continue;
    if (!answering.has(s.layer)) {
      missing.push(`${label(s.layer)}: no answer yet, or it failed`);
      continue;
    }
    const sec = lengthSection(s, features, ring);
    if (sec) sections.push(sec);
  }

  // Point layers: counts, and sums of what their publishers give.
  const box = ringBox(ring);
  const counts = new Map<LayerId, LayerFeature[]>();
  for (const f of features) {
    const l = f.properties.layer;
    if (LAND_LAYERS.includes(l) || LINE_LAYERS.includes(l) || !countable(f) || f.geometry.type !== "Point") continue;
    if (!featureInside(f, ring, box)) continue;
    let arr = counts.get(l);
    if (!arr) counts.set(l, (arr = []));
    arr.push(f);
  }
  const pointLines: ReportLine[] = [];
  const pointNotes: string[] = [];
  for (const [l, fs] of counts) {
    pointLines.push({ label: label(l), value: `${fs.length}` });
    const own = features.filter((f) => f.properties.layer === l);
    for (const n of partialNotes(own, box, "counts and sums", undefined)) pointNotes.push(`${label(l)}: ${n}`);
    if (l === "plants") {
      const eia = fs.filter((f) => (f.properties.extra as PlantExtra | undefined)?.source === "eia");
      const wd = fs.length - eia.length;
      const mws = eia.map((f) => (f.properties.extra as PlantExtra).mw).filter((x): x is number => x != null);
      const floor = loadedExtraOf(own).floorMw;
      const loadedAsWorld = !loadedBoxOf(own);
      if (mws.length)
        pointLines.push({
          label: "operating nameplate capacity (EIA-860M)",
          value: `${Math.round(mws.reduce((a, b) => a + b, 0)).toLocaleString("en-US")} MW`,
          formula: [
            `Σ of ${mws.length} loaded US plants' published operating nameplate MW`,
            ...(eia.length > mws.length ? [`${eia.length - mws.length} planned-only plants add none`] : []),
            "a generator EIA lists with no nameplate value adds nothing to its plant's MW (the plant's dossier counts it)",
            ...(wd ? [`${wd} nuclear plant${wd === 1 ? "" : "s"} from Wikidata ${wd === 1 ? "is" : "are"} not summed (another source)`] : []),
            ...(floor
              ? [`at this camera height the layer loads only US plants of ${floor} MW or more, so smaller plants are not in the sum`]
              : loadedAsWorld
                ? ["the layer was loaded as its world view, which asks only for its largest plants (its note gives the floor), so smaller plants are not in the sum"]
                : []),
          ].join("; "),
        });
    }
    if (l === "dams") {
      const by = new Map<string, number>();
      for (const f of fs) {
        const k = String(f.properties.details?.["hazard potential"] ?? "not rated by source");
        by.set(k, (by.get(k) ?? 0) + 1);
      }
      pointLines.push({ label: "dams by hazard potential (NID)", value: [...by.entries()].map(([k, v]) => `${k} ${v}`).join(", "), formula: "hazard potential is the consequence of a failure, not the dam's condition" });
    }
  }
  if (pointLines.length) sections.push({ title: "Counted inside", source: "every loaded point layer", lines: pointLines, notes: ["Only what the layers that are on had loaded; a layer's box can end inside the area.", ...pointNotes] });

  for (const l of ["landcover", "firehazard", "slope", "soils", "geology", "crithab", "topo", "hydro", "naip"] as LayerId[]) {
    if (on[l]) missing.push(`${label(l)}: a picture, not features; click the ground inside the area for its value there`);
  }
  return { areaM2, samples: points.length, spacingM, sections, missing };
}

/** The report as plain text, formulas included, for copying. */
export function reportText(r: AreaReport, where: string): string {
  const out = [`Land report for a drawn area (${where})`, `${r.samples} samples on a ${Math.round(r.spacingM)} m grid`, ""];
  for (const s of r.sections) {
    out.push(`${s.title} (${s.source})`);
    for (const l of s.lines) out.push(`  ${l.label}: ${l.value}${l.formula ? `  [${l.formula}]` : ""}`);
    for (const n of s.notes ?? []) out.push(`  note: ${n}`);
    out.push("");
  }
  if (r.missing.length) {
    out.push("Not included:");
    for (const m of r.missing) out.push(`  ${m}`);
  }
  return out.join("\n");
}
