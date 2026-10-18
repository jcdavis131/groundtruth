// Provenance builders for the water sources. Pure and browser-safe: the
// route handlers and the report builder both call these with what they know
// (USGS collection, site, parameter codes, the latest observation time) so the
// same record is spelled the same way in the API envelope and the HUD.

import { provenance, type Provenance } from "@/lib/provenance/types";
import { source, type SourceId } from "@/lib/provenance/sources";

export const USGS_OGC = "https://api.waterdata.usgs.gov/ogcapi/v0/collections";

export type UsgsCollection = "latest-continuous" | "latest-daily" | "daily" | "continuous" | "monitoring-locations";

export interface UsgsProvenanceOpts {
  collection: UsgsCollection;
  /** Monitoring location id ("USGS-08180800") when the call was for one site. */
  site?: string;
  /** Parameter codes the call asked for. */
  params?: string[];
  /** ISO time or "from/to" range the values describe. */
  period?: string;
  /** Latest approval flag seen ("Provisional", "Approved"). */
  approval?: string;
  retrievedAt: string;
  notes?: string[];
}

/** USGS Water Data OGC API. seriesId is "site:param" for one site, else the collection plus parameter list. */
export function usgsProvenance(o: UsgsProvenanceOpts): Provenance {
  const params = o.params?.length ? o.params.join(",") : undefined;
  const seriesId = o.site ? `${o.site}:${params ?? "*"}` : params ? `${o.collection} ${params}` : o.collection;
  const upstreamUrl = o.site
    ? `${USGS_OGC}/${o.collection}/items?f=json&monitoring_location_id=${encodeURIComponent(o.site)}${params ? `&parameter_code=${params}` : ""}`
    : `${USGS_OGC}/${o.collection}/items`;
  const notes = [...(o.notes ?? [])];
  if (o.site) notes.push(`Site page: https://waterdata.usgs.gov/monitoring-location/${o.site.replace("USGS-", "")}/`);
  return provenance(source("usgs-water"), {
    kind: "published",
    seriesId,
    upstreamUrl,
    period: o.period,
    retrievedAt: o.retrievedAt,
    revision: o.approval ?? "provisional until USGS approves; approved values can differ",
    notes: notes.length ? notes : undefined,
  });
}

/** NOAA NWPS gauge list with flood categories. `validTime` is the newest observation in the set. */
export function nwpsProvenance(retrievedAt: string, validTime?: string | null, lid?: string): Provenance {
  return provenance(source("noaa-nwps"), {
    kind: "published",
    seriesId: lid ?? "nwps/v1/gauges",
    upstreamUrl: lid ? `https://water.noaa.gov/gauges/${lid}` : "https://api.water.noaa.gov/nwps/v1/gauges",
    period: validTime ?? undefined,
    retrievedAt,
    notes: ["Flood categories are the NWS thresholds for that gauge; the observed stage comes from the co-located USGS or partner sensor."],
  });
}

/** TWDB reservoir conditions; `date` is the newest reservoir timestamp in the set. */
export function twdbProvenance(date: string | null | undefined, retrievedAt: string, reservoir?: string): Provenance {
  return provenance(source("twdb"), {
    kind: "published",
    seriesId: reservoir ?? "recent-conditions.json",
    upstreamUrl: reservoir ? `https://www.waterdatafortexas.org/reservoirs/individual/${reservoir}` : "https://www.waterdatafortexas.org/reservoirs/recent-conditions.json",
    period: date ? date.slice(0, 10) : undefined,
    retrievedAt,
    notes: ["Percent full is of the conservation pool; flood pool storage is not counted."],
  });
}

/** US Drought Monitor current map. The ArcGIS layer we read carries only the class, so the valid week is named in notes rather than invented. */
export function usdmProvenance(retrievedAt: string, week?: string | null): Provenance {
  return provenance(source("usdm"), {
    kind: "published",
    seriesId: "USDM_current",
    upstreamUrl: "https://droughtmonitor.unl.edu/CurrentMap.aspx",
    period: week ?? undefined,
    retrievedAt,
    revision: "released Thursdays for the week ending the previous Tuesday",
    notes: week ? undefined : ["Valid week not carried by the feature service query; it is printed on the USDM map page."],
  });
}

/** Sentinel-2 L2A scene behind a turbidity estimate. */
export function sentinelProvenance(sceneId: string | null | undefined, datetime: string | null | undefined, retrievedAt: string): Provenance {
  return provenance(source("sentinel-2"), {
    kind: "published",
    seriesId: sceneId ?? undefined,
    period: datetime ? datetime.slice(0, 10) : undefined,
    retrievedAt,
  });
}

/** A number computed here from published readings, cited against the source it came from. */
export function waterEstimateProvenance(from: SourceId, method: string, retrievedAt: string, notes?: string[]): Provenance {
  return provenance(source(from), { kind: "estimate", method, retrievedAt, notes });
}
