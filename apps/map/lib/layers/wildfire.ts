// Layer: wildfire. Every current US wildland fire the interagency system
// publishes, drawn as its perimeter where one exists and as the incident's
// reported point where none does yet.
//
//   NIFC WFIGS   Current Interagency Fire Perimeters + Current Wildland Fire
//                Incident Locations (IRWIN): wildfires (WF) and prescribed
//                fires (RX), acres, percent contained, discovery date, when
//                the perimeter was captured
//
// The "current" services keep a fire until it is declared contained,
// controlled or out and its fall-off rule removes it, so a 100 %-contained
// fire can still be here; containment and perimeter age are on every
// feature. Missing containment is shown as "not reported", never as 0. The
// perimeter's age comes only from its capture time (poly_PolygonDateTime);
// about a quarter of perimeters publish none, and those say so rather than
// borrow the record's edit time, which can run weeks later.

import type { FeatureCollection } from "geojson";
import { ageText, type FireExtra } from "@/lib/hazards/features";
import type { BaseProps, FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";

export type { FireExtra } from "@/lib/hazards/features";

interface WildfireEnvelope {
  perimeters?: number;
  pointsWithoutPerimeter?: number;
  truncated?: boolean;
}

async function fetchWildfire(ctx: FetchContext): Promise<FetchResult> {
  const env = await proxy<FeatureCollection>("/api/hazards?op=wildfire", ctx);
  const meta = env as unknown as WildfireEnvelope;
  const features = env.data.features as unknown as LayerFeature[];
  let wf = 0;
  let rx = 0;
  let undated = 0;
  for (const f of features) {
    const x = f.properties.extra as FireExtra;
    if (x.type === "WF") wf++;
    else if (x.type === "RX") rx++;
    if (x.hasPerimeter && x.perimeterAt == null) undated++;
    // Ages are relative to the viewer's clock, so they are added here rather than on the server.
    const details: BaseProps["details"] = { ...f.properties.details };
    if (x.hasPerimeter) details["perimeter age"] = x.perimeterAt != null ? ageText(x.perimeterAt, ctx.now) : "unknown: WFIGS published no capture time";
    if (x.updatedAt != null) details["incident last updated"] = `${ageText(x.updatedAt, ctx.now)} ago`;
    f.properties.details = details;
  }
  const note =
    `${meta.perimeters ?? 0} perimeters · ${meta.pointsWithoutPerimeter ?? 0} points without a perimeter · ${wf} wildfires, ${rx} prescribed` +
    (undated ? ` · ${undated} ${undated === 1 ? "perimeter has" : "perimeters have"} no published capture time` : "") +
    (meta.truncated ? " · upstream record limit hit" : "");
  return {
    collection: { type: "FeatureCollection", features },
    source: "NIFC WFIGS",
    fetchedAt: ctx.now,
    note,
    meta: { count: features.length },
  };
}

export const wildfireLayer: LayerDefinition = {
  id: "wildfire",
  label: "Wildfires (US)",
  description:
    "Every current US wildland fire from the interagency WFIGS services: perimeters with acres, percent contained, discovery date and perimeter age (from its capture time, marked unknown where WFIGS publishes none), and incident points for fires with no perimeter yet. Prescribed fires are drawn in violet.",
  color: "#FF5A1F",
  updateIntervalMs: 5 * 60_000,
  defaultEnabled: false,
  attribution: "NIFC WFIGS (not legal documents; no warranty)",
  fetch: fetchWildfire,
};
