// Layer: live warnings. The constructs that are born and die.
//
// Every NWS alert rated Severe or Extreme is an area a forecaster drew (or the
// forecast zones they named) around the people and places at risk, valid from
// its onset until it expires. They are constructs like a county or a
// watershed, except that they appear and vanish by the hour. Each is drawn as
// its outline and a faint wash in its hazard colour, breathing while it is in
// force and fading as it runs out; select one to join it to everything loaded
// inside it (the gauges under a flood warning and how high their rivers are).
//
// Source: /api/live (api.weather.gov active alerts, keyless).

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import { ringCentroid, ringsArea } from "@/lib/fabric/geo";
import type { ConstructExtra, ConstructNode } from "@/lib/fabric/types";
import { FAMILIES, liveAlertId, type AlertItem, type HazardFamily } from "@/lib/live/live";
import type { LiveFeed } from "@/lib/live/fetch";

export interface AlertExtra extends ConstructExtra {
  family: HazardFamily;
  color: string;
  onset: number | null;
  until: number | null;
  outline: "polygon" | "zones";
}

function fmtTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().replace("T", " ").slice(0, 16) + "Z" : iso;
}

export function alertFeature(a: AlertItem): LayerFeature<Point> | null {
  if (!a.rings) return null;
  const c = ringCentroid(a.rings);
  if (!c) return null;
  const areaKm2 = Math.round(ringsArea(a.rings));
  const node: ConstructNode = {
    id: liveAlertId(a.id),
    kind: "nws-alert",
    domain: "hazard",
    name: a.event,
    code: a.id,
    areaKm2,
    anchor: c,
    rings: a.rings,
    facts: {
      severity: a.severity,
      urgency: a.urgency,
      certainty: a.certainty,
      issued: a.sender,
      onset: fmtTime(a.onset),
      expires: fmtTime(a.ends ?? a.expires),
      area: a.areaDesc,
      outline: a.outline === "zones" ? "the forecast zones it names" : "the polygon the forecaster drew",
    },
    links: [{ label: "NWS alert", url: a.url }],
    source: "nws-api",
  };
  const onset = a.onset ? Date.parse(a.onset) : NaN;
  const until = Date.parse(a.ends ?? a.expires ?? "");
  const extra: AlertExtra = {
    node,
    alt: 0,
    tier: 0,
    ground: c,
    family: a.family,
    color: FAMILIES[a.family].color,
    onset: Number.isFinite(onset) ? onset : null,
    until: Number.isFinite(until) ? until : null,
    outline: a.outline ?? "polygon",
  };
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [c[0], c[1], 0] },
    properties: {
      id: node.id,
      layer: "alerts",
      name: a.event,
      kind: a.family,
      observedAt: extra.onset ?? undefined,
      source: "NWS",
      details: {
        headline: a.headline,
        severity: `${a.severity} · ${a.urgency} · ${a.certainty}`,
        area: a.areaDesc,
        onset: fmtTime(a.onset),
        expires: fmtTime(a.ends ?? a.expires),
        "area (computed)": `${areaKm2.toLocaleString("en-US")} km²`,
        outline: node.facts.outline,
        issued: a.sender,
        "nws alert": a.url,
      },
      extra,
    },
  };
}

async function fetchAlerts(ctx: FetchContext): Promise<FetchResult> {
  const env = await proxy<LiveFeed>("/api/live", ctx);
  const features = env.data.alerts.map(alertFeature).filter((f): f is LayerFeature<Point> => !!f);
  const warnings = features.filter((f) => /warning/i.test(f.properties.name)).length;
  return {
    collection: { type: "FeatureCollection", features },
    source: "NWS active alerts",
    fetchedAt: Date.now(),
    note:
      `${features.length} Severe/Extreme alerts on the map · ${warnings} warnings${env.data.unmapped ? ` · ${env.data.unmapped} without an outline` : ""}` +
      // A failed NWS request answers with no alerts: say so, so none is read as calm.
      (env.data.failed?.some((f) => f.source === "nws-api") ? " · NWS did not answer: alerts missing, not absent" : ""),
  };
}

export const alertsLayer: LayerDefinition = {
  id: "alerts",
  label: "Live warnings",
  description:
    "NWS alerts rated Severe or Extreme, drawn as short-lived constructs: the area a forecaster drew (or the zones they named), in force from onset to expiry. Select one to join it to the gauges, cameras and everything else loaded inside it.",
  color: "#FB7185",
  updateIntervalMs: 5 * 60_000,
  defaultEnabled: false,
  attribution: "NOAA National Weather Service (public domain)",
  fetch: fetchAlerts,
};
