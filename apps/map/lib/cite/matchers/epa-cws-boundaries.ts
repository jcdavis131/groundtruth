// EPA Community Water System boundaries (PWSID). The item is labelled by PWSID with the population served in its note; names
// are not copied, so the system's name is not read. SDWIS fields are unchanged between pulls, so a difference is a difference.

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, also, arcgisRows, norm, toNum, unreadable } from "./util";

export const epaCwsBoundaries: Matcher = {
  id: "epa-cws-boundaries",
  sourceId: "epa-cws-boundaries",
  tolerance: { PWSID: 0, Population_Served_Count: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = arcgisRows(body);
    if (!rows) return unreadable("not an ArcGIS query reply");
    if (!/^community water system serving the point/.test(item.fact)) return unreadable(`no rule for the water-system fact "${item.fact}"`);
    if (!rows.length) return absent(`EPA's boundary layer has no system ${item.code}`);
    const r = rows[0];
    const id = norm(r.PWSID);
    if (id === null) return unreadable("the feature has no PWSID");
    const pop = /^population served (\d+)/.exec((item.note ?? "").trim());
    return {
      kind: "value",
      field: "PWSID",
      publisherValue: id,
      itemValue: typeof item.value === "string" ? item.value : null,
      period: null,
      later: false,
      also: pop ? [also("Population_Served_Count", Number(pop[1]), toNum(r.Population_Served_Count))] : [],
    };
  },
};
