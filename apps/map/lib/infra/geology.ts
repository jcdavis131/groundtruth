// The geologic map unit under a point, from Macrostrat's geologic_units/map
// API (CC BY 4.0). Asked without a scale, Macrostrat answers one unit per map
// scale it holds there, the most detailed first; the ground dossier shows
// that one in full and names the coarser ones. Every field is Macrostrat's;
// an empty name or lithology stays empty ("not named on this map"), and the
// map each unit comes from is cited from the answer's own `refs`.
//
// Pure: parsing only, tested on answers captured 2026-09-26.

export interface GeologyUnit {
  mapId?: number;
  name?: string;
  stratName?: string;
  lith?: string;
  description?: string;
  /** "Mesoproterozoic" or "Late Pleistocene to Ionian" (top to bottom interval names). */
  age?: string;
  /** Top and bottom ages, millions of years. */
  topMa?: number;
  bottomMa?: number;
  color?: string;
  /** The map the unit comes from, as Macrostrat cites it. */
  source?: string;
}

export interface GeologyAnswer {
  units: GeologyUnit[];
  license?: string;
}

const text = (v: unknown) => (v == null || String(v).trim() === "" ? undefined : String(v).replace(/\s+/g, " ").trim());
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function parseMacrostrat(j: unknown): GeologyAnswer {
  const s = (j as { success?: { data?: unknown[]; refs?: Record<string, string>; license?: string } } | null)?.success;
  if (!s || !Array.isArray(s.data)) throw new Error("Macrostrat: unexpected answer");
  const refs = s.refs ?? {};
  const units = s.data.map((raw): GeologyUnit => {
    const u = raw as Record<string, unknown>;
    const top = text(u.t_int_name);
    const bottom = text(u.b_int_name);
    return {
      mapId: num(u.map_id),
      name: text(u.name),
      stratName: text(u.strat_name),
      lith: text(u.lith),
      description: text(u.descrip),
      age: top && bottom ? (top === bottom ? top : `${top} to ${bottom}`) : top ?? bottom ?? text(u.best_int_name),
      topMa: num(u.t_age),
      bottomMa: num(u.b_age),
      color: typeof u.color === "string" && /^#[0-9a-f]{6}$/i.test(u.color) ? u.color : undefined,
      source: u.source_id != null ? text(refs[String(u.source_id)]) : undefined,
    };
  });
  return { units, license: text(s.license) };
}

/** "1,000 to 1,600 million years" / "0 to 2.6 million years". */
export function ageRange(u: GeologyUnit): string | undefined {
  if (u.topMa == null || u.bottomMa == null) return undefined;
  const f = (n: number) => (n >= 100 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 10) / 10));
  return `${f(u.topMa)} to ${f(u.bottomMa)} million years`;
}
