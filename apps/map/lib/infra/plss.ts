// Township-Range-Section search for the ⌘K palette: "T12N R3W S33",
// "T12N R3W sec 33 OK", "12N 3W 33"… are parsed here into the fields BLM's
// National PLSS (CadNSDI) service indexes, and /api/infra?op=plss-search asks
// the service for the matching townships (layer 1) and, with a section, the
// section inside each (layer 2). A township and range repeat under every
// principal meridian, so a query without a state can match several places;
// each comes back with its meridian and state and the palette lists them.
//
// Pure: parsing and the where-clauses only, tested next to this file.

/** The 30 PLSS states plus the ones BLM's CadNSDI covers (Texas and the original colonies are not PLSS). */
export const PLSS_STATES: ReadonlySet<string> = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "FL", "ID", "IL", "IN", "IA", "KS", "LA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NM", "ND", "OH", "OK", "OR", "SD", "UT", "WA", "WI", "WY",
]);

export interface TrsQuery {
  township: number;
  townshipDir: "N" | "S";
  range: number;
  rangeDir: "E" | "W";
  section?: number;
  state?: string;
}

/**
 * Parse a T-R-S description. Accepts "T12N R3W S33", "T12N-R3W-S33", "T 12 N R 3 W Sec. 33",
 * "12N 3W 33" and a trailing two-letter PLSS state ("… OK"). Null for anything else, so an
 * ordinary search ("R2D2", "T-Mobile") never becomes a PLSS lookup.
 */
export function parseTrs(input: string): TrsQuery | null {
  const s = input.trim().toUpperCase().replace(/[,;]+/g, " ").replace(/\s+/g, " ");
  if (!s) return null;
  const m = s.match(
    /^(?:T(?:WP|OWNSHIP)?\.?\s*)?(\d{1,3})\s*([NS])[\s-]+(?:R(?:NG|ANGE)?\.?\s*)?(\d{1,3})\s*([EW])(?:[\s-]+(?:S(?:EC(?:TION)?)?\.?\s*)?(\d{1,2}))?(?:\s+([A-Z]{2}))?$/,
  );
  if (!m) return null;
  // Without the T and R letters, only the compact "12N 3W" form counts.
  const township = Number(m[1]);
  const range = Number(m[3]);
  const section = m[5] != null ? Number(m[5]) : undefined;
  if (!(township >= 1 && township <= 199 && range >= 1 && range <= 199)) return null;
  if (section != null && !(section >= 1 && section <= 36)) return null;
  const state = m[6];
  if (state && !PLSS_STATES.has(state)) return null;
  return { township, townshipDir: m[2] as "N" | "S", range, rangeDir: m[4] as "E" | "W", section, state };
}

const pad3 = (n: number) => String(n).padStart(3, "0");

/** The where-clause for CadNSDI layer 1 (PLSS Township). */
export function townshipWhere(q: TrsQuery): string {
  const parts = [
    `TWNSHPNO='${pad3(q.township)}'`,
    `TWNSHPDIR='${q.townshipDir}'`,
    `RANGENO='${pad3(q.range)}'`,
    `RANGEDIR='${q.rangeDir}'`,
  ];
  if (q.state) parts.push(`STATEABBR='${q.state}'`);
  return parts.join(" AND ");
}

/** PLSS ids are letters, digits and nothing else (e.g. OK170120N0040W0). */
export function safePlssId(id: string): boolean {
  return /^[A-Z]{2}[0-9A-Z]{8,20}$/.test(id);
}

/** The where-clause for CadNSDI layer 2 (PLSS Section): this section in these townships. */
export function sectionWhere(plssIds: string[], section: number): string {
  const ids = plssIds.filter(safePlssId).map((id) => `'${id}'`);
  return `PLSSID IN (${ids.join(",")}) AND FRSTDIVNO='${section}' AND FRSTDIVTXT='Section'`;
}

/** "T12N R3W", with the section when there is one. */
export function trsLabel(q: TrsQuery): string {
  return `T${q.township}${q.townshipDir} R${q.range}${q.rangeDir}${q.section != null ? ` S${q.section}` : ""}`;
}

/** One place a T-R-S description names: its meridian and state, and where it is. */
export interface PlssCandidate {
  /** "T12N R3W S33, Indian Meridian (OK)". */
  label: string;
  plssId: string;
  state?: string;
  meridian?: string;
  /** BLM's township label as published ("12N 3W", "12.5N 3W", "T12N R03W"). */
  townshipLabel?: string;
  section?: number;
  firstDivisionId?: string;
  bbox: [number, number, number, number];
  lon: number;
  lat: number;
}

type Row = { geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> };

/** [w, s, e, n] of a polygon geometry, or null. */
export function geometryBbox(g: GeoJSON.Geometry | null): [number, number, number, number] | null {
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    for (const [x, y] of poly[0] ?? []) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

const text = (v: unknown) => (v == null || String(v).trim() === "" ? undefined : String(v).trim());

/**
 * The places a query names. Without a section: every matching township. With one: the
 * section inside each township that has it (a township can lack a section number: a
 * fractional township on a boundary, or water), in the townships' order.
 */
export function plssCandidates(q: TrsQuery, townships: Row[], sections: Row[] | null, max = 30): PlssCandidate[] {
  const byId = new Map<string, Row>();
  for (const t of townships) {
    const id = text(t.properties.PLSSID);
    if (id && !byId.has(id)) byId.set(id, t);
  }
  const out: PlssCandidate[] = [];
  const push = (t: Row, geom: GeoJSON.Geometry | null, extra: Partial<PlssCandidate>) => {
    const b = geometryBbox(geom);
    const id = text(t.properties.PLSSID);
    if (!b || !id) return;
    const state = text(t.properties.STATEABBR);
    const meridian = text(t.properties.PRINMER);
    out.push({
      label: `${trsLabel({ ...q, section: extra.section })}${meridian ? `, ${meridian}` : ""}${state ? ` (${state})` : ""}`,
      plssId: id,
      state,
      meridian,
      townshipLabel: text(t.properties.TWNSHPLAB),
      bbox: b,
      lon: (b[0] + b[2]) / 2,
      lat: (b[1] + b[3]) / 2,
      ...extra,
    });
  };
  if (q.section == null || !sections) {
    for (const t of byId.values()) push(t, t.geometry, {});
  } else {
    const seen = new Set<string>();
    for (const s of sections) {
      const id = text(s.properties.PLSSID);
      const t = id ? byId.get(id) : undefined;
      const fid = text(s.properties.FRSTDIVID);
      if (!t || !fid || seen.has(fid)) continue;
      seen.add(fid);
      push(t, s.geometry, { section: q.section, firstDivisionId: fid });
    }
  }
  out.sort((a, b) => (a.state ?? "").localeCompare(b.state ?? "") || (a.meridian ?? "").localeCompare(b.meridian ?? "") || a.plssId.localeCompare(b.plssId));
  return out.slice(0, max);
}
