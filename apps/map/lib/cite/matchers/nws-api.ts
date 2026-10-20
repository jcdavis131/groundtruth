// NWS api.weather.gov /points/{lat},{lon}: properties.cwa (forecast office id) and properties.timeZone.
// An NWS alert is a live event that expires, so hosts.ts refuses it before a matcher is asked.

import type { CiteItem, Matcher, Reading } from "../types";
import { isObj, norm, parseJson, unreadable } from "./util";

export const nwsApi: Matcher = {
  id: "nws-api-points",
  sourceId: "nws-api",
  tolerance: { cwa: 0, timeZone: 0 },
  read(item: CiteItem, body: string): Reading {
    const j = parseJson(body);
    const p = isObj(j) && isObj(j.properties) ? j.properties : null;
    if (!p) return unreadable("no properties object in the /points reply");
    if (item.fact === "NWS forecast office") {
      const cwa = norm(p.cwa) ?? norm(p.gridId);
      return cwa === null ? unreadable("no cwa in the /points reply") : { kind: "value", field: "cwa", publisherValue: cwa, itemValue: item.code ?? null, period: null, later: false };
    }
    if (item.fact === "time zone") {
      const tz = norm(p.timeZone);
      return tz === null ? unreadable("no timeZone in the /points reply") : { kind: "value", field: "timeZone", publisherValue: tz, itemValue: item.code ?? null, period: null, later: false };
    }
    return unreadable(`no rule for the NWS fact "${item.fact}"`);
  },
};
