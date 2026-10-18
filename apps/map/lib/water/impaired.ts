// EPA ATTAINS impaired waters: the assessment units states, territories and
// tribes report to EPA as impaired (isimpaired = 'Y'), lines and areas, from
// EPA's ATTAINS_Assessment FeatureServer (owner OW_EPA). Pure: the request,
// the category meanings, and the row -> feature builder. The route lives in
// app/api/water (op=impaired), the layer in lib/layers/impaired.ts.
//
// A record is a regulatory listing for a whole assessment unit as the state
// reported it for one cycle, not a measured value at a point. Waters not
// shown were not reported impaired, which includes waters never assessed.

import type { LayerFeature } from "@/lib/layers/types";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";

export const ATTAINS = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/ATTAINS_Assessment/FeatureServer";
/** Layer 1 lines, layer 2 areas. */
export const ATTAINS_LAYERS = { lines: 1, areas: 2 } as const;
/** The service's maxRecordCount (2026-10-13): asked for per layer and box. */
export const ATTAINS_MAX = 2000;
/** Named fields only. The ~40 per-cause Y/N columns are left for the dossier follow-up. */
export const ATTAINS_FIELDS = [
  "assessmentunitidentifier",
  "assessmentunitname",
  "state",
  "organizationname",
  "reportingcycle",
  "ircategory",
  "overallstatus",
  "on303dlist",
  "hastmdl",
  "waterbodyreportlink",
  "cyclestatus",
] as const;
export const ATTAINS_WHERE = "isimpaired='Y'";

export const IMPAIRED_CAVEAT =
  "Waters that states report to EPA as impaired, as they reported them. A category is a regulatory listing for a whole assessment unit, not a measured value at the point you click. Reporting cycles differ by state (2022-2026). About 54% of the impaired line records shown are a state's submittal that EPA has not acted on yet; the EPA action status says which. Waters not shown were not reported impaired: that includes waters never assessed, which is not the same as clean.";

/** Integrated Report category -> what it means. Categories outside this table are shown as the state reports them. */
export const IR_CATEGORY: Record<string, string> = {
  "5": "impaired, needs a TMDL: on the 303(d) list",
  "4A": "impaired, TMDL approved",
  "4B": "impaired, other pollution controls expected to meet standards",
  "4C": "impaired by something other than a pollutant (e.g. flow or habitat alteration)",
};

export type ImpairedTier = "listed" | "planned" | "other";

export interface ImpairedExtra {
  shape: "line" | "area";
  category: string | null;
  tier: ImpairedTier;
  /** Y/N as published; null when absent (never read as N). */
  on303d: boolean | null;
  tmdl: boolean | null;
  auId: string | null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function yn(v: unknown): boolean | null {
  const s = str(v)?.toUpperCase();
  return s === "Y" ? true : s === "N" ? false : null;
}

/** 5, 5A, 5R (on the 303(d) list) draw as listed; 4A/4B/4C as planned. */
export function tierOf(category: string | null, on303d: boolean | null): ImpairedTier {
  if (category?.startsWith("5") || on303d === true) return "listed";
  if (category?.startsWith("4")) return "planned";
  return "other";
}

/** The category's line in the dossier. */
export function categoryText(category: string | null): string {
  if (!category) return "category not reported";
  const m = IR_CATEGORY[category];
  return m ? `${category}: ${m}` : `${category} (as the state reports it)`;
}

const isLine = (g: GeoJSON.Geometry) => g.type === "LineString" || g.type === "MultiLineString";
const isArea = (g: GeoJSON.Geometry) => g.type === "Polygon" || g.type === "MultiPolygon";

/** One ATTAINS layer's GeoJSON rows as features, named by assessment unit id. */
export function buildImpaired(
  rows: Array<{ id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>,
  shape: ImpairedExtra["shape"],
): LayerFeature[] {
  const out: LayerFeature[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const g = r.geometry;
    if (!g || !(shape === "line" ? isLine(g) : isArea(g))) return;
    const p = r.properties ?? {};
    const auId = str(p.assessmentunitidentifier);
    const key = `${shape}:${auId ?? i}`;
    if (seen.has(key)) return;
    seen.add(key);
    const category = str(p.ircategory);
    const on303d = yn(p.on303dlist);
    const tmdl = yn(p.hastmdl);
    const link = str(p.waterbodyreportlink);
    const x: ImpairedExtra = { shape, category, tier: tierOf(category, on303d), on303d, tmdl, auId };
    out.push({
      type: "Feature",
      geometry: g,
      properties: {
        id: `attains:${shape}:${auId ?? r.id ?? i}`,
        layer: "impaired",
        name: `${auId ?? "assessment unit"} · ${category ? `category ${category}` : "category not reported"}`,
        kind: x.tier,
        source: "EPA ATTAINS",
        details: {
          "assessment unit": str(p.assessmentunitname),
          "assessment unit id": auId,
          state: str(p.state),
          "reported by": str(p.organizationname),
          category: categoryText(category),
          "on the 303(d) list": on303d == null ? "not reported" : on303d ? "yes" : "no",
          TMDL: tmdl == null ? "not reported" : tmdl ? "yes" : "no",
          "overall status": str(p.overallstatus),
          "reporting cycle": str(p.reportingcycle),
          "EPA action status": str(p.cyclestatus),
          "How's My Waterway (EPA)": link && /^https:\/\/mywaterway\.epa\.gov\//.test(link) ? link : undefined,
          drawn: shape === "line" ? "the assessment unit's line (a stream reach)" : "the assessment unit's area (a lake, estuary or watershed)",
          "what this is": "a state's report to EPA that this water is impaired, for the whole assessment unit and one reporting cycle; not a measurement at this point",
        },
        // Never the unit's or the organisation's name (not searched this round) and never the unit id.
        extra: withEmbedText(
          x,
          recordText("attains-impaired", {
            state: str(p.state),
            reportingcycle: str(p.reportingcycle),
            ircategory: category ? categoryText(category) : null,
            on303dlist: on303d,
            hastmdl: tmdl,
            cyclestatus: str(p.cyclestatus),
          }),
        ),
      },
    });
  });
  return out;
}
