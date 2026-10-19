// Builds the athlete-place snapshot: one athlete/1 record per athlete, season and team, for the NBA and the NFL.
// Plain Node 22+, no install; `unzip` must be on the PATH for the two zipped place files.
//
//   node data/athletes/build.mjs [--data-root DIR] [--date YYYY-MM-DD] [--offline]
//                                [--nfl-cache DIR] [--nba-cache DIR] [--nba-logs DIR]
//
// Inputs, read only and never copied into git:
//   NFL  nflverse files cached by vector-gridiron: players.csv (gsis_id, display_name, college_name, and pfr_id
//        and espn_id as Wikidata join keys only), stats_player_week_<year>.csv and depth_charts_<year>.csv (who
//        was on which team each season), games.csv (the stadium of each home game). teams_colors_logos.csv is fetched.
//   NBA  stats.nba.com responses cached by vector-hoops: playergamelogs per season (PLAYER_ID, TEAM_ID,
//        PLAYER_NAME, GAME_ID) and leaguedashteamstats (TEAM_ID -> TEAM_NAME). Players are keyed by PLAYER_ID only.
//   Wikidata (CC0)  players by league id (P3647 NBA.com, P3561 Pro Football Reference, P3686 ESPN NFL); their place
//        of birth (P19), resolved under rule A5a (lib/birthplace.mjs) to Census Gazetteer places (US) or GeoNames
//        (elsewhere); NBA arenas from the team item's dated home venue (P115, lib/arena.mjs). Never P569.
//
// Outputs, under <data-root>/athletes/<date>/ (default data root <home>/datastore/groundtruth-snapshots):
//   nba.jsonl, nfl.jsonl            the records, each checked by validate.mjs before it is written
//   birth-trace.jsonl               per athlete with a birthCity: P19 QID, the P131 path, settlement, place id
//   wikidata-places.json            the place graph the traces were resolved against
//   place-records.json              the place records the traces matched
//   schools.jsonl, birth-cities.jsonl, arenas.jsonl   aggregates for the map
//   manifest.json                   the same bytes as data/athletes/manifests/athletes.<date>.json (committed)

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readTable, splitCsvLine } from "./lib/csv.mjs";
import { MAX_WALK, OUTCOMES, resolveBirthplace, traceProblems } from "./lib/birthplace.mjs";
import { teamItems, venueFor, MIN_SHARE, MIN_VOTES } from "./lib/arena.mjs";
import { makeClient, UA } from "./lib/net.mjs";
import { recordKey, validateAthlete } from "./validate.mjs";

export const BUILDER = { name: "data/athletes/build.mjs", version: "0.1.0" };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";
export const URLS = {
  nflPlayers: `${NFLVERSE}/players/players.csv`,
  nflStats: (y) => `${NFLVERSE}/stats_player/stats_player_week_${y}.csv`,
  nflDepth: (y) => `${NFLVERSE}/depth_charts/depth_charts_${y}.csv`,
  nflGames: "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
  nflTeams: `${NFLVERSE}/teams/teams_colors_logos.csv`,
  nbaLogs: (s) => `https://stats.nba.com/stats/playergamelogs?Season=${s}`,
  nbaTeams: (s) => `https://stats.nba.com/stats/leaguedashteamstats?Season=${s}&MeasureType=Base`,
  gazetteer: "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip",
  geonamesCities: "https://download.geonames.org/export/dump/cities500.zip",
  geonamesAdmin1: "https://download.geonames.org/export/dump/admin1CodesASCII.txt",
  geonamesCountries: "https://download.geonames.org/export/dump/countryInfo.txt",
  wikidataItem: (q) => `https://www.wikidata.org/wiki/${q}`,
  geonamesPlace: (id) => `https://www.geonames.org/${id}`,
};

export const SOURCES = [
  { sourceId: "nflverse-players", licence: "CC-BY 4.0 (nflverse-data)", url: URLS.nflPlayers },
  { sourceId: "nflverse-stats", licence: "CC-BY 4.0 (nflverse-data)", url: `${NFLVERSE}/stats_player/` },
  { sourceId: "nflverse-depth", licence: "CC-BY 4.0 (nflverse-data)", url: `${NFLVERSE}/depth_charts/` },
  { sourceId: "nflverse-teams", licence: "CC-BY 4.0 (nflverse-data)", url: URLS.nflTeams },
  { sourceId: "nflverse-games", licence: "CC-BY 4.0 (nfldata, Lee Sharpe and nflverse)", url: URLS.nflGames },
  { sourceId: "nba-stats", licence: "NBA.com terms of use; public keyless responses, as cached by vector-hoops", url: "https://stats.nba.com/stats/" },
  { sourceId: "wikidata", licence: "CC0 1.0", url: "https://query.wikidata.org/sparql" },
  { sourceId: "census-gazetteer", licence: "US Census Bureau, public domain", url: URLS.gazetteer },
  { sourceId: "geonames", licence: "CC BY 4.0 (GeoNames)", url: "https://download.geonames.org/export/dump/" },
];

// Wikidata properties, found on Wikidata itself (wbsearchentities, 2026-10-19) and checked against known players:
// P3647 NBA.com player ID = stats.nba.com PERSON_ID (2544 -> Q36159); P3561 Pro Football Reference player ID =
// "<first letter>/<nflverse pfr_id>" (M/MahoPa00 -> Q19667998); P3686 ESPN.com NFL player ID = nflverse espn_id
// (3139477 -> Q19667998). Classes: Q486972 human settlement; finer: Q123705 neighbourhood, Q2983893 quarter,
// Q16917 hospital, Q408804 borough of New York City; coarser: Q6256 country, Q10864048 first-level and Q13220204
// second-level administrative division, Q28575 county of the United States. Q155223 is the NBA.
export const WD = { nba: "P3647", pfr: "P3561", espn: "P3686" };
const FINER = ["Q123705", "Q2983893", "Q16917", "Q408804"];
const COARSER = ["Q6256", "Q10864048", "Q13220204", "Q28575"];
const NBA_LEAGUE = "Q155223";

// GeoNames populated-place codes that are not a city of their own.
const GEONAMES_NOT_CITY = new Set(["PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH"]);

// Source values that mean "none"; the field is left out instead (missing means absent).
const NONE = new Set(["", "na", "n/a", "none", "null", "nan", "unknown", "-", "--", "?"]);
export const present = (v) => typeof v === "string" && !NONE.has(v.trim().toLowerCase());

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const mtime = (f) => iso(statSync(f).mtimeMs);
const sha256File = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const qid = (uri) => uri.replace("http://www.wikidata.org/entity/", "");
const splitL = (v) => (v ? v.split("|").filter(Boolean) : []);
const bump = (o, k, by = 1) => (o[k] = (o[k] ?? 0) + by);
const NOT_DEPRECATED = "FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }";

/** A local path with the home directory shown as <home>, so no machine path reaches a committed file. */
export const shown = (p) => p.split(homedir()).join("<home>").replace(/\\/g, "/");

function args(argv) {
  const out = { offline: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--offline") out.offline = true;
    else if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

/** The commit this build is made from; refuses when the builder's own files have uncommitted changes. */
function gitSha() {
  const dirty = execFileSync("git", ["-C", REPO, "status", "--porcelain", "--", "data/athletes"], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.trim() && !l.includes("data/athletes/manifests/"));
  if (dirty.length) throw new Error(`data/athletes has uncommitted changes; commit them first so the manifest names the code:\n${dirty.join("\n")}`);
  return execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

// ------------------------------------------------------------------------------------------------ NFL

/** The arena per `${season}|${home team}`: the stadium most of its regular-season home games were in; a tie is {tie}. */
export function homeArenas(games) {
  const tally = new Map();
  for (const g of games) {
    if (g.game_type !== "REG" || g.location !== "Home" || !present(g.stadium) || !present(g.stadium_id)) continue;
    const k = `${g.season}|${g.home_team}`;
    const t = tally.get(k) ?? new Map();
    const sk = `${g.stadium_id}|${g.stadium}`;
    t.set(sk, (t.get(sk) ?? 0) + 1);
    tally.set(k, t);
  }
  const out = new Map();
  for (const [k, t] of tally) {
    const ranked = [...t.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) out.set(k, { tie: true });
    else {
      const [stadiumId, stadium] = ranked[0][0].split("|");
      out.set(k, { stadiumId, stadium, games: ranked[0][1] });
    }
  }
  return out;
}

async function readNfl(dir, log) {
  const players = new Map();
  const pf = path.join(dir, "players.csv");
  await readTable(pf, ["gsis_id", "display_name", "college_name", "pfr_id", "espn_id"], (r) => {
    if (present(r.gsis_id)) players.set(r.gsis_id, r);
  }, { label: "nflverse players.csv" });
  const files = { players: { path: pf, url: URLS.nflPlayers, retrievedAt: mtime(pf), sha256: sha256File(pf), rows: players.size } };

  // Who was on which team: stats lines first, then depth charts (most offensive linemen have no stat line).
  const seasons = new Map(); // `${gsis}|${season}|${team}` -> {sourceId, url, retrievedAt}
  files.seasons = [];
  const yearFiles = readdirSync(dir).filter((f) => /^(stats_player_week|depth_charts)_\d{4}\.csv$/.test(f));
  yearFiles.sort((a, b) => (a.startsWith("stats") === b.startsWith("stats") ? a.localeCompare(b) : a.startsWith("stats") ? -1 : 1));
  for (const f of yearFiles) {
    const full = path.join(dir, f);
    const year = f.match(/(\d{4})/)[1];
    const isStats = f.startsWith("stats_player_week");
    const cite = { sourceId: isStats ? "nflverse-stats" : "nflverse-depth", url: isStats ? URLS.nflStats(year) : URLS.nflDepth(year), retrievedAt: mtime(full) };
    const head = splitCsvLine(readFileSync(full, "utf8").slice(0, 4096).split("\n")[0].replace(/\r$/, ""));
    // 2016-2024 depth charts are week-keyed with season and club_code; 2025+ are dated rows with team and no
    // season column, so the file's year is the season.
    const cols = isStats ? ["player_id", "season", "team"] : head.includes("club_code") ? ["gsis_id", "season", "club_code"] : ["gsis_id", "team"];
    let added = 0;
    let otherSeason = 0;
    const n = await readTable(full, cols, (r) => {
      const id = r.player_id ?? r.gsis_id;
      const season = r.season ?? year;
      const team = r.team ?? r.club_code;
      if (!present(id) || !present(team)) return;
      if (season !== year) {
        otherSeason++;
        return;
      }
      const k = `${id}|${season}|${team}`;
      if (!seasons.has(k)) {
        seasons.set(k, cite);
        added++;
      }
    }, { label: `nflverse ${f}` });
    files.seasons.push({ file: f, path: full, url: cite.url, retrievedAt: cite.retrievedAt, columnsRead: cols, rows: n, rowsOfAnotherSeason: otherSeason, newPlayerSeasonTeams: added, sha256: sha256File(full) });
    log(`NFL ${f}: ${n} rows, ${added} new player-season-teams`);
  }

  const gf = path.join(dir, "games.csv");
  const games = [];
  await readTable(gf, ["season", "game_type", "home_team", "location", "stadium_id", "stadium"], (r) => games.push(r), { label: "nfldata games.csv" });
  files.games = { path: gf, url: URLS.nflGames, retrievedAt: mtime(gf), sha256: sha256File(gf), rows: games.length };
  return { players, seasons, games, files };
}

// ------------------------------------------------------------------------------------------------ NBA

async function readNba(cacheDir, logsDir, log) {
  const seasons = new Map(); // `${pid}|${season}|${teamId}` -> {names: Map, cite}
  const teamNames = new Map(); // `${season}|${teamId}` -> {name, cite}
  const files = { logs: [], teams: [] };
  for (const f of readdirSync(logsDir).filter((f) => /^gamelogs_\d{4}-\d{2}\.jsonl$/.test(f)).sort()) {
    const season = f.match(/(\d{4}-\d{2})/)[1];
    const full = path.join(logsDir, f);
    const cite = { url: URLS.nbaLogs(season), retrievedAt: mtime(full) };
    let n = 0;
    let skipped = 0;
    const rl = createInterface({ input: createReadStream(full, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      if (n === 0) for (const c of ["PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "GAME_ID"]) if (!(c in o)) throw new Error(`${f}: no ${c}; refusing to guess`);
      n++;
      // 001 preseason and 003 All-Star games are not a team's roster.
      if (/^00[13]/.test(String(o.GAME_ID))) {
        skipped++;
        continue;
      }
      const k = `${o.PLAYER_ID}|${season}|${o.TEAM_ID}`;
      const e = seasons.get(k) ?? { names: new Map(), cite };
      e.names.set(o.PLAYER_NAME, (e.names.get(o.PLAYER_NAME) ?? 0) + 1);
      seasons.set(k, e);
    }
    files.logs.push({ file: f, path: full, url: cite.url, retrievedAt: cite.retrievedAt, rows: n, skippedPreseasonAllStar: skipped, sha256: sha256File(full) });
    const tf = path.join(cacheDir, `team_base_${season}.json`);
    if (existsSync(tf)) {
      const rows = JSON.parse(readFileSync(tf, "utf8"));
      const tcite = { url: URLS.nbaTeams(season), retrievedAt: mtime(tf) };
      for (const r of rows) if (r.TEAM_ID && present(r.TEAM_NAME)) teamNames.set(`${season}|${r.TEAM_ID}`, { name: r.TEAM_NAME, cite: tcite });
      files.teams.push({ file: path.basename(tf), path: tf, url: tcite.url, retrievedAt: tcite.retrievedAt, rows: rows.length, sha256: sha256File(tf) });
    }
    log(`NBA ${f}: ${n} game rows`);
  }
  return { seasons, teamNames, files };
}

// ------------------------------------------------------------------------------------------------ Wikidata

/** league id value -> player QIDs, and player QID -> P19 QIDs, for one id property. */
async function wikidataPlayers(client, prop, values, purpose, log) {
  const byValue = new Map();
  const p19 = new Map();
  for (const batch of chunks(values, 300)) {
    const q = `SELECT ?v ?p ?pl WHERE { VALUES ?v { ${batch.map((v) => JSON.stringify(v)).join(" ")} } ?p wdt:${prop} ?v . OPTIONAL { ?p wdt:P19 ?pl } }`;
    const { rows } = await client.sparql(q, purpose);
    for (const b of rows) {
      const p = qid(b.p.value);
      (byValue.get(b.v.value) ?? byValue.set(b.v.value, new Set()).get(b.v.value)).add(p);
      const s = p19.get(p) ?? p19.set(p, new Set()).get(p);
      if (b.pl && b.pl.type === "uri") s.add(qid(b.pl.value));
    }
  }
  log(`wikidata ${prop}: ${byValue.size} of ${values.length} ids on an item`);
  return { byValue, p19 };
}

const placeQuery = (qids) => `SELECT ?pl (SAMPLE(?lab) AS ?label) ?settle ?finer ?coarse
 (GROUP_CONCAT(DISTINCT ?fips; separator="|") AS ?fipsL) (GROUP_CONCAT(DISTINCT ?gnis; separator="|") AS ?gnisL)
 (GROUP_CONCAT(DISTINCT ?gn; separator="|") AS ?gnL) (GROUP_CONCAT(DISTINCT ?iso; separator="|") AS ?isoL)
 (GROUP_CONCAT(DISTINCT ?up; separator="|") AS ?upL)
WHERE { VALUES ?pl { ${qids.map((q) => `wd:${q}`).join(" ")} }
 OPTIONAL { ?pl rdfs:label ?lab FILTER(lang(?lab) = "en") }
 BIND(EXISTS { ?pl wdt:P31/wdt:P279* wd:Q486972 } AS ?settle)
 BIND(EXISTS { ?pl wdt:P31/wdt:P279* ?f . VALUES ?f { ${FINER.map((q) => `wd:${q}`).join(" ")} } } AS ?finer)
 BIND(EXISTS { ?pl wdt:P31/wdt:P279* ?c . VALUES ?c { ${COARSER.map((q) => `wd:${q}`).join(" ")} } } AS ?coarse)
 OPTIONAL { ?pl wdt:P774 ?fips } OPTIONAL { ?pl wdt:P590 ?gnis } OPTIONAL { ?pl wdt:P1566 ?gn }
 OPTIONAL { ?pl wdt:P17/wdt:P297 ?iso } OPTIONAL { ?pl wdt:P131 ?up }
} GROUP BY ?pl ?settle ?finer ?coarse`;

/** The place graph: every P19 item, plus the P131 parents of finer-than-city items, up to MAX_WALK levels. */
async function placeGraph(client, start, log) {
  const graph = new Map();
  let todo = [...new Set(start)];
  for (let level = 0; level <= MAX_WALK && todo.length; level++) {
    for (const batch of chunks(todo, 120)) {
      const { rows } = await client.sparql(placeQuery(batch), "places");
      for (const b of rows) {
        const q = qid(b.pl.value);
        graph.set(q, {
          qid: q,
          label: b.label?.value ?? null,
          settle: b.settle?.value === "true",
          finer: b.finer?.value === "true",
          coarse: b.coarse?.value === "true",
          fips: splitL(b.fipsL?.value),
          gnis: splitL(b.gnisL?.value),
          geonames: splitL(b.gnL?.value),
          iso: splitL(b.isoL?.value),
          parents: splitL(b.upL?.value).map(qid),
        });
      }
    }
    todo = [...new Set([...graph.values()].filter((n) => n.finer).flatMap((n) => n.parents))].filter((q) => !graph.has(q));
    log(`wikidata places: ${graph.size} items after level ${level}`);
  }
  return graph;
}

/** NBA team items by roster vote, then each team-season's dated home venue. */
async function nbaArenas(client, rosters, playerQids, log) {
  const p54 = new Map();
  for (const batch of chunks(playerQids, 200)) {
    const q = `SELECT ?p ?team ?s ?e WHERE { VALUES ?p { ${batch.map((x) => `wd:${x}`).join(" ")} }
 ?p p:P54 ?st . ?st ps:P54 ?team . ?team wdt:P118 wd:${NBA_LEAGUE} . ${NOT_DEPRECATED}
 OPTIONAL { ?st pq:P580 ?s } OPTIONAL { ?st pq:P582 ?e } }`;
    const { rows } = await client.sparql(q, "nba-team-membership");
    for (const b of rows) {
      const p = qid(b.p.value);
      (p54.get(p) ?? p54.set(p, []).get(p)).push({ team: qid(b.team.value), start: b.s?.value ?? null, end: b.e?.value ?? null });
    }
  }
  const items = teamItems(rosters, p54);
  const teamQids = [...new Set([...items.values()].filter((v) => v.teamQid).map((v) => v.teamQid))];
  const venues = new Map(); // team QID -> [{venue, label, start, end}]
  const venueInfo = new Map(); // venue QID -> {label, coord}
  for (const batch of chunks(teamQids, 100)) {
    const q = `SELECT ?team ?venue ?lab ?s ?e ?coord WHERE { VALUES ?team { ${batch.map((x) => `wd:${x}`).join(" ")} }
 ?team p:P115 ?st . ?st ps:P115 ?venue . ${NOT_DEPRECATED}
 OPTIONAL { ?st pq:P580 ?s } OPTIONAL { ?st pq:P582 ?e }
 OPTIONAL { ?venue rdfs:label ?lab FILTER(lang(?lab) = "en") } OPTIONAL { ?venue wdt:P625 ?coord } }`;
    const { rows } = await client.sparql(q, "nba-home-venues");
    const seenSt = new Set();
    for (const b of rows) {
      const t = qid(b.team.value);
      const v = qid(b.venue.value);
      const st = { venue: v, label: b.lab?.value ?? null, start: b.s?.value ?? null, end: b.e?.value ?? null };
      const k = `${t}|${v}|${st.start}|${st.end}`;
      if (!seenSt.has(k)) {
        seenSt.add(k);
        (venues.get(t) ?? venues.set(t, []).get(t)).push(st);
      }
      if (!venueInfo.has(v)) venueInfo.set(v, { label: st.label, coord: b.coord?.value ?? null });
    }
  }
  const out = new Map(); // `${season}|${teamId}` -> {venue, label, teamQid} | {absent}
  for (const [key, it] of items) {
    if (!it.teamQid) out.set(key, { absent: it.absent });
    else {
      const v = venueFor(venues.get(it.teamQid) ?? [], key.split("|")[0]);
      out.set(key, v.venue ? { ...v, teamQid: it.teamQid, votes: it.votes, of: it.of } : { absent: v.absent, teamQid: it.teamQid });
    }
  }
  log(`nba arenas: ${[...out.values()].filter((v) => v.venue).length} of ${out.size} team-seasons`);
  return { arenas: out, venues, venueInfo };
}

// ------------------------------------------------------------------------------------------------ place records

const unzipStream = (zipFile) => spawn("unzip", ["-p", zipFile], { stdio: ["ignore", "pipe", "inherit"] }).stdout;

async function placeRecords(client, graph, log) {
  const gaz = await client.request(URLS.gazetteer, { purpose: "place-records" });
  const cities = await client.request(URLS.geonamesCities, { purpose: "place-records" });
  const admin1 = await client.request(URLS.geonamesAdmin1, { purpose: "place-records" });
  const countries = await client.request(URLS.geonamesCountries, { purpose: "place-records" });

  const countryName = new Map();
  for (const line of countries.buf.toString("utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f[0] && f[4]) countryName.set(f[0], f[4].trim());
  }
  const admin1Name = new Map();
  for (const line of admin1.buf.toString("utf8").split("\n")) {
    const f = line.split("\t");
    if (f[0] && f[1]) admin1Name.set(f[0], f[1].trim());
  }

  const gazByGeoid = new Map();
  const gazByAnsi = new Map();
  const gazZip = client.bodyPath(URLS.gazetteer);
  await readTable(gazZip, ["USPS", "GEOID", "ANSICODE", "INTPTLAT", "INTPTLONG"], (r) => {
    const rec = {
      placeId: `census-place:${r.GEOID}`,
      source: "census-gazetteer",
      upstreamId: r.GEOID,
      ansicode: r.ANSICODE,
      cc: "US",
      regionCode: `US.${r.USPS}`,
      region: admin1Name.get(`US.${r.USPS}`) ?? null,
      country: countryName.get("US") ?? null,
      lat: Number(r.INTPTLAT),
      lon: Number(r.INTPTLONG),
    };
    gazByGeoid.set(r.GEOID, rec);
    if (present(r.ANSICODE)) gazByAnsi.set(r.ANSICODE, rec);
  }, { sep: "\t", label: "Census Gazetteer places", input: unzipStream(gazZip) });
  log(`census gazetteer: ${gazByGeoid.size} places`);

  const wanted = new Set([...graph.values()].flatMap((n) => n.geonames));
  const geonames = new Map();
  let notCity = 0;
  const cols = [["id", 0], ["lat", 4], ["lon", 5], ["fclass", 6], ["fcode", 7], ["cc", 8], ["admin1", 10]];
  const citiesZip = client.bodyPath(URLS.geonamesCities);
  await readTable(citiesZip, cols, (r) => {
    if (!wanted.has(r.id)) return;
    if (r.fclass !== "P" || GEONAMES_NOT_CITY.has(r.fcode)) {
      notCity++;
      return;
    }
    geonames.set(r.id, {
      placeId: `geonames:${r.id}`,
      source: "geonames",
      upstreamId: r.id,
      cc: r.cc,
      fcode: r.fcode,
      regionCode: `${r.cc}.${r.admin1}`,
      region: admin1Name.get(`${r.cc}.${r.admin1}`) ?? null,
      country: countryName.get(r.cc) ?? null,
      lat: Number(r.lat),
      lon: Number(r.lon),
    });
  }, { sep: "\t", header: false, label: "GeoNames cities500", input: unzipStream(citiesZip) });
  log(`geonames: ${geonames.size} of ${wanted.size} wanted ids are cities in cities500 (${notCity} found but not a city of their own)`);
  return {
    gazByGeoid,
    gazByAnsi,
    geonames,
    retrievedAt: { gazetteer: gaz.meta.retrievedAt, geonames: cities.meta.retrievedAt, admin1: admin1.meta.retrievedAt, countries: countries.meta.retrievedAt },
  };
}

// ------------------------------------------------------------------------------------------------ records

/** The birth fields and their citations for a resolved birthplace, or null. */
export function birthFields(res, graph, retrievedAt) {
  if (!res || !res.settlement) return null;
  const rec = res.rec;
  const f = { birthCity: graph.get(res.settlement).label };
  if (present(rec.region ?? "")) f.birthRegion = rec.region;
  if (present(rec.country ?? "")) f.birthCountry = rec.country;
  const rest = ["birthRegion", "birthCountry"].filter((k) => k in f);
  const sources = [{ sourceId: "wikidata", upstreamId: res.path[0], url: URLS.wikidataItem(res.playerQid), retrievedAt: retrievedAt.wikidata, fields: ["birthCity"] }];
  if (rec.source === "census-gazetteer") {
    sources.push({ sourceId: "census-gazetteer", upstreamId: rec.upstreamId, url: URLS.gazetteer, retrievedAt: retrievedAt.gazetteer, fields: ["birthCity"] });
    if (rest.length) sources.push({ sourceId: "geonames", upstreamId: rec.regionCode, url: URLS.geonamesAdmin1, retrievedAt: retrievedAt.admin1, fields: rest });
  } else {
    sources.push({ sourceId: "geonames", upstreamId: rec.upstreamId, url: URLS.geonamesPlace(rec.upstreamId), retrievedAt: retrievedAt.geonames, fields: ["birthCity", ...rest] });
  }
  return { fields: f, sources };
}

const placeOf = (places, placeId) => (placeId.startsWith("census-place:") ? places.gazByGeoid.get(placeId.slice(13)) : places.geonames.get(placeId.slice(9)));

/** "Point(lon lat)" -> [lon, lat], or null. */
const point = (wkt) => {
  const m = wkt && wkt.match(/^Point\(([-0-9.eE]+) ([-0-9.eE]+)\)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

async function main() {
  const a = args(process.argv.slice(2));
  const t0 = Date.now();
  const log = (m) => console.error(`[athletes ${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
  const dataRoot = a["data-root"] ?? process.env.GROUNDTRUTH_DATA_ROOT ?? path.join(homedir(), "datastore", "groundtruth-snapshots");
  const date = a.date ?? new Date().toISOString().slice(0, 10);
  const nflDir = a["nfl-cache"] ?? path.join(homedir(), "vector-gridiron", "pipeline", "cache");
  const nbaCache = a["nba-cache"] ?? path.join(homedir(), "vector-hoops", "pipeline", "cache");
  const nbaLogs = a["nba-logs"] ?? path.join(homedir(), "vector-hoops", "pipeline", "data");
  const sha = gitSha();
  const outDir = path.join(dataRoot, "athletes", date);
  mkdirSync(outDir, { recursive: true });
  const client = makeClient({ rawDir: path.join(dataRoot, "raw", "athletes"), log, offline: a.offline });

  // ---- league sources
  const nfl = await readNfl(nflDir, log);
  const nba = await readNba(nbaCache, nbaLogs, log);
  const teamsResp = await client.request(URLS.nflTeams, { purpose: "nfl-teams" });
  const nflTeam = new Map();
  {
    const lines = teamsResp.buf.toString("utf8").split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
    const h = splitCsvLine(lines[0]);
    const ia = h.indexOf("team_abbr");
    const inm = h.indexOf("team_name");
    if (ia < 0 || inm < 0) throw new Error("teams_colors_logos.csv lacks team_abbr or team_name; refusing to guess");
    for (const l of lines.slice(1)) {
      const f = splitCsvLine(l);
      if (present(f[ia]) && present(f[inm])) nflTeam.set(f[ia], f[inm]);
    }
  }
  const nflArenas = homeArenas(nfl.games);

  // ---- Wikidata players
  const nbaIds = [...new Set([...nba.seasons.keys()].map((k) => k.split("|")[0]))];
  const nflIds = [...new Set([...nfl.seasons.keys()].map((k) => k.split("|")[0]))].filter((i) => nfl.players.has(i));
  const pfrOf = (p) => (present(p.pfr_id) ? `${p.pfr_id[0]}/${p.pfr_id}` : null);
  const pfrVals = nflIds.map((i) => pfrOf(nfl.players.get(i))).filter(Boolean);
  const espnVals = nflIds.map((i) => nfl.players.get(i).espn_id).filter(present);
  const wdNba = await wikidataPlayers(client, WD.nba, nbaIds, "players-nba", log);
  const wdPfr = await wikidataPlayers(client, WD.pfr, pfrVals, "players-nfl-pfr", log);
  const wdEspn = await wikidataPlayers(client, WD.espn, espnVals, "players-nfl-espn", log);
  const wikidataRetrieved = iso(Date.now());

  const playerItem = new Map(); // athlete id -> [player QIDs]
  for (const id of nbaIds) if (wdNba.byValue.has(id)) playerItem.set(`nba:${id}`, [...wdNba.byValue.get(id)]);
  for (const id of nflIds) {
    const p = nfl.players.get(id);
    const qs = new Set([...(wdPfr.byValue.get(pfrOf(p)) ?? []), ...(present(p.espn_id) ? wdEspn.byValue.get(p.espn_id) ?? [] : [])]);
    if (qs.size) playerItem.set(`nfl:${id}`, [...qs]);
  }
  const claimedBy = new Map();
  for (const [aid, qs] of playerItem) for (const q of qs) claimedBy.set(q, [...(claimedBy.get(q) ?? []), aid]);
  const allP19 = new Map([...wdNba.p19, ...wdPfr.p19, ...wdEspn.p19]);
  const soleItem = (aid) => {
    const qs = playerItem.get(aid);
    return qs && qs.length === 1 && claimedBy.get(qs[0]).length === 1 ? qs[0] : null;
  };

  // ---- NBA arenas (dated P115 on the team item found by roster vote)
  const rosters = new Map();
  for (const k of nba.seasons.keys()) {
    const [pid, season, teamId] = k.split("|");
    const q = soleItem(`nba:${pid}`);
    const rk = `${season}|${teamId}`;
    if (!rosters.has(rk)) rosters.set(rk, []);
    if (q) rosters.get(rk).push(q);
  }
  const nbaPlayerQids = [...new Set([...rosters.values()].flat())];
  const nbaAr = await nbaArenas(client, rosters, nbaPlayerQids, log);

  // ---- birthplaces under A5a
  const startPlaces = [];
  for (const aid of playerItem.keys()) {
    const q = soleItem(aid);
    if (q) for (const p of allP19.get(q) ?? []) startPlaces.push(p);
  }
  const graph = await placeGraph(client, startPlaces, log);
  const places = await placeRecords(client, graph, log);
  const retrievedAt = { wikidata: wikidataRetrieved, ...places.retrievedAt };

  const birth = new Map();
  const outcomes = { NBA: {}, NFL: {} };
  for (const aid of [...nbaIds.map((i) => `nba:${i}`), ...nflIds.map((i) => `nfl:${i}`)]) {
    const league = aid.startsWith("nba:") ? "NBA" : "NFL";
    const qs = playerItem.get(aid);
    let res;
    if (!qs) res = { outcome: "absent-no-wikidata-item" };
    else if (qs.length > 1) res = { outcome: "absent-ids-resolve-to-several-items" };
    else if (claimedBy.get(qs[0]).length > 1) res = { outcome: "absent-item-shared-by-several-athletes" };
    else {
      const p19 = [...(allP19.get(qs[0]) ?? [])];
      res = p19.length === 0 ? { outcome: "absent-no-p19" } : resolveBirthplace(p19, graph, places);
      res.playerQid = qs[0];
    }
    bump(outcomes[league], res.outcome);
    birth.set(aid, res);
  }

  // ---- records
  const records = { NBA: [], NFL: [] };
  const left = { NBA: {}, NFL: {} };
  const arenaAbsent = { NBA: {}, NFL: {} };
  const invalid = {};
  const seen = new Set();
  const emit = (league, rec) => {
    const errs = validateAthlete(rec);
    const key = recordKey(rec);
    if (seen.has(key)) errs.push({ code: "duplicate", path: "/id" });
    seen.add(key);
    if (errs.length) for (const e of errs) bump(invalid, `${league} ${e.code} ${e.path}`);
    else records[league].push(rec);
  };
  const addBirth = (rec, aid) => {
    const b = birthFields(birth.get(aid), graph, retrievedAt);
    if (!b) return;
    Object.assign(rec, b.fields);
    rec.sources.push(...b.sources);
  };

  for (const [k, e] of [...nba.seasons.entries()].sort()) {
    const [pid, season, teamId] = k.split("|");
    const team = nba.teamNames.get(`${season}|${teamId}`);
    if (!team) {
      bump(left.NBA, "no TEAM_NAME for the TEAM_ID in that season's leaguedashteamstats");
      continue;
    }
    const name = [...e.names.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const rec = { schemaVersion: "athlete/1", id: `nba:${pid}`, name, league: "NBA", team: team.name, season };
    rec.sources = [
      { sourceId: "nba-stats", upstreamId: pid, url: e.cite.url, retrievedAt: e.cite.retrievedAt, fields: ["name", "league", "season"] },
      { sourceId: "nba-stats", upstreamId: teamId, url: team.cite.url, retrievedAt: team.cite.retrievedAt, fields: ["team"] },
    ];
    const ar = nbaAr.arenas.get(`${season}|${teamId}`);
    if (ar?.venue) {
      rec.arena = ar.label;
      rec.sources.push({ sourceId: "wikidata", upstreamId: ar.venue, url: URLS.wikidataItem(ar.teamQid), retrievedAt: wikidataRetrieved, fields: ["arena"] });
    } else bump(arenaAbsent.NBA, ar?.absent ?? "no roster vote for the team-season");
    addBirth(rec, `nba:${pid}`);
    emit("NBA", rec);
  }

  for (const [k, cite] of [...nfl.seasons.entries()].sort()) {
    const [gsis, season, abbr] = k.split("|");
    const p = nfl.players.get(gsis);
    if (!p || !present(p.display_name)) {
      bump(left.NFL, "gsis_id not in players.csv, or no display_name");
      continue;
    }
    const teamName = nflTeam.get(abbr);
    if (!teamName) {
      bump(left.NFL, `team abbreviation ${abbr} is not in teams_colors_logos.csv`);
      continue;
    }
    if (abbr === "WAS" && Number(season) < 2022) {
      bump(left.NFL, "WAS before 2022: teams_colors_logos.csv carries only the current name (Washington Commanders), not the name that season");
      continue;
    }
    const rec = { schemaVersion: "athlete/1", id: `nfl:${gsis}`, name: p.display_name, league: "NFL", team: teamName, season };
    rec.sources = [
      { sourceId: "nflverse-players", upstreamId: gsis, url: URLS.nflPlayers, retrievedAt: nfl.files.players.retrievedAt, fields: ["name"] },
      { sourceId: cite.sourceId, upstreamId: gsis, url: cite.url, retrievedAt: cite.retrievedAt, fields: ["league", "team", "season"] },
      { sourceId: "nflverse-teams", upstreamId: abbr, url: URLS.nflTeams, retrievedAt: teamsResp.meta.retrievedAt, fields: ["team"] },
    ];
    if (present(p.college_name)) {
      rec.school = p.college_name;
      rec.sources[0].fields.push("school");
    }
    const ar = nflArenas.get(`${season}|${abbr}`);
    if (ar && !ar.tie) {
      rec.arena = ar.stadium;
      rec.sources.push({ sourceId: "nflverse-games", upstreamId: ar.stadiumId, url: URLS.nflGames, retrievedAt: nfl.files.games.retrievedAt, fields: ["arena"] });
    } else bump(arenaAbsent.NFL, ar?.tie ? "a tie between two home stadiums" : "no regular-season home game for the team-season in games.csv");
    addBirth(rec, `nfl:${gsis}`);
    emit("NFL", rec);
  }

  // ---- A5a trace check on every shipped record
  const traceByAthlete = new Map();
  for (const [aid, res] of birth) if (res.settlement) traceByAthlete.set(aid, { id: aid, p19: res.path[0], path: res.path, settlement: res.settlement, placeId: res.placeId, via: res.via, outcome: res.outcome });
  let traceChecked = 0;
  const traceFailures = [];
  for (const rec of [...records.NBA, ...records.NFL]) {
    if (!("birthCity" in rec)) continue;
    traceChecked++;
    const probs = traceProblems(rec, traceByAthlete.get(rec.id), graph, places);
    if (probs.length) traceFailures.push({ id: rec.id, season: rec.season, problems: probs });
  }
  if (traceFailures.length) {
    writeFileSync(path.join(outDir, "trace-failures.json"), JSON.stringify(traceFailures.slice(0, 200), null, 1));
    throw new Error(`${traceFailures.length} records fail the A5a trace check; see ${shown(outDir)}/trace-failures.json`);
  }

  // ---- aggregates
  const schoolAgg = new Map();
  const cityAgg = new Map();
  const cover = { NBA: {}, NFL: {} };
  const perSeason = { NBA: {}, NFL: {} };
  const athletes = { NBA: new Set(), NFL: new Set() };
  for (const league of ["NBA", "NFL"]) {
    for (const rec of records[league]) {
      bump(perSeason[league], rec.season);
      for (const f of ["team", "teamCity", "arena", "season", "school", "birthCity", "birthRegion", "birthCountry"]) if (f in rec) bump(cover[league], f);
      if (athletes[league].has(rec.id)) continue;
      athletes[league].add(rec.id);
      if (rec.school) {
        const k = `${league}|${rec.school}`;
        const e = schoolAgg.get(k) ?? { school: rec.school, league, source: "nflverse-players college_name", athletes: 0, athleteIds: [] };
        e.athletes++;
        e.athleteIds.push(rec.id);
        schoolAgg.set(k, e);
      }
      const t = traceByAthlete.get(rec.id);
      if (rec.birthCity && t) {
        const pr = placeOf(places, t.placeId);
        const e = cityAgg.get(t.placeId) ?? {
          placeId: t.placeId,
          wikidata: t.settlement,
          name: rec.birthCity,
          region: rec.birthRegion ?? null,
          country: rec.birthCountry ?? null,
          lon: pr.lon,
          lat: pr.lat,
          coordinateSource: pr.source,
          athletes: { NBA: 0, NFL: 0 },
          athleteIds: [],
        };
        e.athletes[league]++;
        e.athleteIds.push(rec.id);
        cityAgg.set(t.placeId, e);
      }
    }
  }
  const arenaAgg = new Map();
  for (const g of nfl.games) {
    if (!present(g.stadium_id)) continue;
    const e = arenaAgg.get(`nflverse:${g.stadium_id}`) ?? { arenaId: `nflverse:${g.stadium_id}`, league: "NFL", source: "nflverse-games", names: {}, games: 0, byGameType: {}, homeGamesByTeam: {}, firstSeason: g.season, lastSeason: g.season, lon: null, lat: null, coordinatesAbsentBecause: "games.csv has no coordinates and stadiums are not joined to another source by name" };
    e.games++;
    bump(e.byGameType, g.game_type);
    if (present(g.stadium)) bump(e.names, g.stadium);
    if (g.location === "Home") bump(e.homeGamesByTeam, g.home_team);
    if (g.season < e.firstSeason) e.firstSeason = g.season;
    if (g.season > e.lastSeason) e.lastSeason = g.season;
    arenaAgg.set(e.arenaId, e);
  }
  for (const [k, ar] of nbaAr.arenas) {
    if (!ar.venue) continue;
    const [season, teamId] = k.split("|");
    const info = nbaAr.venueInfo.get(ar.venue);
    const pt = point(info?.coord);
    const e = arenaAgg.get(`wikidata:${ar.venue}`) ?? { arenaId: `wikidata:${ar.venue}`, league: "NBA", source: "wikidata", names: { [ar.label]: 0 }, games: null, gamesAbsentBecause: "the cached NBA game logs do not say which team was at home", teamSeasons: [], lon: pt ? pt[0] : null, lat: pt ? pt[1] : null };
    e.names[ar.label]++;
    e.teamSeasons.push({ season, team: nba.teamNames.get(k)?.name ?? null, teamItem: ar.teamQid });
    arenaAgg.set(e.arenaId, e);
  }

  // ---- write
  const write = (name, rows, format) => {
    const full = path.join(outDir, name);
    writeFileSync(full, format === "jsonl" ? rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "") : JSON.stringify(rows));
    return { path: name, format, records: Array.isArray(rows) ? rows.length : Object.keys(rows).length, bytes: statSync(full).size, sha256: sha256File(full) };
  };
  const traces = [...traceByAthlete.values()];
  const files = [
    write("nba.jsonl", records.NBA, "jsonl"),
    write("nfl.jsonl", records.NFL, "jsonl"),
    write("birth-trace.jsonl", traces, "jsonl"),
    write("schools.jsonl", [...schoolAgg.values()].sort((x, y) => y.athletes - x.athletes), "jsonl"),
    write("birth-cities.jsonl", [...cityAgg.values()].sort((x, y) => y.athleteIds.length - x.athleteIds.length), "jsonl"),
    write("arenas.jsonl", [...arenaAgg.values()], "jsonl"),
    write("wikidata-places.json", Object.fromEntries(graph), "json"),
    write("place-records.json", Object.fromEntries(traces.map((t) => [t.placeId, placeOf(places, t.placeId)])), "json"),
  ];

  const coverage = {};
  for (const league of ["NBA", "NFL"]) {
    const n = records[league].length;
    const c = (f) => ({ have: cover[league][f] ?? 0, of: n });
    coverage[league] = {
      records: n,
      athletes: athletes[league].size,
      team: c("team"),
      season: c("season"),
      teamCity: { ...c("teamCity"), absentBecause: "no league-published team city in the keyless sources read here: stats.nba.com is not reachable from this box and nflverse's teams file has no city column; never derived from the team's name" },
      arena: { ...c("arena"), absentBecause: arenaAbsent[league] },
      school:
        league === "NBA"
          ? { ...c("school"), absentBecause: "the NBA's school field (commonplayerinfo SCHOOL) was not read: stats.nba.com timed out and cdn.nba.com answered 403 to a plain keyless request on 2026-10-19; it is not taken from any other source, and no browser is impersonated" }
          : { ...c("school"), absentBecause: "college_name is empty in players.csv for the player" },
      birthCity: { ...c("birthCity"), absentBecause: "rule A5a leaves out every birthplace it cannot trace by ids; see birthplace.outcomesPerAthlete" },
      birthRegion: { ...c("birthRegion"), absentBecause: "GeoNames has no admin1 name for the place record's region code" },
      birthCountry: c("birthCountry"),
      perSeason: Object.fromEntries(Object.entries(perSeason[league]).sort()),
    };
  }

  const manifest = {
    schemaVersion: "athletes-manifest/1",
    snapshotId: `athletes.${date}`,
    createdAt: iso(Date.now()),
    builder: { ...BUILDER, gitSha: sha, repo: "https://github.com/jcdavis131/groundtruth" },
    recordSchemaVersion: "athlete/1",
    directory: `<data-root>/athletes/${date}`,
    policy: "apps/map/docs/PEOPLE.md, Athletes: C5, C6, A1-A10 and A5a; data/athletes/allowlist.json",
    userAgent: UA,
    sources: SOURCES,
    counts: { NBA: { records: records.NBA.length, athletes: athletes.NBA.size }, NFL: { records: records.NFL.length, athletes: athletes.NFL.size } },
    coverage,
    birthplace: {
      rule: 'A5a (Cam 2026-10-19, "go ahead with A5a")',
      outcomesPerAthlete: outcomes,
      definitions: {
        ...OUTCOMES,
        "absent-no-wikidata-item": "no Wikidata item carries the athlete's league id",
        "absent-ids-resolve-to-several-items": "the athlete's league ids point at more than one Wikidata item",
        "absent-item-shared-by-several-athletes": "one Wikidata item carries the league ids of more than one athlete",
        "absent-no-p19": "the Wikidata item has no place of birth",
      },
      traceCheck: { recordsChecked: traceChecked, failures: traceFailures.length },
      settlementClass: "Q486972",
      finerClasses: FINER,
      coarserClasses: COARSER,
      placeItems: graph.size,
      placeRecords: { censusGazetteerPlaces: places.gazByGeoid.size, geonamesCitiesMatched: places.geonames.size, geonamesExcludedCodes: [...GEONAMES_NOT_CITY] },
    },
    nbaArenas: {
      method: `team item = the NBA team item (P118 ${NBA_LEAGUE}) that at least ${MIN_VOTES} roster players and ${MIN_SHARE * 100}% of the voting ones were on (dated P54) on Jan 1 of the season; arena = the one dated P115 statement covering Nov 1 of the season's first year; any undated P115 statement leaves it out`,
      teamSeasons: nbaAr.arenas.size,
      withArena: [...nbaAr.arenas.values()].filter((v) => v.venue).length,
      byReason: Object.entries([...nbaAr.arenas.values()].filter((v) => !v.venue).reduce((o, v) => (bump(o, v.absent), o), {})).map(([reason, n]) => ({ reason, teamSeasons: n })),
    },
    wikidata: {
      properties: { nbaPlayerId: WD.nba, pfrPlayerId: WD.pfr, espnNflPlayerId: WD.espn, placeOfBirth: "P19", locatedIn: "P131", country: "P17/P297", fips: "P774", gnis: "P590", geonames: "P1566", memberOfTeam: "P54", homeVenue: "P115", start: "P580", end: "P582", coordinates: "P625 (venues only)" },
      neverAsked: "P569 (date of birth) and the other personal properties lib/net.mjs refuses",
      matched: {
        nbaIds: { asked: nbaIds.length, onAnItem: wdNba.byValue.size },
        nflPfrIds: { asked: pfrVals.length, onAnItem: wdPfr.byValue.size },
        nflEspnIds: { asked: espnVals.length, onAnItem: wdEspn.byValue.size },
      },
    },
    inputs: {
      nfl: {
        note: "Local copies cached by vector-gridiron from the nflverse URLs; retrievedAt is each file's modification time.",
        players: { ...nfl.files.players, path: shown(nfl.files.players.path), columnsRead: ["gsis_id", "display_name", "college_name", "pfr_id (Wikidata join key only)", "espn_id (Wikidata join key only)"] },
        playerSeasons: nfl.files.seasons.map((f) => ({ ...f, path: shown(f.path) })),
        games: { ...nfl.files.games, path: shown(nfl.files.games.path), columnsRead: ["season", "game_type", "home_team", "location", "stadium_id", "stadium"] },
      },
      nba: {
        note: "Local copies cached by vector-hoops (nba_api playergamelogs and leaguedashteamstats); retrievedAt is each file's modification time. The seasons are the ones those caches hold.",
        columnsRead: ["PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "GAME_ID (only to skip preseason and All-Star games)", "TEAM_NAME"],
        gamelogs: nba.files.logs.map((f) => ({ ...f, path: shown(f.path) })),
        teams: nba.files.teams.map((f) => ({ ...f, path: shown(f.path) })),
      },
    },
    leftOut: left,
    invalid,
    files,
    requests: client.requests,
    runSeconds: Math.round((Date.now() - t0) / 1000),
  };
  const mjson = JSON.stringify(manifest, null, 1) + "\n";
  writeFileSync(path.join(outDir, "manifest.json"), mjson);
  const committed = path.join(HERE, "manifests", `athletes.${date}.json`);
  mkdirSync(path.dirname(committed), { recursive: true });
  writeFileSync(committed, mjson);
  log(`done: NBA ${records.NBA.length} records, NFL ${records.NFL.length}; invalid ${JSON.stringify(invalid)}`);
  if (Object.keys(invalid).length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.stack ?? e.message);
    process.exitCode = 1;
  });
}
