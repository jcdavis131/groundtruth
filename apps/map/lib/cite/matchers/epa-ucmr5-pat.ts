// EPA PFAS Analytic Tools, UCMR 5 results (one row per sample result). Two items: the system's status ("detected" when any
// result is at or above the minimum reporting level, "not detected", or "not in UCMR 5" when EPA holds no row), and the highest
// single result for one contaminant. Counts in the notes ("6 of 29", "4 of 12") are compared exactly. A reply that says it
// exceeded the transfer limit is incomplete, so it is unreadable, never a "not detected".

import type { CiteItem, Matcher, Reading } from "../types";
import { also, arcgisRows, isObj, norm, parseJson, toNum, unreadable, type Row } from "./util";

const above = (r: Row): boolean => norm(r.Result_At_or_Above_UCMR_MRL) === "Yes";

/** EPA adds a derived "Hazard Index (HI)" row to the PFAS table; it is not one of the 29 PFAS the items count. */
const isPfas = (r: Row): boolean => norm(r.Contaminant) !== "Hazard Index (HI)";

export const epaUcmr5Pat: Matcher = {
  id: "epa-ucmr5-pat",
  sourceId: "epa-ucmr5-pat",
  tolerance: { status: 0, highest: 0.05, results: 0, aboveMrl: 0, contaminants: 0, detected: 0 },
  read(item: CiteItem, body: string): Reading {
    const all = arcgisRows(body);
    if (!all) return unreadable("not an ArcGIS query reply");
    const rows = all.filter(isPfas);
    const j = parseJson(body);
    if (isObj(j) && j.exceededTransferLimit === true) return unreadable("the reply is truncated (exceededTransferLimit)");
    const note = item.note ?? "";
    if (item.fact === "UCMR 5 PFAS status of the system") {
      const contaminants = new Set(rows.map((r) => norm(r.Contaminant)));
      const detected = new Set(rows.filter(above).map((r) => norm(r.Contaminant)));
      const status = rows.length === 0 ? "not in UCMR 5" : detected.size > 0 ? "detected" : "not detected";
      const m = /^(\d+) of (\d+) PFAS/.exec(note);
      const pairs = m ? [also("detected", Number(m[1]), detected.size), also("contaminants", Number(m[2]), contaminants.size)] : [];
      return { kind: "value", field: "status", publisherValue: status, itemValue: typeof item.value === "string" ? item.value : null, period: null, later: false, also: pairs };
    }
    const c = /^UCMR 5 highest single result: (.+)$/.exec(item.fact)?.[1];
    if (!c) return unreadable(`no rule for the UCMR fact "${item.fact}"`);
    const mine = rows.filter((r) => norm(r.Contaminant) === c);
    if (!mine.length) return { kind: "absent", reason: `EPA's UCMR 5 table has no result rows for ${c} at this system` };
    const vals = mine.map((r) => toNum(r.Analytical_Result_Value__ng_L_)).filter((v): v is number => v !== null);
    if (!vals.length) return { kind: "absent", reason: `no row for ${c} carries a measured value` };
    const m = /^(\d+) of (\d+) results/.exec(note);
    const pairs = m ? [also("aboveMrl", Number(m[1]), mine.filter(above).length), also("results", Number(m[2]), mine.length)] : [];
    return { kind: "value", field: "highest", publisherValue: Math.max(...vals), itemValue: typeof item.value === "number" ? item.value : null, period: null, later: false, also: pairs };
  },
};
