// A per-reply coverage status, set only where eye can state it from fields it
// already sends. Today that is "partial", with one { code, text } basis line per
// reason (the code is one of ABSENCE_CODES, so an agent reads the same words here as in
// world_context's missing[]):
//   - the route's own export names places whose value is unknown (data.nullPlaces,
//     data.nullCells: the mask=0 rule, null not 0); the code comes from the route's own
//     reason code for them (ROUTE_REASON_CODE),
//   - the route says its list was cut at its own record limit (data.truncated: true,
//     cut_by_route_limit),
//   - the route lists upstreams that failed (data.failed[] or failed[], failed),
//   - the route says it loaded a box (meta.bbox) smaller than the box asked (not_loaded), and
//   - the MCP itself cut a list to fit (boundPayload, cut_by_byte_cap).
// There is no "complete" and no blanket "unknown": a reply without coverageStatus makes no
// coverage claim, and its caveats and provenance still say what it covers. The key is
// coverageStatus, not coverage, because some routes already send their own `coverage` array.
//
// The rule ("missing coverage is unknown, not absence") follows morluto/rea
// docs/tool-design.md (MIT, (c) 2026 morluto); no text or code copied.
//
// Relative imports only (see ./tools.ts for why).

import { codeForRouteEntry, type AbsenceCode, type BasisLine } from "./absence";

export interface CoverageStatus {
  status: "partial";
  /** One line per reason, naming the field it was read from. */
  basis: BasisLine[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The places in data.nullPlaces / data.nullCells, grouped by the code their own reason maps to. */
function groupByCode(v: unknown, reasonOf: (x: unknown) => unknown): Map<AbsenceCode, number> {
  const out = new Map<AbsenceCode, number>();
  if (!isObj(v)) return out;
  for (const x of Object.values(v)) {
    const code = codeForRouteEntry({ reason: reasonOf(x) });
    out.set(code, (out.get(code) ?? 0) + 1);
  }
  return out;
}

/** A nullCells entry is { field: reason }; its code is the first field's reason (they share one in the routes today). */
function firstReason(cell: unknown): unknown {
  return isObj(cell) ? Object.values(cell).find((x) => typeof x === "string") : undefined;
}

/** [w, s, e, n] from a "w,s,e,n" query value in a path, or null. */
function askedBbox(path: string | undefined): number[] | null {
  const m = /[?&]bbox=([^&]+)/.exec(path ?? "");
  if (!m) return null;
  const nums = decodeURIComponent(m[1]).split(",").map(Number);
  return nums.length === 4 && nums.every(Number.isFinite) ? nums : null;
}

const EPS = 1e-6;

/** True when `got` leaves out part of `asked` (both [w, s, e, n]). */
function smallerThan(got: unknown, asked: number[]): got is number[] {
  if (!Array.isArray(got) || got.length !== 4 || !got.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  return got[0] > asked[0] + EPS || got[1] > asked[1] + EPS || got[2] < asked[2] - EPS || got[3] < asked[3] - EPS;
}

/**
 * The coverage status for one reply payload, or null when nothing in it says.
 * `path` is the route path with its query, so the box that was asked can be compared with meta.bbox.
 */
export function replyCoverage(payload: Record<string, unknown>, truncatedByMcp: boolean, path?: string): CoverageStatus | null {
  const basis: BasisLine[] = [];
  const line = (code: AbsenceCode, text: string) => basis.push({ code, text });
  const data = isObj(payload.data) ? payload.data : null;
  if (data) {
    for (const [code, n] of groupByCode(data.nullPlaces, (x) => x)) line(code, `${n} place${n === 1 ? " in data.nullPlaces has" : "s in data.nullPlaces have"} an unknown value (null, not 0)`);
    for (const [code, n] of groupByCode(data.nullCells, firstReason)) line(code, `${n} place${n === 1 ? " in data.nullCells has" : "s in data.nullCells have"} at least one null field (null, not 0)`);
    if (data.truncated === true) line("cut_by_route_limit", "the route says data.truncated is true: it stopped at its own record limit, so the list is a floor");
  }
  const failed = (Array.isArray(data?.failed) ? (data!.failed as unknown[]).length : 0) + (Array.isArray(payload.failed) ? (payload.failed as unknown[]).length : 0);
  if (failed) line("failed", `${failed} upstream${failed === 1 ? "" : "s"} listed in failed[] did not answer on this call`);
  const asked = askedBbox(path);
  const meta = isObj(payload.meta) ? payload.meta : null;
  if (asked && meta && smallerThan(meta.bbox, asked)) {
    line("not_loaded", `meta.bbox [${(meta.bbox as number[]).join(",")}] is smaller than the box asked [${asked.join(",")}]: the part outside it was not loaded`);
  }
  if (truncatedByMcp) line("cut_by_byte_cap", "the MCP cut the list to fit one reply (see note); the HTTP route has the full set");
  return basis.length ? { status: "partial", basis } : null;
}
