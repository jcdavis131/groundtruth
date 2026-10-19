// Transport-agency camera lists, normalised to one shape. Only agencies whose
// published terms allow reuse are here, each with the terms it was added
// under (read 2026-09-26; README "Data sources and attribution"):
//
//   caltrans   Caltrans CWWP2 CCTV status files, 12 districts. CWWP2: "These
//              files are available for integration into your application ...
//              There is no charge for the use of this data"; Caltrans
//              Conditions of Use: information "is considered in the public
//              domain. It may be distributed or copied as permitted by law."
//   drivebc    DriveBC HighwayCams (BC Data Catalogue, bc-highwaycams), under
//              the Open Government Licence - British Columbia. Attribution:
//              "Contains information licensed under the Open Government
//              Licence – British Columbia."
//   digitraffic Fintraffic road weather cameras, CC BY 4.0 ("Fintraffic /
//              digitraffic.fi").
//   lta        Land Transport Authority traffic images on data.gov.sg, under
//              the Singapore Open Data Licence version 1.0.
//
// Left out after reading their terms: TxDOT (its website disclaimer grants no
// reuse and its GIS data "was produced for internal use"; the ITS camera feed
// publishes no terms) and Rijkswaterstaat (api.rwsverkeersinfo.nl is the
// website's own backend with no published terms, and its cameras are INMOVES
// video embeds with no still image).
//
// A camera's position is the agency's. None of these publishes where a camera
// points in a way this app can draw (DriveBC and Caltrans publish a compass word
// for the view or the road direction), so the word is shown as published and no
// view cone is drawn. Pure: parsing only, tested on captured payloads.

import { parseCsv } from "@/lib/economy/csv";

export interface AgencyCam {
  id: string;
  name: string;
  lat: number;
  lon: number;
  imageUrl?: string;
  videoUrl?: string;
  pageUrl?: string;
  available?: boolean;
  /** A published compass word for the view or the road ("N", "South"); never drawn. */
  facing?: string;
  area?: string;
  road?: string;
  caption?: string;
  /** A credit the agency publishes with the camera (DriveBC). */
  credit?: string;
  /** When the agency last updated the record or image, ISO. */
  updated?: string;
}

const text = (v: unknown) => (v == null || String(v).trim() === "" ? undefined : String(v).trim());
function coord(v: unknown): number | undefined {
  const s = text(v);
  if (s == null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
function valid(lat: number | undefined, lon: number | undefined): boolean {
  return lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}
/** Only https images: the page upgrades http, and a host without TLS would draw a broken image. */
function https(u: string | undefined): string | undefined {
  return u && /^https:\/\//i.test(u) ? u : undefined;
}

// ---------------------------------------------------------------- Caltrans CWWP2

export const CALTRANS_DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const caltransUrl = (d: number) => `https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${String(d).padStart(2, "0")}.json`;

interface CwwpCctv {
  index?: string;
  recordTimestamp?: { recordDate?: string; recordTime?: string; recordEpoch?: string };
  location?: { district?: string; locationName?: string; nearbyPlace?: string; longitude?: string; latitude?: string; direction?: string; route?: string };
  inService?: string;
  imageData?: { streamingVideoURL?: string; static?: { currentImageURL?: string } };
}

export function parseCaltrans(j: { data?: Array<{ cctv?: CwwpCctv }> }): AgencyCam[] {
  const out: AgencyCam[] = [];
  for (const row of j.data ?? []) {
    const c = row.cctv;
    const loc = c?.location;
    const lat = coord(loc?.latitude);
    const lon = coord(loc?.longitude);
    if (!c || !loc || !valid(lat, lon)) continue;
    const district = text(loc.district);
    const index = text(c.index);
    if (!district || !index) continue;
    const epoch = coord(c.recordTimestamp?.recordEpoch);
    out.push({
      id: `d${district}-${index}`,
      name: text(loc.locationName) ?? `Caltrans camera ${index}`,
      lat: lat!,
      lon: lon!,
      imageUrl: https(text(c.imageData?.static?.currentImageURL)),
      videoUrl: https(text(c.imageData?.streamingVideoURL)),
      available: c.inService === "true" ? true : c.inService === "false" ? false : undefined,
      facing: text(loc.direction),
      // CWWP2's county field is unreliable (a District 7 camera reads "Alameda"), so it is not shown.
      area: [text(loc.nearbyPlace), `Caltrans District ${district}`].filter(Boolean).join(", "),
      road: text(loc.route),
      updated: epoch != null ? new Date(epoch * 1000).toISOString() : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------- DriveBC (OGL-BC)

export const DRIVEBC_CSV =
  "https://catalogue.data.gov.bc.ca/dataset/6b39a910-6c77-476f-ac96-7b4f18849b1c/resource/a9d52d85-8402-4ce7-b2ac-a2779837c48a/download/webcams.csv";
/**
 * DriveBC's own current image for a camera id. The dataset's images.drivebc.ca
 * address reset every connection from the machine this was built on
 * (2026-09-26); DriveBC's site serves the same camera ids here.
 */
export const drivebcImage = (id: string) => `https://www.drivebc.ca/images/${encodeURIComponent(id)}.jpg`;

export function parseDriveBc(csvText: string): AgencyCam[] {
  const rows = parseCsv(csvText);
  const header = rows[0]?.map((h) => h.trim()) ?? [];
  const col = (n: string) => header.indexOf(n);
  const ci = {
    id: col("id"),
    page: col("links_bchighwaycam"),
    hwy: col("highway_number"),
    where: col("highway_locationDescription"),
    name: col("camName"),
    caption: col("caption"),
    credit: col("credit"),
    orientation: col("orientation"),
    lat: col("latitude"),
    lon: col("longitude"),
  };
  if (ci.id < 0 || ci.lat < 0 || ci.lon < 0) throw new Error("DriveBC HighwayCams: unexpected CSV header");
  const out: AgencyCam[] = [];
  for (const r of rows.slice(1)) {
    const id = text(r[ci.id]);
    const lat = coord(r[ci.lat]);
    const lon = coord(r[ci.lon]);
    if (!id || !valid(lat, lon)) continue;
    const hwy = text(r[ci.hwy]);
    out.push({
      id,
      name: text(r[ci.name]) ?? `DriveBC camera ${id}`,
      lat: lat!,
      lon: lon!,
      imageUrl: drivebcImage(id),
      pageUrl: https(text(r[ci.page])),
      facing: text(r[ci.orientation]),
      road: hwy ? `Highway ${hwy}` : undefined,
      area: text(r[ci.where]),
      caption: text(r[ci.caption]),
      credit: ci.credit >= 0 ? text(r[ci.credit]) : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Digitraffic weather cameras (CC BY 4.0)

export const DIGITRAFFIC_STATIONS = "https://tie.digitraffic.fi/api/weathercam/v1/stations";
export const digitrafficImage = (presetId: string) => `https://weathercam.digitraffic.fi/${encodeURIComponent(presetId)}.jpg`;

interface DigiStation {
  id?: string;
  geometry?: { type?: string; coordinates?: number[] };
  properties?: { id?: string; name?: string; collectionStatus?: string; dataUpdatedTime?: string; presets?: Array<{ id?: string; inCollection?: boolean }> };
}

export function parseDigitraffic(j: { features?: DigiStation[] }): AgencyCam[] {
  const out: AgencyCam[] = [];
  for (const f of j.features ?? []) {
    const p = f.properties;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const id = text(p?.id ?? f.id);
    if (!p || !id || !valid(lat, lon)) continue;
    const presets = (p.presets ?? []).filter((x) => x.inCollection && text(x.id));
    const first = presets[0]?.id;
    out.push({
      id,
      // Fintraffic's station names read "<road>_<place>" (kt51_Inkoo).
      name: text(p.name)?.replace(/_/g, " ") ?? `Weather camera ${id}`,
      lat: lat!,
      lon: lon!,
      imageUrl: first ? digitrafficImage(first) : undefined,
      available: p.collectionStatus === "GATHERING" ? true : p.collectionStatus ? false : undefined,
      area: presets.length > 1 ? `${presets.length} camera views at this station (the first is shown)` : undefined,
      updated: text(p.dataUpdatedTime),
    });
  }
  return out;
}

// ---------------------------------------------------------------- LTA traffic images (Singapore Open Data Licence)

export const LTA_IMAGES = "https://api.data.gov.sg/v1/transport/traffic-images";

interface LtaCam {
  camera_id?: string;
  image?: string;
  timestamp?: string;
  location?: { latitude?: number; longitude?: number };
}

export function parseLta(j: { items?: Array<{ timestamp?: string; cameras?: LtaCam[] }> }): AgencyCam[] {
  const out: AgencyCam[] = [];
  for (const c of j.items?.[0]?.cameras ?? []) {
    const id = text(c.camera_id);
    const lat = c.location?.latitude;
    const lon = c.location?.longitude;
    if (!id || !valid(lat, lon)) continue;
    out.push({
      id,
      // The API publishes a camera id and no name.
      name: `LTA traffic camera ${id}`,
      lat: lat!,
      lon: lon!,
      imageUrl: https(text(c.image)),
      updated: text(c.timestamp),
    });
  }
  return out;
}

/** The image hosts these adapters hand to the browser (the CSP test checks img-src allows each). */
export const CAMERA_IMAGE_HOSTS = ["cwwp2.dot.ca.gov", "www.drivebc.ca", "weathercam.digitraffic.fi", "images.data.gov.sg"] as const;
