// Census TIGERweb (tigerWMS_Current): GEOID -> NAME. The item's value is the layer's NAME, with two house forms:
// a county carries its state suffix ("Travis County, TX"), a ZIP code area is written without Census's "ZCTA5 " prefix.
// A congressional district is labelled "TX-10" by the app and "Congressional District 10" by Census, so only its GEOID is compared.

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, also, arcgisRows, norm, stripState, unreadable } from "./util";

export const censusTigerweb: Matcher = {
  id: "census-tigerweb",
  sourceId: "census-tigerweb",
  tolerance: { NAME: 0, GEOID: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = arcgisRows(body);
    if (!rows) return unreadable("not an ArcGIS query reply");
    if (!rows.length) return absent(`TIGERweb has no feature with GEOID ${item.code}`);
    const geoid = norm(rows[0].GEOID);
    const name = norm(rows[0].NAME);
    if (geoid === null || name === null) return unreadable("the feature has no GEOID or NAME");
    const code = item.code ?? null;
    if (item.fact === "congressional district") return { kind: "value", field: "GEOID", publisherValue: geoid, itemValue: code, period: null, later: false };
    const value = typeof item.value === "string" ? item.value : null;
    const expected = item.fact === "county" || item.fact === "county touching the box" ? (value === null ? null : stripState(value)) : item.fact === "ZIP code area (ZCTA)" ? (value === null ? null : `ZCTA5 ${value}`) : value;
    return { kind: "value", field: "NAME", publisherValue: name, itemValue: expected, period: null, later: false, also: [also("GEOID", code, geoid)] };
  },
};
