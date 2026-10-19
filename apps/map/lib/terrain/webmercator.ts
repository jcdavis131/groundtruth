// Web Mercator tile math and raster pixel helpers shared by the browser (the
// tiled-imagery hook, keyless terrain, the elevation profile) and the server
// (/api/terrain renders a tile by its projected box). Pure: no Cesium, no DOM.
//
//   tile box   EPSG:3857 metres of an XYZ tile (x right, y down, z = zoom),
//              the box an ArcGIS exportImage / WMS GetMap is asked to render
//   terrarium  AWS Terrain Tiles encode height as h = R·256 + G + B/256 − 32768 m
//              (Mapzen / Tilezen joerd "terrarium" format)

/** Half the Web Mercator world width in metres (π · WGS84 a). */
export const WM_HALF = Math.PI * 6_378_137;
/** Latitude where the square Web Mercator world ends. */
export const WM_MAX_LAT = 85.0511287798066;

/** Whole tiles only: z in [0, 24], x and y inside the level. */
export function validTile(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger)) return false;
  if (z < 0 || z > 24) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

/** [xmin, ymin, xmax, ymax] in EPSG:3857 metres for an XYZ tile. */
export function tileBbox3857(x: number, y: number, z: number): [number, number, number, number] {
  const size = (2 * WM_HALF) / 2 ** z;
  return [-WM_HALF + x * size, WM_HALF - (y + 1) * size, -WM_HALF + (x + 1) * size, WM_HALF - y * size];
}

/** The same box as a query-string value, rounded to the centimetre so every caller asks with the same text. */
export function bboxParam(x: number, y: number, z: number): string {
  return tileBbox3857(x, y, z)
    .map((v) => v.toFixed(2))
    .join(",");
}

/** [west, south, east, north] in degrees for an XYZ tile. */
export function tileBoundsDeg(x: number, y: number, z: number): [number, number, number, number] {
  const n = 2 ** z;
  const lon = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

/** Fractional tile coordinates of a lon/lat at zoom z (latitude clamped to the Mercator square). */
export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const la = Math.max(-WM_MAX_LAT, Math.min(WM_MAX_LAT, lat));
  const r = (la * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [fx, fy];
}

/** Ground size of one pixel of a `tileSize` tile at zoom z and latitude lat, metres. */
export function pixelMetres(z: number, lat: number, tileSize = 256): number {
  return ((2 * WM_HALF) / (tileSize * 2 ** z)) * Math.cos((lat * Math.PI) / 180);
}

// ---------------------------------------------------------------- terrarium

/** Height in metres of one terrarium pixel (Tilezen joerd "terrarium" encoding). */
export function terrariumHeight(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** RGBA pixels of a terrarium tile -> heights (row-major, north row first). */
export function decodeTerrarium(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = terrariumHeight(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  return out;
}

/**
 * Bilinear sample of a row-major grid at pixel coordinates (px, py), where
 * pixel i's centre is at i + 0.5. Outside the grid the edge value holds.
 */
export function bilinear(grid: ArrayLike<number>, width: number, height: number, px: number, py: number): number {
  const x = Math.max(0, Math.min(width - 1, px - 0.5));
  const y = Math.max(0, Math.min(height - 1, py - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = grid[y0 * width + x0];
  const b = grid[y0 * width + x1];
  const c = grid[y1 * width + x0];
  const d = grid[y1 * width + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// ---------------------------------------------------------------- line art

/**
 * Dark lines on a light, opaque background (USGS 3DEP's contour render is
 * black on #FDFDFD with no alpha) -> the same lines in `tint` on transparent,
 * so they read on a dark globe. Alpha follows darkness: a pixel as light as
 * `paper` or lighter disappears, pure black keeps the source alpha.
 * Mutates and returns `rgba`.
 */
export function inkToTint(rgba: Uint8ClampedArray | Uint8Array, tint: [number, number, number], paper = 250): Uint8ClampedArray | Uint8Array {
  for (let i = 0; i < rgba.length; i += 4) {
    const lum = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    const ink = lum >= paper ? 0 : (paper - lum) / paper;
    rgba[i] = tint[0];
    rgba[i + 1] = tint[1];
    rgba[i + 2] = tint[2];
    rgba[i + 3] = Math.round(rgba[i + 3] * Math.min(1, ink));
  }
  return rgba;
}

/**
 * A light, opaque hillshade (USGS's relief cache is JPEG: flat ground about
 * 252, open ocean a flat 244, shadows down to about 110) -> its shading alone,
 * black with alpha (255 − lum) / 255. Drawn over imagery that is a multiply by
 * the hillshade: lit, flat ground and the sea stay clear, slopes turned from
 * the sun darken what is under them. Mutates and returns `rgba`.
 */
export function shadeToAlpha(rgba: Uint8ClampedArray | Uint8Array): Uint8ClampedArray | Uint8Array {
  return inkToTint(rgba, [0, 0, 0], 255);
}

/** "#RRGGBB" -> [r, g, b]. */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
