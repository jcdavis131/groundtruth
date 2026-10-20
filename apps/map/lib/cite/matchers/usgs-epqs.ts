// USGS Elevation Point Query Service v1: {"value": "148.199..."} metres. The item rounds to 0.1 m; the declared tolerance is
// 1 m, because the item's point is snapped (0.001 degree) and EPQS answers per 1 m cell. EPQS answers -1000000 where it has no data.

import type { CiteItem, Matcher, Reading } from "../types";
import { isObj, parseJson, toNum, unreadable } from "./util";

export const usgsEpqs: Matcher = {
  id: "usgs-epqs",
  sourceId: "usgs-epqs",
  tolerance: { elevation: 1 },
  read(item: CiteItem, body: string): Reading {
    const j = parseJson(body);
    if (!isObj(j) || !("value" in j)) return unreadable("no value in the EPQS reply");
    const v = toNum(j.value);
    if (v === null) return unreadable("EPQS value is not a number");
    if (v <= -999999) return { kind: "suppressed", reason: "EPQS answers -1000000: it has no elevation here", period: null };
    return { kind: "value", field: "elevation", publisherValue: v, itemValue: typeof item.value === "number" ? item.value : null, period: null, later: false };
  },
};
