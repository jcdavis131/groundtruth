// OpenFEMA DisasterDeclarationsSummaries (v2). A "FEMA declaration" item names one disaster number: the reply holds one row
// per designated area, all with the same title, date and incident type. A "declarations listed" item is a count of distinct
// disasters filed against one county. Rows whose declarationDate is later than the item's retrievedAt are declarations made
// after the item was read, so a count that grew only by those reads as CHANGED_SINCE_RETRIEVAL.

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, also, isObj, norm, parseJson, unreadable, type Row } from "./util";

function rowsOf(body: string): Row[] | null {
  const j = parseJson(body);
  if (!isObj(j) || !Array.isArray(j.DisasterDeclarationsSummaries)) return null;
  return j.DisasterDeclarationsSummaries.filter(isObj);
}

const day = (v: unknown): string | null => {
  const s = norm(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export const femaOpenfema: Matcher = {
  id: "fema-openfema",
  sourceId: "fema-openfema",
  tolerance: { declarationTitle: 0, declarationDate: 0, incidentType: 0, declarations: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = rowsOf(body);
    if (!rows) return unreadable("no DisasterDeclarationsSummaries array in the reply");
    if (item.fact === "FEMA declaration") {
      const number = (item.code ?? "").replace(/^[A-Z]+-/, "");
      const mine = rows.filter((r) => String(r.disasterNumber) === number);
      if (!mine.length) return absent(`OpenFEMA has no declaration with disasterNumber ${number}`);
      const r = mine[0];
      const title = norm(r.declarationTitle);
      const date = day(r.declarationDate);
      if (title === null || date === null) return unreadable("the row has no declarationTitle or declarationDate");
      // the note leads with the incident type; "; filed by FEMA under the former county code" follows on some rows
      const incident = (item.note ?? "").split(";")[0].trim();
      return {
        kind: "value",
        field: "declarationTitle",
        publisherValue: title,
        itemValue: typeof item.value === "string" ? item.value : null,
        period: date,
        later: false,
        also: [also("declarationDate", item.period ?? null, date), also("incidentType", incident || null, norm(r.incidentType))],
      };
    }
    if (item.fact === "FEMA declarations listed") {
      const retrieved = item.retrievedAt.slice(0, 10);
      const all = new Set(rows.map((r) => `${String(r.declarationType)}-${String(r.disasterNumber)}`));
      const old = new Set(rows.filter((r) => (day(r.declarationDate) ?? "") <= retrieved).map((r) => `${String(r.declarationType)}-${String(r.disasterNumber)}`));
      const grew = all.size > old.size;
      return {
        kind: "value",
        field: "declarations",
        publisherValue: old.size,
        itemValue: typeof item.value === "number" ? item.value : null,
        period: grew ? [...rows].map((r) => day(r.declarationDate) ?? "").sort().pop() ?? null : null,
        // declarations dated after the item was read: the list moved on, the item was not wrong when it was read
        later: grew && typeof item.value === "number" && old.size === item.value,
      };
    }
    return unreadable(`no rule for the OpenFEMA fact "${item.fact}"`);
  },
};
