// Tests for the athlete builder's pure parts. Plain Node, no install, no network.
//   node data/athletes/build.test.mjs
// Rule A5a (Cam 2026-10-19): every shipped birthCity traces from its P19 QID through P131 to a settlement
// whose external id equals the place record's id; nothing is joined by name. The place graph below is a
// small hand-made one shaped like Wikidata's answers (Hollywood -> Los Angeles, Northridge with two parents,
// a state, a hospital, two cities called Portland).
import { Readable } from "node:stream";
import { project, readTable, splitCsvLine } from "./lib/csv.mjs";
import { fipsToGeoid, gnisToAnsi, resolveBirthplace, traceProblems } from "./lib/birthplace.mjs";
import { covers, nameFor, teamItems, venueFor, withOccupantMoves } from "./lib/arena.mjs";
import { refuseNeverList } from "./lib/net.mjs";
import { birthFields, eraAbbr, homeArenas, present } from "./build.mjs";
import { validateAthlete } from "./validate.mjs";

let failed = 0;
let passed = 0;
const check = (ok, msg, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// ---------------------------------------------------------------- csv

check(JSON.stringify(splitCsvLine('a,"b,c",d')) === JSON.stringify(["a", "b,c", "d"]), "splitCsvLine keeps a quoted comma inside its field");
check(JSON.stringify(splitCsvLine('"say ""hi""",x')) === JSON.stringify(['say "hi"', "x"]), "splitCsvLine unescapes doubled quotes");
check(throws(() => project(["gsis_id", "display_name"], ["gsis_id", "college_name"], "players")), "a missing header column stops the read");
{
  const rows = [];
  const input = Readable.from(["gsis_id,birth_date,display_name,college_name\n", "00-1,FIXTURE-DATE,Fixture Player,Fixture State\n"]);
  await readTable("players.csv", ["gsis_id", "display_name", "college_name"], (r) => rows.push(r), { input });
  check(rows.length === 1 && !("birth_date" in rows[0]) && Object.keys(rows[0]).length === 3, "readTable keeps only the listed columns; birth_date never reaches an object", JSON.stringify(rows));
}
check(!present("None") && !present("") && !present("n/a") && present("Fixture State"), "source fillers like None count as absent");

// ---------------------------------------------------------------- never-list requests

check(throws(() => refuseNeverList("SELECT ?p WHERE { ?p wdt:P569 ?d }")), "a query naming P569 (date of birth) is refused");
check(throws(() => refuseNeverList("FILTER(YEAR(?d) > 1990) ?p wdt:P569 ?d")), "P569 is refused as a filter too");
check(throws(() => refuseNeverList("?p wdt:P26 ?spouse")), "spouse (P26) is refused");
check(!throws(() => refuseNeverList("?p wdt:P19 ?pl . ?pl wdt:P131 ?up . ?st pq:P580 ?s")), "P19, P131 and qualifier dates of team membership are allowed");

// ---------------------------------------------------------------- A5a

check(fipsToGeoid("06-44000") === "0644000" && fipsToGeoid("3651000") === "3651000" && fipsToGeoid("123") === null, "FIPS 55-3 values become 7-digit GEOIDs");
check(gnisToAnsi("2395220") === "02395220", "GNIS ids become 8-digit ANSICODEs");

const node = (qid, o) => ({ qid, label: null, settle: false, finer: false, coarse: false, parents: [], fips: [], gnis: [], geonames: [], iso: [], ...o });
const graph = new Map(
  [
    node("QLA", { label: "Los Angeles", settle: true, fips: ["06-44000"], gnis: ["1662328", "2410877"], iso: ["US"] }),
    node("QHOLLY", { label: "Hollywood", settle: true, finer: true, parents: ["QLA"], gnis: ["1660757"], iso: ["US"] }),
    node("QNORTH", { label: "Northridge", settle: true, finer: true, parents: ["QLA", "QLACOUNTY"], iso: ["US"] }),
    node("QLACOUNTY", { label: "Los Angeles County", coarse: true, iso: ["US"] }),
    node("QSTATE", { label: "Fixture State", coarse: true, gnis: ["1779778"], iso: ["US"] }),
    node("QPDXOR", { label: "Portland", settle: true, fips: ["4159000"], iso: ["US"] }),
    node("QPDXME", { label: "Portland", settle: true, fips: ["2360545"], iso: ["US"] }),
    node("QHOSP", { label: "St Mary's Hospital", finer: true, parents: ["QPADD"], iso: ["GB"] }),
    node("QPADD", { label: "Paddington", settle: true, finer: true, parents: ["QLON"], iso: ["GB"] }),
    node("QLON", { label: "London", settle: true, geonames: ["2643743"], iso: ["GB"] }),
    node("QPARIS", { label: "Paris", settle: true, finer: true, geonames: ["2988507", "2968815"], iso: ["FR"] }),
    node("QVILLAGE", { label: "Fixture Village", settle: true, geonames: ["999"], iso: ["FR"] }),
    node("QWRONG", { label: "Fixture Town", settle: true, geonames: ["2643743"], iso: ["FR"] }),
    node("QNOTSET", { label: "Fixture Thing", geonames: ["2988507"], iso: ["FR"] }),
  ].map((n) => [n.qid, n]),
);
const gaz = (geoid, ansi, region) => ({ placeId: `census-place:${geoid}`, source: "census-gazetteer", upstreamId: geoid, cc: "US", regionCode: "US.XX", region, country: "United States" });
const la = gaz("0644000", "02410877", "California");
const pdxOr = gaz("4159000", "02411471", "Oregon");
const pdxMe = gaz("2360545", "02396221", "Maine");
const places = {
  gazByGeoid: new Map([["0644000", la], ["4159000", pdxOr], ["2360545", pdxMe]]),
  gazByAnsi: new Map([["02410877", la]]),
  geonames: new Map([
    ["2643743", { placeId: "geonames:2643743", source: "geonames", upstreamId: "2643743", cc: "GB", regionCode: "GB.ENG", region: "England", country: "United Kingdom" }],
    ["2988507", { placeId: "geonames:2988507", source: "geonames", upstreamId: "2988507", cc: "FR", regionCode: "FR.11", region: "Île-de-France", country: "France" }],
  ]),
};

const r = (p19) => resolveBirthplace(p19, graph, places);
{
  const x = r(["QLA"]);
  check(x.outcome === "matched-direct" && x.placeId === "census-place:0644000", "a city matched by FIPS and GNIS to one Gazetteer place is the birth city", JSON.stringify(x));
}
{
  const x = r(["QHOLLY"]);
  check(x.outcome === "matched-after-walk" && x.settlement === "QLA" && x.path.join(">") === "QHOLLY>QLA", "Hollywood walks P131 up to Los Angeles", JSON.stringify(x));
}
check(r(["QNORTH"]).outcome === "dropped-multiple-parents", "Northridge, with two P131 parents, is left out");
check(r(["QSTATE"]).outcome === "dropped-coarser", "a state is left out, even though it has a GNIS id");
check(r(["QPDXOR"]).placeId === "census-place:4159000" && r(["QPDXME"]).placeId === "census-place:2360545", "two places labelled Portland resolve to two different records by FIPS");
{
  const x = r(["QHOSP"]);
  check(x.outcome === "matched-after-walk" && x.settlement === "QLON" && x.path.length === 3, "a hospital walks up through Paddington to London", JSON.stringify(x));
}
check(r(["QPARIS"]).outcome === "matched-direct", "a city that matches a place record stays, even if a subclass path calls it finer");
check(r(["QVILLAGE"]).outcome === "dropped-no-external-id-match", "a settlement whose GeoNames id is not a cities500 city is left out");
check(r(["QWRONG"]).outcome === "dropped-country-mismatch", "a GeoNames match in another country than P17 is left out");
check(r(["QNOTSET"]).outcome === "dropped-not-settlement-by-p31", "an id match on an item that is not a settlement by P31 is left out");
check(r(["QLA", "QLON"]).outcome === "dropped-multiple-p19", "two places of birth are left out");
check(r(["QMISSING"]).outcome === "dropped-no-place-data", "a place Wikidata returned nothing for is left out");

// The trace check, on records built the way build.mjs builds them.
const at = { wikidata: "2026-10-19T00:00:00Z", gazetteer: "2026-10-19T00:00:00Z", geonames: "2026-10-19T00:00:00Z", admin1: "2026-10-19T00:00:00Z" };
const base = () => ({
  schemaVersion: "athlete/1",
  id: "nba:fixture-1",
  name: "Test Fixture Player",
  league: "NBA",
  team: "Fixture City Testers",
  season: "2025-26",
  sources: [{ sourceId: "nba-stats", upstreamId: "fixture-1", url: "https://example.invalid/roster", retrievedAt: "2026-10-18T12:00:00Z", fields: ["name", "league", "team", "season"] }],
});
const shipped = (p19) => {
  const res = { ...r(p19), playerQid: "QPLAYER" };
  const rec = base();
  const b = birthFields(res, graph, at);
  Object.assign(rec, b.fields);
  rec.sources.push(...b.sources);
  return { rec, trace: { id: rec.id, p19: res.path[0], path: res.path, settlement: res.settlement, placeId: res.placeId, via: res.via } };
};
for (const p of ["QLA", "QHOLLY", "QHOSP", "QPARIS"]) {
  const { rec, trace } = shipped([p]);
  check(validateAthlete(rec).length === 0, `a record born at ${p} passes validate.mjs`, JSON.stringify(validateAthlete(rec)));
  check(traceProblems(rec, trace, graph, places).length === 0, `a record born at ${p} passes the A5a trace check`, traceProblems(rec, trace, graph, places).join("; "));
}
{
  const { rec, trace } = shipped(["QHOLLY"]);
  check(rec.birthCity === "Los Angeles" && rec.sources.some((s) => s.sourceId === "wikidata" && s.upstreamId === "QHOLLY"), "the citation carries the P19 QID; the city shown is the settlement's");
  check(rec.sources.some((s) => s.sourceId === "census-gazetteer" && s.upstreamId === "0644000"), "the citation carries the place record's id");
  const relabelled = { ...rec, birthCity: "Hollywood" };
  check(traceProblems(relabelled, trace, graph, places).some((p) => /label/.test(p)), "a birthCity that is not the settlement's label fails the trace");
  const otherPortland = { ...trace, settlement: "QPDXME", path: ["QHOLLY", "QPDXME"], placeId: "census-place:2360545" };
  check(traceProblems(rec, otherPortland, graph, places).length > 0, "a trace through a P131 link that does not exist fails");
  const wrongRecord = { ...trace, placeId: "census-place:4159000" };
  check(traceProblems(rec, wrongRecord, graph, places).some((p) => /points at/.test(p)), "a trace whose place id is not the settlement's external id fails");
  check(traceProblems(rec, undefined, graph, places).length === 1, "a birthCity with no trace fails");
  const noP19 = { ...rec, sources: rec.sources.map((s) => (s.sourceId === "wikidata" ? { ...s, upstreamId: "QLA" } : s)) };
  check(traceProblems(noP19, trace, graph, places).some((p) => /wikidata citation/.test(p)), "a citation that names the settlement instead of the P19 QID fails");
}
{
  const { rec, trace } = shipped(["QLA"]);
  const viaNorthridge = { ...trace, p19: "QNORTH", path: ["QNORTH", "QLA"] };
  const rec2 = { ...rec, sources: rec.sources.map((s) => (s.sourceId === "wikidata" ? { ...s, upstreamId: "QNORTH" } : s)) };
  check(traceProblems(rec2, viaNorthridge, graph, places).some((p) => /more than one P131 parent/.test(p)), "a trace through a level with two parents fails");
}

// ---------------------------------------------------------------- NFL arenas

{
  const g = (season, home, stadium, location = "Home", type = "REG") => ({ season, game_type: type, home_team: home, location, stadium_id: stadium.slice(0, 5).toUpperCase(), stadium });
  const games = [
    g("2020", "AAA", "Alpha Field"), g("2020", "AAA", "Alpha Field"), g("2020", "AAA", "Gamma Park", "Neutral"), g("2020", "AAA", "Gamma Park", "Home", "POST"),
    g("2020", "BBB", "Beta Dome"), g("2020", "BBB", "Delta Dome"),
  ];
  const a = homeArenas(games);
  check(a.get("2020|AAA").stadium === "Alpha Field" && a.get("2020|AAA").games === 2, "the NFL arena is the regular-season home stadium; neutral-site and playoff games do not count");
  check(a.get("2020|BBB").tie === true, "a tie between two home stadiums gives no arena");
}

{
  const ids = new Map([["LV", "2520"], ["OAK", "2520"], ["LA", "2510"], ["STL", "2510"], ["LAR", "2510"], ["SEA", "4600"]]);
  const used = new Map([["2010", new Set(["OAK", "STL", "SEA"])], ["2020", new Set(["LV", "LA", "SEA"])]]);
  check(eraAbbr("LV", "2010", ids, used).abbr === "OAK", "a 2010 stats row written LV is the Oakland Raiders that season");
  check(eraAbbr("LA", "2010", ids, used).abbr === "STL" && eraAbbr("LA", "2020", ids, used).abbr === "LA", "LA is St. Louis in 2010 and Los Angeles in 2020");
  check(eraAbbr("SEA", "2010", ids, used).abbr === "SEA" && !eraAbbr("SEA", "2010", ids, used).from, "an abbreviation used that season stays as it is");
  check(!!eraAbbr("JAC", "2010", ids, used).absent, "an abbreviation the teams file does not know is left out, not mapped by its letters");
  check(!!eraAbbr("LV", "1990", ids, used).absent, "a season with no games.csv rows is left out");
}

// ---------------------------------------------------------------- NBA arenas

check(covers("2024-01-01T00:00:00Z", null, "2024-11-01T00:00:00Z") && !covers(null, null, "2024-11-01T00:00:00Z"), "an open-ended dated statement covers; an undated one never does");
{
  const crypto = { venue: "QOLD", label: "Old Arena", start: "1999-01-01T00:00:00Z", end: "2024-01-01T00:00:00Z" };
  const dome = { venue: "QNEW", label: "New Dome", start: "2024-01-01T00:00:00Z", end: null };
  check(venueFor([crypto, dome], "2023-24").venue === "QOLD" && venueFor([crypto, dome], "2024-25").venue === "QNEW", "a dated move switches the arena in the season it happened");
  check(!!venueFor([crypto, { ...dome, start: null }], "2024-25").absent, "an undated venue statement leaves the arena out rather than guessing");
  check(!!venueFor([crypto, { ...dome, start: "1999-01-01T00:00:00Z" }], "2010-11").absent, "two venues overlapping a season leave the arena out");
  check(!!venueFor([], "2010-11").absent, "no home venue leaves the arena out");
  // The Clippers' case: P115 ends open at the old arena; the new one lists them as occupant from 2024.
  const p115 = [{ venue: "QOLDER", label: "Older", start: "1984-01-01T00:00:00Z", end: "1999-01-01T00:00:00Z" }, { ...crypto, end: null }];
  const occ = [{ venue: "QNEW", label: "New Dome", start: "2024-08-15T00:00:00Z", end: null }, { venue: "QOLDER", label: "Older", start: "1984-01-01T00:00:00Z", end: null }, { venue: "QANCIENT", label: "Ancient", start: "1970-01-01T00:00:00Z", end: null }];
  const merged = withOccupantMoves(p115, occ);
  check(merged.length === 3 && merged.some((s) => s.venue === "QNEW"), "a venue naming the team as occupant after every P115 start is added; older occupants are not");
  check(venueFor(merged, "2023-24").venue === "QOLD", "before the move the old arena stands");
  check(!!venueFor(merged, "2024-25").absent && !!venueFor(merged, "2025-26").absent, "after a move the team item does not record, the arena is left out rather than named wrong");
  const names = [{ name: "Staples Center", start: "1999-01-01T00:00:00Z", end: "2021-12-25T00:00:00Z" }, { name: "Crypto.com Arena", start: "2021-12-25T00:00:00Z", end: null }];
  check(nameFor(names, "Crypto.com Arena", "2015-16").name === "Staples Center" && nameFor(names, "Crypto.com Arena", "2022-23").name === "Crypto.com Arena", "a season gets the venue's dated official name for that season");
  check(nameFor([], "Current Label", "2015-16").from === "label", "with no dated official name, the current label is used and says so");
}
{
  const m = (team, start = "2010-01-01T00:00:00Z", end = null) => ({ team, start, end });
  const p54 = new Map([
    ["P1", [m("QT1")]], ["P2", [m("QT1")]], ["P3", [m("QT1")]], ["P4", [m("QT2")]],
    ["P5", [m("QT2")]], ["P6", [m("QT2")]], ["P7", [m("QT3", null)]],
  ]);
  const items = teamItems(new Map([["2015-16|100", ["P1", "P2", "P3", "P4"]], ["2015-16|200", ["P4", "P5", "P7"]]]), p54);
  check(items.get("2015-16|100").teamQid === "QT1", "the team item is the one most roster players were on at the season's midpoint");
  check(!!items.get("2015-16|200").absent, "fewer than three votes gives no team item");
  const clash = teamItems(new Map([["2015-16|100", ["P1", "P2", "P3"]], ["2015-16|300", ["P1", "P2", "P3"]]]), p54);
  check(!!clash.get("2015-16|100").absent && !!clash.get("2015-16|300").absent, "one team item voted for two TEAM_IDs in a season is dropped for both");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
