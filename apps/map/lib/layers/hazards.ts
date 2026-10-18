// Layer: hazard alerts. Warnings and disaster events as their publishers
// rate them, next to the earthquakes and live-warnings layers.
//
//   NWS alerts/active   every active US watch, warning and advisory with its
//                       severity, urgency and certainty. Drawn as the polygon
//                       NWS published, or else as the counties the alert lists
//                       in its SAME codes (TIGERweb 1:20M); marine and other
//                       zone-only alerts with no county are counted, not drawn
//   GDACS               every event GDACS marks current (floods, cyclones,
//                       droughts, volcanoes, wildfires, earthquakes) with its
//                       Green / Orange / Red alert level: the RSS feed, merged
//                       with the latest-100 list and a search for current
//                       Orange and Red events
//   NASA EONET          open volcano events (no severity published)
//
// Two other layers draw some of the same events, and this one steps aside
// for them only while they are on and drawing the event themselves:
//   - a GDACS quake that the USGS 24 h feed also has is left to the
//     Earthquakes layer, and only when GDACS rates it Green; Orange, Red and
//     unrated quakes always stay;
//   - an NWS alert rated Severe or Extreme is left to Live warnings (the
//     alerts layer, whose feed asks NWS for exactly those; LIVE_SEVERITIES)
//     only when /api/hazards marked it liveOutlined (that feed outlined it)
//     and Live warnings holds it right now. An alert that layer could not
//     outline, a live feed that failed, and a Live warnings layer that is
//     erroring or has not answered yet all leave the alert here. Moderate,
//     Minor and unrated alerts stay here either way.
// The stepping aside is a refine() over the fetched data: toggling either
// layer, or a new answer from one, re-runs it without a refetch. With both
// layers off, every event is drawn here. A severity the source did not
// publish is shown as "not rated by source" in its own colour; it is never
// drawn as calm.

import type { FeatureCollection } from "geojson";
import { hideableQuake, leftToLiveWarnings, type HazardAlertExtra } from "@/lib/hazards/features";
import { LIVE_SEVERITIES, liveAlertId } from "@/lib/live/live";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, RefineContext } from "./types";
import { proxy } from "./aircraft";

export type { HazardAlertExtra } from "@/lib/hazards/features";

export interface AlertsEnvelope {
  counts?: {
    nws?: {
      alerts: number;
      drawnAsPolygon: number;
      drawnAsCounties: number;
      notDrawn: number;
      liveChecked?: boolean;
      liveOutlined?: number;
    };
    gdacs?: { events: number; quakesAlsoInUsgs: number; usgsChecked: boolean; via: string[]; failed: string[]; truncated: boolean };
    eonet?: { volcanoes: number };
  };
  failed?: string[];
}

export interface SteppedAside {
  features: LayerFeature[];
  /** Green GDACS quakes left to Earthquakes. */
  quakesHidden: number;
  /** Severe/Extreme NWS alerts left to Live warnings, which is drawing each of them. */
  leftToLive: number;
  /** Severe/Extreme NWS alerts kept here while Live warnings is on (it is not drawing them, or not answering). */
  keptFromLive: number;
}

const isLiveSeverity = (x: HazardAlertExtra | undefined) =>
  x?.source === "NWS" && x.severity != null && (LIVE_SEVERITIES as readonly string[]).includes(x.severity);

/**
 * What this layer draws given the overlapping layers: the features kept, the
 * Green GDACS quakes left to Earthquakes, and the Severe and Extreme NWS
 * alerts left to Live warnings. A layer is stepped aside for only while it is
 * on and answering; an alert only when it is marked liveOutlined and Live
 * warnings holds it (liveAlertId). Pure: the host supplies the context.
 */
export function stepAside(all: LayerFeature[], ctx: Partial<RefineContext> | undefined): SteppedAside {
  const drawing = (id: "earthquakes" | "alerts") => ctx?.layersOn?.[id] === true && ctx.answering?.[id] === true;
  const quakesOn = drawing("earthquakes");
  const liveOn = ctx?.layersOn?.alerts === true;
  const liveDrawing = drawing("alerts");
  const holds = ctx?.holds ?? (() => false);
  let quakesHidden = 0;
  let leftToLive = 0;
  let keptFromLive = 0;
  const features = all.filter((f) => {
    const x = f.properties.extra as HazardAlertExtra | undefined;
    if (quakesOn && x && hideableQuake(x)) {
      quakesHidden++;
      return false;
    }
    if (liveDrawing && leftToLiveWarnings(x) && x?.nwsId && holds("alerts", liveAlertId(x.nwsId))) {
      leftToLive++;
      return false;
    }
    if (liveOn && isLiveSeverity(x)) keptFromLive++;
    return true;
  });
  return { features, quakesHidden, leftToLive, keptFromLive };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The operator note: what was fetched, and what was left to the overlapping layers or kept from them. */
export function hazardsNote(meta: AlertsEnvelope, s: Omit<SteppedAside, "features">, ctx: Partial<RefineContext> | undefined): string {
  const c = meta.counts ?? {};
  const notes: string[] = [];
  if (c.nws) {
    const liveOn = ctx?.layersOn?.alerts === true;
    const liveAnswering = ctx?.answering?.alerts === true;
    const them = (n: number) => (n === 1 ? "it" : "them");
    let why = "";
    if (liveOn && !liveAnswering) why = " · Live warnings has no answer on the map (failed or still loading), so its Severe/Extreme alerts stay here";
    else if (liveOn && c.nws.liveChecked === false) why = " · the live feed did not answer on the server, so no alert is left to Live warnings";
    notes.push(
      `NWS ${c.nws.alerts} alerts: ${c.nws.drawnAsPolygon} polygons, ${c.nws.drawnAsCounties} by county` +
        (c.nws.notDrawn ? `, ${c.nws.notDrawn} with no drawable area (marine/zone, no polygon published)` : "") +
        (s.leftToLive ? ` · ${count(s.leftToLive, "Severe/Extreme alert", "Severe/Extreme alerts")} left to Live warnings, which is drawing ${them(s.leftToLive)}` : "") +
        why +
        (liveOn && liveAnswering && s.keptFromLive
          ? ` · ${count(s.keptFromLive, "Severe/Extreme alert", "Severe/Extreme alerts")} drawn here because Live warnings is not drawing ${them(s.keptFromLive)}`
          : ""),
    );
  }
  if (c.gdacs) {
    const quakesOn = ctx?.layersOn?.earthquakes === true;
    const quakesAnswering = ctx?.answering?.earthquakes === true;
    const hidden = s.quakesHidden;
    notes.push(
      `GDACS ${c.gdacs.events} current events` +
        (c.gdacs.truncated ? " · GDACS list may be incomplete" : "") +
        (c.gdacs.failed?.length ? ` · GDACS ${c.gdacs.failed.join(", ")} unavailable` : "") +
        (hidden
          ? ` · ${count(hidden, "Green quake", "Green quakes")} hidden while the Earthquakes layer is on (the USGS 24 h feed has ${hidden === 1 ? "it" : "them"} within 100 km and 30 min)`
          : "") +
        (quakesOn && !quakesAnswering ? " · Earthquakes has no answer on the map, so no GDACS quake is hidden" : "") +
        (c.gdacs.usgsChecked ? "" : " · USGS feed unavailable, no GDACS quake hidden"),
    );
  }
  if (c.eonet) notes.push(`EONET ${c.eonet.volcanoes} volcanoes`);
  if (meta.failed?.length) notes.push(`down: ${meta.failed.join(", ")}`);
  return notes.join(" · ");
}

async function fetchHazards(ctx: FetchContext): Promise<FetchResult> {
  const env = await proxy<FeatureCollection>("/api/hazards?op=alerts", ctx);
  const raw = env as unknown as AlertsEnvelope;
  const envelope: AlertsEnvelope = { counts: raw.counts, failed: raw.failed };
  const features = env.data.features as unknown as LayerFeature[];
  const sources = ["NWS", "GDACS", "EONET"].filter((s) => !envelope.failed?.includes(s));
  // Everything fetched; refineHazards decides what is drawn.
  return {
    collection: { type: "FeatureCollection", features },
    source: sources.join(" + ") || "none",
    fetchedAt: ctx.now,
    note: hazardsNote(envelope, { quakesHidden: 0, leftToLive: 0, keptFromLive: 0 }, undefined),
    meta: { count: features.length, envelope },
  };
}

/** Step aside on the data in hand; the host re-runs it when Earthquakes or Live warnings changes. */
export function refineHazards(r: FetchResult, ctx: RefineContext): FetchResult {
  const envelope = (r.meta?.envelope ?? {}) as AlertsEnvelope;
  const { features, ...stepped } = stepAside(r.collection.features, ctx);
  return {
    ...r,
    collection: { type: "FeatureCollection", features },
    note: hazardsNote(envelope, stepped, ctx),
    meta: { ...r.meta, count: features.length },
  };
}

export const hazardsLayer: LayerDefinition = {
  id: "hazards",
  label: "Hazard alerts",
  description:
    "Active NWS watches, warnings and advisories, every GDACS event marked current (floods, cyclones, droughts, volcanoes, wildfires, earthquakes) and NASA EONET open volcano events, each with the severity its publisher gives. Unrated events are marked as such, never as calm. A Severe or Extreme NWS alert is left to Live warnings only while that layer is on and drawing it; one it could not outline stays here.",
  color: "#FF9A3D",
  updateIntervalMs: 3 * 60_000,
  defaultEnabled: false,
  // What is left to another layer depends on what Earthquakes and Live warnings are drawing.
  dependsOn: ["earthquakes", "alerts"],
  attribution: "NWS (public domain) · GDACS, EC-JRC (CC BY 4.0) · NASA EONET · TIGERweb",
  fetch: fetchHazards,
  refine: refineHazards,
};
