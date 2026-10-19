// How the aircraft route snaps a point query (adsb.lol, ADS-B Exchange): the
// centre to a 0.1° grid and the radius up to 10 nm steps, so slightly
// different camera targets share one upstream request. The route asks the
// upstream with these numbers, and the area watch (lib/aoi/coverage.ts) reads
// them to know which circle an aircraft answer covers. Pure, no client or
// server imports, so both sides share it.

export interface PointQuery {
  lat: number;
  lon: number;
  /** Radius in nautical miles. */
  distNm: number;
}

/** The query the route sends upstream for `lat`, `lon` and `dist` (nm) as the client asked. */
export function snapPointQuery(lat: number, lon: number, dist: number): PointQuery {
  return {
    lat: Math.round(lat * 10) / 10,
    lon: Math.round(lon * 10) / 10,
    distNm: Math.min(250, Math.max(10, Math.ceil(dist / 10) * 10)),
  };
}
