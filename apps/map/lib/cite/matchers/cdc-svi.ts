// CDC/ATSDR Social Vulnerability Index 2022, county layer: RPL_THEMES is the overall percentile rank (0 least to 1 most
// vulnerable). The item states it to four places, so the declared tolerance is half of 0.0001. CDC marks a county it does
// not rank with -999, which is the publisher's own suppression flag.

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, arcgisRows, toNum, unreadable } from "./util";

export const cdcSvi: Matcher = {
  id: "cdc-svi",
  sourceId: "cdc-svi",
  tolerance: { RPL_THEMES: 0.00005 },
  read(item: CiteItem, body: string): Reading {
    const rows = arcgisRows(body);
    if (!rows) return unreadable("not an ArcGIS query reply");
    if (!rows.length) return absent("CDC's SVI layer has no row for this county");
    if (item.fact !== "CDC/ATSDR SVI 2022 overall percentile") return unreadable(`no rule for the SVI fact "${item.fact}"`);
    const v = toNum(rows[0].RPL_THEMES);
    if (v === null) return unreadable("the row has no RPL_THEMES");
    if (v < 0) return { kind: "suppressed", reason: `CDC ranks no value here (RPL_THEMES ${v})`, period: "2022" };
    return { kind: "value", field: "RPL_THEMES", publisherValue: v, itemValue: typeof item.value === "number" ? item.value : null, period: "2022", later: false };
  },
};
