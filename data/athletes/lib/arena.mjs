// Home arenas for NBA team-seasons, from Wikidata's dated "home venue" (P115) statements. Plain Node.
//
// stats.nba.com's TEAM_ID has no Wikidata property, so the team item is found by ids, not by its name:
// the players on a team-season (by their NBA.com id, P3647) carry "member of sports team" (P54) statements
// with start and end dates; the NBA team item most of them were on at the season's midpoint is the team.
// Then the venue is the one P115 statement whose dates cover the season's opening month. Undated venue
// statements make the answer unknowable from dates, so the arena is left out; so is a tie or an overlap.

export const MIN_VOTES = 3;
export const MIN_SHARE = 0.6;

/** "2024-25" -> the dates the season is read at: Nov 1 of the first year (venue), Jan 1 of the second (roster). */
export function seasonDates(season) {
  const y = Number(season.slice(0, 4));
  return { venueAt: `${y}-11-01T00:00:00Z`, rosterAt: `${y + 1}-01-01T00:00:00Z` };
}

/** True when [start, end] covers `at`. Dates are Wikidata xsd:dateTime strings; a missing end is open. */
export function covers(start, end, at) {
  if (!start) return false;
  if (start > at) return false;
  return !end || end >= at;
}

/**
 * The Wikidata team item per `${season}|${teamId}`. `rosters` maps that key to the player QIDs on it;
 * `p54` maps a player QID to [{team, start, end}] restricted to NBA team items.
 * Returns Map key -> {teamQid, votes, of} | {absent}.
 */
export function teamItems(rosters, p54) {
  const out = new Map();
  for (const [key, players] of rosters) {
    const { rosterAt } = seasonDates(key.split("|")[0]);
    const votes = new Map();
    let voters = 0;
    for (const p of players) {
      const teams = new Set((p54.get(p) ?? []).filter((s) => covers(s.start, s.end, rosterAt)).map((s) => s.team));
      if (teams.size !== 1) continue; // traded around the midpoint, or undated: no vote
      voters++;
      const t = [...teams][0];
      votes.set(t, (votes.get(t) ?? 0) + 1);
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length || ranked[0][1] < MIN_VOTES) out.set(key, { absent: "fewer than 3 roster players have one dated NBA P54 team at the season's midpoint" });
    else if (ranked[0][1] / voters < MIN_SHARE) out.set(key, { absent: "no team item has 60% of the roster players' dated P54 votes" });
    else out.set(key, { teamQid: ranked[0][0], votes: ranked[0][1], of: voters });
  }
  // One team item for two TEAM_IDs in a season means the vote is wrong for at least one; drop both.
  const bySeasonItem = new Map();
  for (const [key, v] of out) if (v.teamQid) {
    const k = `${key.split("|")[0]}|${v.teamQid}`;
    bySeasonItem.set(k, [...(bySeasonItem.get(k) ?? []), key]);
  }
  for (const keys of bySeasonItem.values()) if (keys.length > 1) for (const k of keys) out.set(k, { absent: "the voted team item also won another TEAM_ID that season" });
  return out;
}

/**
 * Venues that name the team as an occupant (P466) and start after every P115 statement on the team item:
 * evidence of a move the team item does not record yet (the Clippers' P115 ends at Crypto.com Arena,
 * open-ended, while Intuit Dome lists them from 2024). Added as statements so the overlap leaves the arena
 * out for those seasons instead of naming the old one. `occupants` is [{venue, label, start, end}], start
 * being the P466 statement's P580 or else the venue's opening date (P1619).
 */
export function withOccupantMoves(p115, occupants) {
  const known = new Set(p115.map((s) => s.venue));
  const newest = p115.reduce((m, s) => (s.start && s.start > m ? s.start : m), "");
  const moves = occupants.filter((o) => !known.has(o.venue) && o.start && o.start > newest);
  return [...p115, ...moves];
}

/**
 * The venue's name in a season: its one English official name (P1448) whose dates cover the season, else
 * its current label. Returns {name, from: "official-name" | "label"}.
 */
export function nameFor(names, label, season) {
  const { venueAt } = seasonDates(season);
  const hit = [...new Set(names.filter((n) => covers(n.start, n.end, venueAt)).map((n) => n.name))];
  return hit.length === 1 ? { name: hit[0], from: "official-name" } : { name: label, from: "label" };
}

/**
 * The venue for one season from a team item's P115 statements [{venue, label, start, end}] (deprecated
 * ones already removed). Returns {venue, label} | {absent}.
 */
export function venueFor(statements, season) {
  if (!statements.length) return { absent: "the team item has no home venue (P115)" };
  if (statements.some((s) => !s.start)) return { absent: "the team item has an undated home venue statement, so the dates cannot decide" };
  const { venueAt } = seasonDates(season);
  const hit = [...new Map(statements.filter((s) => covers(s.start, s.end, venueAt)).map((s) => [s.venue, s])).values()];
  if (hit.length === 0) return { absent: "no dated home venue covers the season" };
  if (hit.length > 1) return { absent: "two dated home venues overlap the season" };
  return { venue: hit[0].venue, label: hit[0].label };
}
