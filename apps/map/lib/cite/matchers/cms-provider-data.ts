// CMS Provider Data, Hospital General Information (datastore query by facility_id = CCN): hospital_overall_rating is "1" to "5",
// or "Not Available" where CMS publishes no star rating, which is CMS's own flag and reads as NOT_PUBLISHED. An item that
// states null (the app's "no rating, not 0") is confirmed by that flag.

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, also, isObj, norm, parseJson, toNum, unreadable } from "./util";

export const cmsProviderData: Matcher = {
  id: "cms-provider-data",
  sourceId: "cms-provider-data",
  tolerance: { hospital_overall_rating: 0, facility_id: 0 },
  read(item: CiteItem, body: string): Reading {
    const j = parseJson(body);
    if (!isObj(j) || !Array.isArray(j.results)) return unreadable("no results array in the datastore reply");
    if (item.fact !== "CMS overall hospital star rating") return unreadable(`no rule for the CMS fact "${item.fact}"`);
    const r = j.results.find((x) => isObj(x) && norm(x.facility_id) === item.code);
    if (!r || !isObj(r)) return absent(`CMS has no hospital with facility_id ${item.code}`);
    if (!("hospital_overall_rating" in r)) return unreadable("the row has no hospital_overall_rating");
    const raw = norm(r.hospital_overall_rating);
    const n = toNum(r.hospital_overall_rating);
    if (n === null) return { kind: "suppressed", reason: `CMS publishes no overall rating for this hospital ("${raw ?? ""}")`, period: null };
    return {
      kind: "value",
      field: "hospital_overall_rating",
      publisherValue: n,
      itemValue: typeof item.value === "number" ? item.value : null,
      period: null,
      later: false,
      also: [also("facility_id", item.code ?? null, norm(r.facility_id))],
    };
  },
};
