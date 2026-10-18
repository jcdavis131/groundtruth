// Web Worker: SGP4-propagates every loaded satellite to a requested instant
// and posts back a packed [lon, lat, alt] array. Keeps the main thread free
// even with CelesTrak's full "active" catalogue (~11k objects).

import {
  json2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  type SatRec,
  type OMMJsonObject,
} from "../vendor/satellite";

export interface SatLoadMessage {
  type: "load";
  sats: Array<{ id: string; omm: OMMJsonObject }>;
}
export interface SatTickMessage {
  type: "tick";
  t: number;
}
export interface SatLoadedMessage {
  type: "loaded";
  count: number;
}
export interface SatPosMessage {
  type: "pos";
  t: number;
  ids: string[];
  /** 3 doubles per id: lon°, lat°, altitude m */
  data: Float64Array;
}
export type SatWorkerIn = SatLoadMessage | SatTickMessage;
export type SatWorkerOut = SatLoadedMessage | SatPosMessage;

const recs: Array<{ id: string; rec: SatRec }> = [];

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SatWorkerIn>) => void) | null;
  postMessage: (msg: SatWorkerOut, transfer?: Transferable[]) => void;
};

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === "load") {
    recs.length = 0;
    for (const s of m.sats) {
      try {
        recs.push({ id: s.id, rec: json2satrec(s.omm) });
      } catch {
        /* malformed element set: skip */
      }
    }
    ctx.postMessage({ type: "loaded", count: recs.length });
    return;
  }
  if (m.type === "tick") {
    const date = new Date(m.t);
    const gmst = gstime(date);
    const ids: string[] = [];
    const data = new Float64Array(recs.length * 3);
    let n = 0;
    for (const { id, rec } of recs) {
      const pv = propagate(rec, date);
      if (!pv || !pv.position) continue;
      const g = eciToGeodetic(pv.position, gmst);
      const lon = degreesLong(g.longitude);
      const lat = degreesLat(g.latitude);
      const alt = g.height * 1000;
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(alt)) continue;
      data[n * 3] = lon;
      data[n * 3 + 1] = lat;
      data[n * 3 + 2] = alt;
      ids.push(id);
      n++;
    }
    const out = data.slice(0, n * 3);
    ctx.postMessage({ type: "pos", t: m.t, ids, data: out }, [out.buffer]);
  }
};
