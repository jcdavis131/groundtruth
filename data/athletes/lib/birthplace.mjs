// Rule A5a (Cam 2026-10-19, "go ahead with A5a"): a birthplace is joined by ids, never by its name.
// apps/map/docs/PEOPLE.md, Athletes, has the rule. The audit behind it measured 4,894 Wikidata NBA
// birthplaces and found neighbourhoods, a hospital, states and countries, and labels such as Portland,
// Paris, Columbus and Rome that each name three places.
//
// From the player's place of birth (P19) QID:
//   1. If the place's own external ids match exactly one place record, and Wikidata classes it under human
//      settlement (Q486972), it is the birth city. US: a Census Gazetteer place, by FIPS 55-3 (P774, as the
//      7-digit state+place GEOID) or GNIS (P590, as ANSICODE). Elsewhere: a GeoNames (P1566) populated place
//      that is not a section of one (PPLX), historical, abandoned or destroyed.
//   2. If they match none and Wikidata classes it finer than a city (neighbourhood, quarter, hospital,
//      borough of New York City), walk "located in" (P131) up one level, when there is exactly one parent,
//      and try again, at most MAX_WALK levels.
//   3. Anything else is left out, and the reason is counted.
//
// No label decides a match. A label is only what gets shown once the ids agree.

export const MAX_WALK = 4;

export const OUTCOMES = {
  "matched-direct": "P19 itself is a settlement whose external id matches one place record",
  "matched-after-walk": "P19 is finer than a city; P131 led to one settlement whose external id matches one place record",
  "dropped-multiple-p19": "the player item has more than one place of birth",
  "dropped-multiple-parents": "a finer-than-city level has more than one P131 parent",
  "dropped-no-parent": "a finer-than-city level has no P131 parent",
  "dropped-coarser": "the walk reached a state, country, county or other non-settlement before a matching settlement",
  "dropped-not-settlement-by-p31": "an external id matches a place record but Wikidata does not class the item as a human settlement",
  "dropped-ambiguous-record": "the item's external ids match more than one place record",
  "dropped-no-external-id-match": "a settlement whose external ids match no place record (US: Census Gazetteer places; elsewhere: GeoNames cities500)",
  "dropped-country-mismatch": "the matched place record is in a different country than the item's P17",
  "dropped-no-label": "the settlement has no English or default (mul) label to show",
  "dropped-walk-too-deep": `no settlement within ${MAX_WALK} P131 levels`,
  "dropped-no-place-data": "Wikidata returned nothing for the place item",
};

/** A FIPS 55-3 value (3651000, 06-44000) as the Gazetteer's 7-digit GEOID, or null. */
export function fipsToGeoid(v) {
  const d = String(v).replace(/[^0-9]/g, "");
  return d.length === 7 ? d : null;
}

/** A GNIS feature id as the Gazetteer's zero-padded 8-digit ANSICODE, or null. */
export function gnisToAnsi(v) {
  const d = String(v).replace(/[^0-9]/g, "");
  return d.length > 0 && d.length <= 8 ? d.padStart(8, "0") : null;
}

const isUs = (node) => node.iso.includes("US") || (node.iso.length === 0 && (node.fips.length > 0 || node.gnis.length > 0));

/**
 * The distinct place records an item's external ids point at, each as {rec, via}.
 * `places` is {gazByGeoid: Map, gazByAnsi: Map, geonames: Map}; every record has .placeId.
 */
export function placeMatches(node, places) {
  const found = new Map();
  const add = (rec, via) => {
    if (rec && !found.has(rec.placeId)) found.set(rec.placeId, { rec, via });
  };
  if (isUs(node)) {
    for (const f of node.fips) add(fipsToGeoid(f) && places.gazByGeoid.get(fipsToGeoid(f)), `fips:${f}`);
    for (const g of node.gnis) add(gnisToAnsi(g) && places.gazByAnsi.get(gnisToAnsi(g)), `gnis:${g}`);
  } else {
    for (const id of node.geonames) add(places.geonames.get(String(id)), `geonames:${id}`);
  }
  return [...found.values()];
}

/**
 * Resolve one player's P19 values against the place graph. `graph` maps QID -> {qid, label, settle, finer,
 * coarse, parents[], fips[], gnis[], geonames[], iso[]}. Returns {outcome, path} and, on a match,
 * {settlement, placeId, via, rec}. `path` lists every QID visited, P19 first.
 */
export function resolveBirthplace(p19s, graph, places) {
  if (p19s.length > 1) return { outcome: "dropped-multiple-p19", path: [...p19s] };
  const path = [];
  let q = p19s[0];
  for (let depth = 0; depth <= MAX_WALK; depth++) {
    path.push(q);
    const node = graph.get(q);
    if (!node) return { outcome: "dropped-no-place-data", path };
    const m = placeMatches(node, places);
    if (m.length > 1) return { outcome: "dropped-ambiguous-record", path };
    if (m.length === 1) {
      if (!node.settle) return { outcome: "dropped-not-settlement-by-p31", path };
      const { rec, via } = m[0];
      if (node.iso.length > 0 && !node.iso.includes(rec.cc)) return { outcome: "dropped-country-mismatch", path };
      if (!node.label) return { outcome: "dropped-no-label", path };
      return { outcome: depth === 0 ? "matched-direct" : "matched-after-walk", path, settlement: q, placeId: rec.placeId, via, rec };
    }
    if (node.finer) {
      if (node.parents.length === 0) return { outcome: "dropped-no-parent", path };
      if (node.parents.length > 1) return { outcome: "dropped-multiple-parents", path };
      q = node.parents[0];
      continue;
    }
    if (node.coarse || !node.settle) return { outcome: "dropped-coarser", path };
    return { outcome: "dropped-no-external-id-match", path };
  }
  return { outcome: "dropped-walk-too-deep", path };
}

/**
 * Rule A5a's trace check for one shipped record: problems as strings, empty when the record's birthCity
 * traces from its P19 QID through P131 to a settlement whose external id is the place record's id.
 * `trace` is the athlete's line in birth-trace.jsonl: {id, p19, path, settlement, placeId, via}.
 */
export function traceProblems(record, trace, graph, places) {
  if (!("birthCity" in record)) return [];
  if (!trace) return ["birthCity shipped with no trace"];
  const out = [];
  const wd = record.sources.find((s) => s.sourceId === "wikidata" && s.fields.includes("birthCity"));
  if (!wd) out.push("no wikidata source cites birthCity");
  else if (wd.upstreamId !== trace.p19) out.push(`the wikidata citation names ${wd.upstreamId}, the trace starts at ${trace.p19}`);
  if (trace.path[0] !== trace.p19) out.push("the trace does not start at P19");
  if (trace.path[trace.path.length - 1] !== trace.settlement) out.push("the trace does not end at the settlement");
  for (let i = 1; i < trace.path.length; i++) {
    const prev = graph.get(trace.path[i - 1]);
    if (!prev || !prev.parents.includes(trace.path[i])) out.push(`${trace.path[i - 1]} is not located in (P131) ${trace.path[i]}`);
    else if (prev.parents.length !== 1) out.push(`${trace.path[i - 1]} has more than one P131 parent`);
    else if (!prev.finer) out.push(`${trace.path[i - 1]} is not finer than a city, so it should not have been walked`);
    else if (placeMatches(prev, places).length) out.push(`${trace.path[i - 1]} matches a place record itself, so it should not have been walked`);
  }
  const node = graph.get(trace.settlement);
  if (!node) out.push(`no graph entry for ${trace.settlement}`);
  else {
    if (!node.settle) out.push(`${trace.settlement} is not a human settlement by P31`);
    const m = placeMatches(node, places);
    if (m.length !== 1) out.push(`${trace.settlement}'s external ids match ${m.length} place records`);
    else if (m[0].rec.placeId !== trace.placeId) out.push(`${trace.settlement}'s external id points at ${m[0].rec.placeId}, the trace says ${trace.placeId}`);
    if (node.label !== record.birthCity) out.push(`birthCity ${JSON.stringify(record.birthCity)} is not ${trace.settlement}'s label`);
  }
  const place = record.sources.find((s) => (s.sourceId === "census-gazetteer" || s.sourceId === "geonames") && s.fields.includes("birthCity"));
  if (!place) out.push("no place-record source cites birthCity");
  else if (`${place.sourceId === "geonames" ? "geonames" : "census-place"}:${place.upstreamId}` !== trace.placeId)
    out.push(`the place citation names ${place.sourceId} ${place.upstreamId}, the trace says ${trace.placeId}`);
  return out;
}
