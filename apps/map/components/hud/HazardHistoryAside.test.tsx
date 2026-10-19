// The Hazard history aside as drawn from a route reply: the FEMA count with a legacy-row gap
// (02105's Chatham REAA rows FEMA files under 02280), USDM's this-week call failing, and storm
// totals with zone-coded years. Rendered to static markup, no browser; the fetching wrapper is
// thin and the view is tested directly with the reply.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HazardHistoryView } from "./HazardHistoryAside";
import { USDM_THIS_WEEK, type HistoryData } from "@/lib/hazards/history";

/** Markup as the text a reader sees: React's text-node comments dropped, every tag a line break (so text from two elements never runs together), entity escapes undone. */
function text(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const FIPS = "02105";
const geo = { kind: "county" as const, id: FIPS, name: "Hoonah-Angoon Census Area, AK" };
const yr = (y: number) => Date.UTC(y, 0, 1);
const series = (id: string, points: Array<[number, number]>) => ({ id: `${id}:${FIPS}`, title: id, unit: "declarations", frequency: "annual", geo, provenance: {}, tags: [], points: points.map(([y, v]) => ({ t: yr(y), v })) });
const decl = (area: string) => ({ disasterNumber: 4533, declarationType: "DR", declarationDate: "2020-04-09", incidentType: "Biological", declarationTitle: "COVID-19 PANDEMIC", incidentBeginDate: null, incidentEndDate: null, programs: ["PA"], designatedArea: area, placeCode: null, tribalRequest: null });

const CHATHAM: HistoryData["missing"][number] = {
  source: "FEMA legacy-code rows",
  reason: "join:filed_under_other_code",
  detail: "Chatham Regional Educational Attendance Area (EM-3446, DR-4585), filed under 02280: FEMA files this area under 02280, Wrangell-Petersburg, though it lies in Hoonah-Angoon. Not attached here, so this county's declarations may be short by 2.",
};

function reply(over: Partial<HistoryData> = {}): HistoryData {
  return {
    fips: FIPS,
    name: "Hoonah-Angoon Census Area",
    state: "AK",
    series: [series("fema:dr", [[2020, 1]]), series("fema:em", [[2018, 1]]), series("fema:fm", [])],
    declarations: [decl("Hoonah-Angoon (Census Area)"), decl("Chatham Regional Educational Attendance Area")],
    declarationRows: 2,
    droughtNow: null,
    landslide: null,
    storms: {
      fips: FIPS,
      years: [1996, 2026],
      lastYearMonth: "202607",
      types: [
        { type: "Hail", points: [[2020, 3]], blank: [], total: 3 },
        { type: "Flood", points: [[2001, 2], [2010, 3]], blank: [[1996, "zone-coded"]], total: 5 },
      ],
      break: null,
      zeroFill: false,
    },
    missing: [CHATHAM, { source: USDM_THIS_WEEK, reason: "source:failed", detail: "usdm 503" }],
    ...over,
  } as unknown as HistoryData;
}

const render = (d: HistoryData) => text(renderToStaticMarkup(<HazardHistoryView fips={FIPS} data={d} caveats={["c"]} />));

describe("HazardHistoryView", () => {
  it("a legacy-row gap keeps FEMA's counts and says they may be short; FEMA is not called missing", () => {
    const t = render(reply());
    expect(t).toContain("1 major disaster · 1 emergency · 0 fire management (may be short)");
    expect(t).toContain("not counted here, though it lies in this county: Chatham Regional Educational Attendance Area (EM-3446, DR-4585), filed under 02280");
    expect(t).not.toContain("FEMA did not answer");
    expect(t).not.toContain("not published in this geography");
    // One row per designated area: rows are not declarations.
    expect(t).toContain("2 rows for 1 disaster: FEMA lists one row per designated area");
    expect(t).not.toContain("1 disasters");
    expect(t).toContain("COVID-19 PANDEMIC · PA · Chatham Regional Educational Attendance Area");
  });

  it("with no gap, no '(may be short)'; FEMA itself failing is 'did not answer'", () => {
    expect(render(reply({ missing: [] }))).not.toContain("(may be short)");
    const failed = render(reply({ series: [], declarations: [], missing: [{ source: "FEMA", reason: "source:failed", detail: "503" }] }));
    expect(failed).toContain("FEMA did not answer (unknown, not none)");
  });

  it("USDM's this-week call failing says 'did not answer', never 'no week published'", () => {
    const t = render(reply());
    expect(t).toContain("this week: the Drought Monitor did not answer (unknown, not none)");
    expect(t).not.toContain("no week published");
    // Answered with no week: that, and only that, is "no week published".
    const none = render(reply({ missing: [CHATHAM] }));
    expect(none).toContain("no week published");
    expect(none).not.toContain("did not answer (unknown, not none)");
  });

  it("a storm total with zone-coded years is marked * with its key; one without is not", () => {
    const t = render(reply());
    expect(t).toContain("3 hail reports since 1996");
    expect(t).toContain("+5 or more other county-coded reports: flood 5*\n");
    expect(t).toContain("* drawn years only: its zone-coded years are blank and not in the total");
    const clean = render(reply({ storms: { ...reply().storms!, types: [{ type: "Hail", points: [[2020, 3]], blank: [], total: 3 }] } }));
    expect(clean).not.toContain("*");
  });

  it("a main storm type (Hail, Thunderstorm Wind, Flash Flood) with blank years gets its * and the key", () => {
    for (const type of ["Hail", "Thunderstorm Wind", "Flash Flood"]) {
      const t = render(reply({ storms: { ...reply().storms!, types: [{ type, points: [[2020, 3]], blank: [[1997, "zone-coded"]], total: 3 }] } }));
      expect(t, type).toContain(`3 ${type.toLowerCase()}* reports since 1996`);
      expect(t, type).toContain("* drawn years only: its zone-coded years are blank and not in the total");
    }
  });

  it("more than one distinct disaster is plural", () => {
    const d = reply();
    const t = render(reply({ declarations: [...d.declarations, { ...d.declarations[0], disasterNumber: 4585 }] }));
    expect(t).toContain("3 rows for 2 disasters: FEMA lists one row per designated area");
  });
});
