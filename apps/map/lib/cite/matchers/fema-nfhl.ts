// FEMA National Flood Hazard Layer. Two record kinds: the NFIP community (layer 22, CID -> POL_NAME1; a community has one
// row per panel, all with the same name) and the flood zone at a point (layer 28, FLD_ZONE and SFHA_TF).

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, also, arcgisRows, noteField, norm, unreadable } from "./util";

export const femaNfhl: Matcher = {
  id: "fema-nfhl",
  sourceId: "fema-nfhl",
  tolerance: { POL_NAME1: 0, CID: 0, FLD_ZONE: 0, SFHA_TF: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = arcgisRows(body);
    if (!rows) return unreadable("not an ArcGIS query reply");
    if (item.fact === "NFIP community") {
      if (!rows.length) return absent(`NFHL has no NFIP community ${item.code}`);
      // NFHL files one row per panel, and a community can be spelled several ways across them ("City Of Austin", "City of Austin"):
      // the item's spelling must be one of them
      const names = [...new Set(rows.map((r) => norm(r.POL_NAME1)))];
      const cid = norm(rows[0].CID);
      if (names.includes(null) || cid === null) return unreadable("a community row has no POL_NAME1 or CID");
      const name = names.includes(item.value as string) ? (item.value as string) : names[0];
      return { kind: "value", field: "POL_NAME1", publisherValue: name, itemValue: typeof item.value === "string" ? item.value : null, period: null, later: false, also: [also("CID", item.code ?? null, cid)] };
    }
    if (item.fact === "FEMA flood zone") {
      if (!rows.length) return absent("NFHL has no flood-zone polygon at the point");
      const zones = rows.map((r) => norm(r.FLD_ZONE));
      if (zones.some((z) => z === null)) return unreadable("a flood-zone row has no FLD_ZONE");
      // overlapping polygons at one point: the item's zone must be one of them
      const zone = zones.includes(item.code ?? "") ? (item.code as string) : (zones[0] as string);
      const row = rows[zones.indexOf(zone)];
      const sfha = norm(row.SFHA_TF);
      const sfhaWord = sfha === "T" ? "yes" : sfha === "F" ? "no" : sfha;
      return {
        kind: "value",
        field: "FLD_ZONE",
        publisherValue: zone,
        itemValue: item.code ?? null,
        period: null,
        later: false,
        also: [also("SFHA_TF", noteField(item.note, "special flood hazard area:"), sfhaWord)],
      };
    }
    return unreadable(`no rule for the NFHL fact "${item.fact}"`);
  },
};
