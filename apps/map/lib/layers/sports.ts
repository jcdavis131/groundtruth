// Layer: sports. Live and scheduled games today from ESPN's keyless
// scoreboard feeds (college football, MLB, NFL, Premier League).
// Markers sit on the venue, coloured by status: green = live now,
// amber = upcoming, grey = final. Scores and statuses are ESPN's
// as-reported; events whose venue has not been geocoded yet are skipped
// (the count is reported, never faked).

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import type { GameState, SportsEvent } from "@/app/api/sports/route";

interface SportsPayload {
  leagues: Record<
    string,
    { id: string; label: string; ok: boolean; events: SportsEvent[]; resolving: number; error?: string }
  >;
  failed: string[];
}

const LEAGUE_LABEL: Record<string, string> = {
  cfb: "College football",
  mlb: "MLB",
  nfl: "NFL",
  epl: "Premier League",
};

function scoreLine(e: SportsEvent): string {
  if (e.state === "pre" || e.awayScore == null || e.homeScore == null)
    return `${e.awayAbbr} @ ${e.homeAbbr}`;
  return `${e.awayAbbr} ${e.awayScore} · ${e.homeAbbr} ${e.homeScore}`;
}

function stateWord(s: GameState): string {
  return s === "in" ? "live" : s === "pre" ? "upcoming" : "final";
}

async function fetchSports(ctx: FetchContext): Promise<FetchResult> {
  const env = await proxy<SportsPayload>("/api/sports", ctx);
  const features: LayerFeature<Point>[] = [];
  let live = 0;
  let upcoming = 0;
  let final = 0;
  let resolving = 0;
  for (const league of Object.values(env.data.leagues)) {
    resolving += league.resolving;
    for (const e of league.events) {
      if (e.lat == null || e.lon == null) continue;
      if (e.state === "in") live++;
      else if (e.state === "pre") upcoming++;
      else final++;
      const when = Number.isFinite(Date.parse(e.date))
        ? new Date(e.date).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : e.date;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.lon, e.lat, 0] },
        properties: {
          id: e.id,
          layer: "sports",
          name: scoreLine(e),
          kind: e.state,
          altitude: 0,
          observedAt: Number.isFinite(Date.parse(e.date)) ? Date.parse(e.date) : undefined,
          source: "ESPN",
          details: {
            league: LEAGUE_LABEL[e.league] ?? e.league,
            matchup: `${e.awayName} @ ${e.homeName}`,
            status: `${stateWord(e.state)}${e.detail ? ` · ${e.detail}` : ""}`,
            score:
              e.awayScore != null && e.homeScore != null
                ? `${e.awayAbbr} ${e.awayScore} – ${e.homeScore} ${e.homeAbbr}`
                : null,
            venue: [e.venueName, e.venueCity, e.venueState].filter(Boolean).join(", ") || null,
            "start (local)": when,
            broadcast: e.broadcast,
          },
          extra: { state: e.state, detail: e.detail },
        },
      });
    }
  }
  const failed = env.data.failed;
  return {
    collection: { type: "FeatureCollection", features },
    source: "ESPN",
    fetchedAt: Date.now(),
    note:
      `${live} live · ${upcoming} upcoming · ${final} final` +
      (resolving ? ` · ${resolving} venues still locating` : "") +
      (failed.length ? ` · unavailable: ${failed.join(", ")}` : ""),
  };
}

export const sportsLayer: LayerDefinition = {
  id: "sports",
  label: "Sports",
  description: "Live scores and today's games: college football, MLB, NFL, Premier League.",
  color: "#4ADE80",
  updateIntervalMs: 60_000,
  defaultEnabled: true,
  attribution: "ESPN",
  fetch: fetchSports,
};
