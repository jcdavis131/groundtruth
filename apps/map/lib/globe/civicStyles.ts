"use client";
// Styles for the civic layers: zoning districts, building permits, business
// licences and environmental permits. Zoning is ground polygons in the
// colours zoning maps conventionally use (residential yellow, commercial red,
// industrial purple); the three permit layers are points. Every near-only
// layer draws the box it loaded as a dashed outline.

import type { LayerStyle } from "./renderer";
import type { LayerFeature } from "@/lib/layers/types";
import type { ZoningFamily } from "@/lib/zoning/features";
import { isLoadedBox } from "@/lib/layers/civicBox";
import type { SchoolExtra } from "@/lib/civic/schools";
import { polyFills, polyOutlines, UNRATED } from "./hazardStyles";

const LOADED_BOX = "#E5E7EB";

// ---------------------------------------------------------------- zoning

export const ZONING_FAMILY_COLOR: Record<Exclude<ZoningFamily, "coded">, string> = {
  residential: "#FACC15",
  mixed: "#FB923C",
  commercial: "#F87171",
  downtown: "#E879F9",
  industrial: "#A78BFA",
  planned: "#2DD4BF",
  public: "#4ADE80",
  "right-of-way": "#9CA3AF",
  other: "#94A3B8",
};

/** For cities that publish no category: a colour per district code, so neighbours differ; it means nothing else. */
const CODED = ["#60A5FA", "#F472B6", "#34D399", "#FBBF24", "#C084FC", "#22D3EE", "#FB7185", "#A3E635"];

export function codedColor(code: string): string {
  // The base district (before any suffix) keeps one colour: "PD-571" and "PD-1090" differ, "CBD-CURE" and "CBD" match.
  const base = code.split(/[-\s(]/)[0] ?? code;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return CODED[h % CODED.length];
}

export function zoningColor(f: LayerFeature): string {
  const x = f.properties.extra as { family?: ZoningFamily; code?: string } | undefined;
  const fam = x?.family ?? "other";
  if (fam === "coded") return codedColor(x?.code ?? f.properties.name);
  return ZONING_FAMILY_COLOR[fam];
}

export const zoningStyle: LayerStyle = {
  color: "#F0ABFC",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : zoningColor(f)),
  label: (f) => f.properties.name,
  labelMax: 40,
  labelWhen: (f) => !isLoadedBox(f),
  polygons: (f) => (isLoadedBox(f) ? null : polyFills(f, zoningColor(f), f.properties.kind === "right-of-way" ? 0.06 : 0.2)),
  lines: (f) => (isLoadedBox(f) ? polyOutlines(f, LOADED_BOX, 0.7, 1.5, true) : polyOutlines(f, zoningColor(f), 0.65, 1)),
};

// ---------------------------------------------------------------- permits, licences, environmental

/** Building permits by the city's own permit words (lib/permits/dossier.ts permitFamily). */
export const PERMIT_FAMILY_COLOR: Record<string, string> = {
  new: "#4ADE80",
  demolition: "#F87171",
  alteration: "#FDBA74",
  trades: "#60A5FA",
  other: "#CBD5E1",
};

function boxLines(f: LayerFeature) {
  return isLoadedBox(f) ? polyOutlines(f, LOADED_BOX, 0.7, 1.5, true) : null;
}

export const permitsStyle: LayerStyle = {
  color: "#FDBA74",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : PERMIT_FAMILY_COLOR[f.properties.kind ?? "other"] ?? PERMIT_FAMILY_COLOR.other),
  // Bigger dots for bigger jobs, where the city published a valuation; none published is the base size, not zero.
  pointSize: (f) => {
    const v = (f.properties.extra as { valuation?: number } | undefined)?.valuation;
    if (v == null) return 6;
    return v >= 5_000_000 ? 11 : v >= 500_000 ? 9 : v >= 50_000 ? 7 : 6;
  },
  label: (f) => f.properties.name,
  labelMax: 25,
  labelWhen: (f) => !isLoadedBox(f),
  lines: boxLines,
  scaleByDistance: [1.5e3, 1.0, 8e3, 0.6],
};

export const LICENCE_SOURCE_COLOR: Record<string, string> = {
  nysla: "#C084FC",
  chicago: "#67E8F9",
  sanfrancisco: "#67E8F9",
  losangeles: "#67E8F9",
  nycdcwp: "#67E8F9",
};

export const licencesStyle: LayerStyle = {
  color: "#67E8F9",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : LICENCE_SOURCE_COLOR[f.properties.kind ?? ""] ?? "#67E8F9"),
  pointSize: () => 5,
  label: (f) => f.properties.name,
  labelMax: 30,
  labelWhen: (f) => !isLoadedBox(f),
  lines: boxLines,
  scaleByDistance: [1e3, 1.0, 3e3, 0.6],
};

/** ECHO's compliance words: a violation in its words is amber; none reported is "not rated" violet, never calm. */
export function envColor(f: LayerFeature): string {
  const x = f.properties.extra as { program?: string; compliance?: string } | undefined;
  if (x?.program === "usace") return "#38BDF8";
  const c = (x?.compliance ?? "").toLowerCase();
  if (!c || c.startsWith("not reported")) return UNRATED;
  if (/\bno violation/.test(c)) return x?.program === "air" ? "#A7F3D0" : "#86EFAC";
  if (/violation|noncompliance|non-compliance/.test(c)) return "#FBBF24";
  return UNRATED;
}

export const envpermitsStyle: LayerStyle = {
  color: "#86EFAC",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : envColor(f)),
  pointSize: (f) => ((f.properties.extra as { program?: string } | undefined)?.program === "usace" ? 7 : 6),
  label: (f) => f.properties.name,
  labelMax: 20,
  labelWhen: (f) => !isLoadedBox(f),
  lines: boxLines,
  scaleByDistance: [5e3, 1.0, 4e4, 0.6],
};

// ---------------------------------------------------------------- contaminated sites (EPA EMEF)

/** EPA program listings by program; Superfund drawn largest. A colour is the program, never a severity. */
export const CONTAMINANT_COLOR: Record<string, string> = {
  sems: "#F87171",
  tri: "#C084FC",
  rcra: "#FBBF24",
  acres: "#A3A3A3",
  fuds: "#A3B23C",
};

/** FUDS: an olive program colour; a property with every project at closeout is drawn dimmer; munitions response sites dashed in a lighter olive. */
const FUDS_CLOSED = "#6B7330";
const FUDS_MRS = "#D9F99D";

function fudsColor(f: LayerFeature): string {
  const x = f.properties.extra as { shape?: string; fudsStatus?: string | null } | undefined;
  if (x?.shape === "mrs") return FUDS_MRS;
  return x?.fudsStatus === "all-closed-out" ? FUDS_CLOSED : CONTAMINANT_COLOR.fuds;
}

/**
 * Superfund site boundaries by NPL_STATUS_CODE: final solid red, proposed orange dashed, deleted
 * grey; any other code (not on the NPL, removed, part of another site, pre-proposal, withdrawn,
 * not valid) a thin neutral outline; no status given dotted (dashed, lighter). A colour is the
 * list status, never a severity.
 */
const NPL_FINAL = "#DC2626";
const NPL_PROPOSED = "#F97316";
const NPL_DELETED = "#9CA3AF";
const NPL_OTHER = "#CBD5E1";
const NPL_NONE = "#E5E7EB";

function nplOf(f: LayerFeature): { color: string; fill: number; width: number; dashed: boolean } {
  const code = (f.properties.extra as { nplCode?: string | null } | undefined)?.nplCode ?? null;
  if (code === "F") return { color: NPL_FINAL, fill: 0.16, width: 2, dashed: false };
  if (code === "P") return { color: NPL_PROPOSED, fill: 0.1, width: 2, dashed: true };
  if (code === "D") return { color: NPL_DELETED, fill: 0.08, width: 1.5, dashed: false };
  if (code == null) return { color: NPL_NONE, fill: 0, width: 1.2, dashed: true };
  return { color: NPL_OTHER, fill: 0, width: 1, dashed: false };
}

const isBoundary = (f: LayerFeature) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon";

/** The NPL list's status on a Superfund point's label ("SEMS NJD980654131 · NPL: final"). */
function contaminantLabel(f: LayerFeature): string {
  const x = f.properties.extra as { npl?: { status?: string | null } | null; shape?: string } | undefined;
  if (x?.shape === "boundary") {
    const n = f.properties.details?.["site (as EPA publishes it)"];
    return typeof n === "string" && n ? n : f.properties.name;
  }
  if (f.properties.kind === "fuds") {
    const n = f.properties.details?.["property (as USACE lists it)"] ?? f.properties.details?.["munitions response site (as USACE lists it)"];
    return typeof n === "string" && n ? n : f.properties.name;
  }
  const s = x?.npl?.status?.toLowerCase();
  const short = s === "npl site" ? "final" : s === "proposed npl site" ? "proposed" : s === "deleted npl site" ? "deleted" : s;
  return short ? `${f.properties.name} · NPL: ${short}` : f.properties.name;
}

export const contaminantsStyle: LayerStyle = {
  color: "#F87171",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : f.properties.kind === "fuds" ? fudsColor(f) : isBoundary(f) ? nplOf(f).color : (CONTAMINANT_COLOR[f.properties.kind ?? ""] ?? "#F87171")),
  pointSize: (f) => (f.properties.kind === "sems" ? 9 : f.properties.kind === "rcra" ? 5 : 7),
  label: contaminantLabel,
  labelMax: 20,
  labelWhen: (f) => !isLoadedBox(f),
  polygons: (f) => {
    if (isLoadedBox(f) || !isBoundary(f)) return null;
    if (f.properties.kind === "fuds") return polyFills(f, fudsColor(f), (f.properties.extra as { shape?: string }).shape === "mrs" ? 0.08 : 0.12);
    const s = nplOf(f);
    return s.fill > 0 ? polyFills(f, s.color, s.fill) : null;
  },
  lines: (f) => {
    if (isLoadedBox(f)) return polyOutlines(f, LOADED_BOX, 0.7, 1.5, true);
    if (!isBoundary(f)) return null;
    if (f.properties.kind === "fuds") {
      const mrs = (f.properties.extra as { shape?: string }).shape === "mrs";
      return polyOutlines(f, fudsColor(f), 0.85, mrs ? 1.5 : 2, mrs);
    }
    const s = nplOf(f);
    return polyOutlines(f, s.color, 0.85, s.width, s.dashed);
  },
  scaleByDistance: [5e3, 1.0, 4e4, 0.6],
};

// ---------------------------------------------------------------- leaking tanks by county (EPA UST Finder)

/** Open releases per county, in fixed count bins; a count EPA leaves empty is outlined grey, never filled as 0. */
const UST_BINS = [
  { from: 0, color: "#FFF7ED" },
  { from: 1, color: "#FED7AA" },
  { from: 10, color: "#FDBA74" },
  { from: 50, color: "#FB923C" },
  { from: 200, color: "#C2410C" },
];
const UST_NOT_GIVEN = "#94A3B8";

function ustColor(f: LayerFeature): string {
  const open = (f.properties.extra as { open?: number | null } | undefined)?.open;
  if (open == null) return UST_NOT_GIVEN;
  let c = UST_BINS[0].color;
  for (const b of UST_BINS) if (open >= b.from) c = b.color;
  return c;
}

export const ustStyle: LayerStyle = {
  color: "#FB923C",
  icon: () => null,
  colorFor: (f) => (isLoadedBox(f) ? LOADED_BOX : ustColor(f)),
  label: (f) => f.properties.name,
  labelMax: 15,
  labelWhen: (f) => !isLoadedBox(f),
  polygons: (f) => (isLoadedBox(f) || f.properties.kind === "not-given" ? null : polyFills(f, ustColor(f), 0.45)),
  lines: (f) => (isLoadedBox(f) ? polyOutlines(f, LOADED_BOX, 0.7, 1.5, true) : polyOutlines(f, f.properties.kind === "not-given" ? UST_NOT_GIVEN : "#9A3412", 0.6, 1, f.properties.kind === "not-given")),
};

// ---------------------------------------------------------------- public schools (NCES)

export const SCHOOL_LEVEL_COLOR: Record<SchoolExtra["levelClass"], string> = {
  elementary: "#22D3EE",
  middle: "#3B82F6",
  high: "#A78BFA",
  other: "#94A3B8",
};
/** A full virtual school's point is an office: drawn in a faint tint of its level. */
const SCHOOL_VIRTUAL_COLOR = "#E0F2FE";

function schoolColor(f: LayerFeature): string {
  if (isLoadedBox(f)) return LOADED_BOX;
  const x = f.properties.extra as SchoolExtra | undefined;
  if (x?.virtual) return SCHOOL_VIRTUAL_COLOR;
  return SCHOOL_LEVEL_COLOR[x?.levelClass ?? "other"];
}

export const schoolsStyle: LayerStyle = {
  color: "#0EA5E9",
  icon: () => null,
  colorFor: schoolColor,
  pointSize: (f) => ((f.properties.extra as SchoolExtra | undefined)?.charter ? 8 : 6),
  label: (f) => f.properties.name,
  labelMax: 25,
  labelWhen: (f) => !isLoadedBox(f),
  lines: (f) => (isLoadedBox(f) ? polyOutlines(f, LOADED_BOX, 0.7, 1.5, true) : null),
  scaleByDistance: [5e3, 1.0, 4e4, 0.6],
};
