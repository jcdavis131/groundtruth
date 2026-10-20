// HIFLD hospitals (Hospitals_RAPT layer): ID -> NAME, TYPE, STATUS. The item's note leads with the type and status in lower case
// ("general acute care; open"). No address, phone or owner is read.

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, also, arcgisRows, norm, unreadable } from "./util";

const lower = (v: unknown): string | null => norm(v)?.toLowerCase() ?? null;

export const hifldHospitals: Matcher = {
  id: "hifld-hospitals",
  sourceId: "hifld-hospitals",
  tolerance: { NAME: 0, ID: 0, TYPE: 0, STATUS: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = arcgisRows(body);
    if (!rows) return unreadable("not an ArcGIS query reply");
    if (item.fact !== "hospital") return unreadable(`no rule for the HIFLD fact "${item.fact}"`);
    if (!rows.length) return absent(`HIFLD has no hospital ${item.code}`);
    const r = rows[0];
    const name = norm(r.NAME);
    const id = norm(r.ID);
    if (name === null || id === null) return unreadable("the feature has no NAME or ID");
    const [type, status] = (item.note ?? "").split(";").map((s) => s.trim());
    return {
      kind: "value",
      field: "NAME",
      publisherValue: name,
      itemValue: typeof item.value === "string" ? item.value : null,
      period: null,
      later: false,
      also: [also("ID", (item.code ?? "").replace(/^hifld-hosp:/, ""), id), also("TYPE", type ?? null, lower(r.TYPE)), also("STATUS", status ?? null, lower(r.STATUS))],
    };
  },
};
