// USACE National Inventory of Dams (public layer, queried by NIDID). The note states what the item found, in words:
// "hazard potential High; condition Fair; completed 1960; owner type Local Government". A dam of a private owner is labelled
// by id with a null name (the app withholds it), so the name is compared only when the item states one.

import type { CiteItem, Matcher, Reading, Scalar } from "../types";
import { absent, also, arcgisRows, noteField, norm, toNum, unreadable } from "./util";

export const usaceNid: Matcher = {
  id: "usace-nid",
  sourceId: "usace-nid",
  tolerance: { NIDID: 0, NAME: 0, HAZARD_POTENTIAL: 0, CONDITION_ASSESSMENT: 0, YEAR_COMPLETED: 0, PRIMARY_OWNER_TYPE: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = arcgisRows(body);
    if (!rows) return unreadable("not an ArcGIS query reply");
    if (item.fact !== "dam") return unreadable(`no rule for the NID fact "${item.fact}"`);
    const id = (item.code ?? "").replace(/^nid:/, "");
    if (!rows.length) return absent(`NID has no dam ${id}`);
    const r = rows[0];
    const nid = norm(r.NIDID);
    if (nid === null) return unreadable("the feature has no NIDID");
    const pairs: Array<{ field: string; item: Scalar; publisher: Scalar }> = [];
    const hazard = noteField(item.note, "hazard potential");
    const cond = noteField(item.note, "condition");
    const year = noteField(item.note, "completed");
    const owner = noteField(item.note, "owner type");
    if (hazard !== null) pairs.push(also("HAZARD_POTENTIAL", hazard, norm(r.HAZARD_POTENTIAL)));
    if (cond !== null) pairs.push(also("CONDITION_ASSESSMENT", cond, norm(r.CONDITION_ASSESSMENT)));
    if (year !== null) pairs.push(also("YEAR_COMPLETED", Number(year), toNum(r.YEAR_COMPLETED)));
    if (owner !== null) pairs.push(also("PRIMARY_OWNER_TYPE", owner, norm(r.PRIMARY_OWNER_TYPE)));
    if (typeof item.value === "string" && "NAME" in r) pairs.push(also("NAME", item.value, norm(r.NAME)));
    return { kind: "value", field: "NIDID", publisherValue: nid, itemValue: id, period: null, later: false, also: pairs };
  },
};
