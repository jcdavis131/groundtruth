// WGS84 <-> UTM (Transverse Mercator, Snyder 1987 series). Sentinel-2 COGs are
// stored in UTM zones (EPSG 326xx north / 327xx south); this converts between
// the globe's lon/lat and a COG's pixel grid without a projection library.

const A = 6378137.0;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const DEG = Math.PI / 180;

export interface UtmZone {
  zone: number;
  north: boolean;
}

/** EPSG 32601..32660 north, 32701..32760 south. */
export function zoneFromEpsg(epsg: number): UtmZone | null {
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, north: true };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, north: false };
  return null;
}

export function lonLatToUtm(lon: number, lat: number, z: UtmZone): [easting: number, northing: number] {
  const lon0 = ((z.zone - 1) * 6 - 180 + 3) * DEG;
  const φ = lat * DEG;
  const λ = lon * DEG - lon0;
  const sinφ = Math.sin(φ);
  const cosφ = Math.cos(φ);
  const tanφ = Math.tan(φ);
  const N = A / Math.sqrt(1 - E2 * sinφ * sinφ);
  const T = tanφ * tanφ;
  const C = EP2 * cosφ * cosφ;
  const Aa = λ * cosφ;
  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256) * φ -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 * E2 * E2) / 1024) * Math.sin(2 * φ) +
      ((15 * E2 * E2) / 256 + (45 * E2 * E2 * E2) / 1024) * Math.sin(4 * φ) -
      ((35 * E2 * E2 * E2) / 3072) * Math.sin(6 * φ));
  const x =
    K0 *
      N *
      (Aa +
        ((1 - T + C) * Aa ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5) / 120) +
    500000;
  let y =
    K0 *
    (M +
      N *
        tanφ *
        (Aa ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6) / 720));
  if (!z.north) y += 10000000;
  return [x, y];
}

export function utmToLonLat(easting: number, northing: number, z: UtmZone): [lon: number, lat: number] {
  const lon0 = ((z.zone - 1) * 6 - 180 + 3) * DEG;
  const x = easting - 500000;
  const y = z.north ? northing : northing - 10000000;
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256));
  const φ1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const tanφ1 = Math.tan(φ1);
  const N1 = A / Math.sqrt(1 - E2 * sinφ1 * sinφ1);
  const T1 = tanφ1 * tanφ1;
  const C1 = EP2 * cosφ1 * cosφ1;
  const R1 = (A * (1 - E2)) / Math.pow(1 - E2 * sinφ1 * sinφ1, 1.5);
  const D = x / (N1 * K0);
  const φ =
    φ1 -
    ((N1 * tanφ1) / R1) *
      (D * D / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const λ =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) /
      cosφ1;
  return [λ / DEG, φ / DEG];
}
