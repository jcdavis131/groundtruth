// A per-reply coverage status, set only where eye can state it from fields it
// already sends. Today that is "partial" in two cases:
//   - the route's own export names places whose value is unknown
//     (data.nullPlaces, data.nullCells: the mask=0 rule, null not 0), and
//   - the MCP itself cut a list to fit (boundPayload).
// There is no "complete" and no blanket "unknown": a reply without
// coverageStatus makes no coverage claim, and its caveats and provenance
// still say what it covers. The key is coverageStatus, not coverage, because
// some routes already send their own `coverage` array.
//
// The rule ("missing coverage is unknown, not absence") follows morluto/rea
// docs/tool-design.md (MIT, (c) 2026 morluto); no text or code copied.
//
// Relative imports only (see ./tools.ts for why).

export interface CoverageStatus {
  status: "partial";
  /** One line per reason, naming the field it was read from. */
  basis: string[];
}

function keyCount(v: unknown): number {
  return v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).length : 0;
}

/** The coverage status for one reply payload, or null when nothing in it says. */
export function replyCoverage(payload: Record<string, unknown>, truncatedByMcp: boolean): CoverageStatus | null {
  const basis: string[] = [];
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? (payload.data as Record<string, unknown>) : null;
  if (data) {
    const places = keyCount(data.nullPlaces);
    if (places) basis.push(`${places} places in data.nullPlaces have an unknown value (null, not 0)`);
    const cells = keyCount(data.nullCells);
    if (cells) basis.push(`${cells} places in data.nullCells have at least one null field (null, not 0)`);
  }
  if (truncatedByMcp) basis.push("the MCP cut the list to fit one reply (see note); the HTTP route has the full set");
  return basis.length ? { status: "partial", basis } : null;
}
