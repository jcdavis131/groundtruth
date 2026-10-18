// Live sports proxy: ESPN's keyless scoreboard endpoints, one call per league.
// Venues ship with city/state but no coordinates, so stadium locations are
// resolved once via Nominatim (1 req/s, cached forever in memory — a stadium
// does not move) and events at still-unresolved venues are skipped until
// their coordinates land. Scores and statuses are ESPN's as-reported.
//
//   /api/sports   -> { leagues: { cfb: {...}, mlb: {...}, nfl: {...}, epl: {...} } }

import { cached } from "@/lib/server/cache";
import { jsonError, polite, proxied, upstreamJson } from "@/lib/server/upstream";

const LEAGUES = [
  { id: "cfb", label: "College football", path: "football/college-football" },
  { id: "mlb", label: "MLB", path: "baseball/mlb" },
  { id: "nfl", label: "NFL", path: "football/nfl" },
  { id: "epl", label: "Premier League", path: "soccer/eng.1" },
] as const;

type LeagueId = (typeof LEAGUES)[number]["id"];

export type GameState = "pre" | "in" | "post";

export interface SportsEvent {
  id: string;
  league: LeagueId;
  name: string;
  shortName: string;
  /** ISO start time. */
  date: string;
  state: GameState;
  /** Human status: "Q3 4:32", "Final", "Sun 9/13, 12:00 PM CDT", ... */
  detail: string;
  awayAbbr: string;
  awayName: string;
  awayScore: string | null;
  homeAbbr: string;
  homeName: string;
  homeScore: string | null;
  venueName: string;
  venueCity: string;
  venueState: string;
  lat: number | null;
  lon: number | null;
  broadcast: string | null;
}

/** venue id -> coordinates. null = lookup failed; absent = not yet tried. */
const venueCache = new Map<string, { lat: number; lon: number } | null>();

interface EspnCompetitor {
  homeAway: string;
  winner?: boolean;
  score?: string;
  team: { abbreviation?: string; displayName?: string; shortDisplayName?: string };
}

interface EspnEvent {
  id: string;
  name: string;
  shortName: string;
  date: string;
  status: { type: { state: GameState; shortDetail?: string; detail?: string } };
  competitions: Array<{
    venue?: {
      id?: string;
      fullName?: string;
      address?: { city?: string; state?: string; country?: string };
    };
    competitors: EspnCompetitor[];
    broadcasts?: Array<{ names?: string[] }>;
  }>;
}

interface EspnScoreboard {
  events?: EspnEvent[];
}

async function geocodeVenue(
  venueId: string,
  query: string,
): Promise<{ lat: number; lon: number } | null> {
  const hit = await polite("nominatim", 1100, 60_000, () =>
    upstreamJson<Array<{ lat: string; lon: string }>>(
      "nominatim",
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
    ),
  ).catch(() => null);
  const first = hit?.[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function fetchLeague(
  league: (typeof LEAGUES)[number],
): Promise<{ events: SportsEvent[]; resolving: number }> {
  const sb = await cached(`espn:${league.id}`, 60_000, () =>
    upstreamJson<EspnScoreboard>(
      "espn",
      `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard`,
    ),
  );
  const raw: SportsEvent[] = [];
  const needGeo: Array<{ venueId: string; query: string }> = [];
  for (const e of sb.value.events ?? []) {
    const comp = e.competitions?.[0];
    if (!comp) continue;
    const away = comp.competitors.find((c) => c.homeAway === "away");
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const venue = comp.venue;
    const venueId = venue?.id ? `${league.id}:${venue.id}` : null;
    const addr = venue?.address ?? {};
    const city = addr.city ?? "";
    const state = addr.state ?? "";
    const query = [venue?.fullName, city, state, addr.country].filter(Boolean).join(", ");
    raw.push({
      id: `${league.id}:${e.id}`,
      league: league.id,
      name: e.name,
      shortName: e.shortName,
      date: e.date,
      state: e.status?.type?.state ?? "pre",
      detail:
        e.status?.type?.shortDetail ?? e.status?.type?.detail ?? "",
      awayAbbr: away?.team?.abbreviation ?? "AWY",
      awayName: away?.team?.displayName ?? "Away",
      awayScore: away?.score ?? null,
      homeAbbr: home?.team?.abbreviation ?? "HME",
      homeName: home?.team?.displayName ?? "Home",
      homeScore: home?.score ?? null,
      venueName: venue?.fullName ?? "",
      venueCity: city,
      venueState: state,
      lat: null,
      lon: null,
      broadcast: comp.broadcasts?.[0]?.names?.join("/") ?? null,
    });
    if (venueId) {
      const last = raw[raw.length - 1];
      (last as { venueId?: string }).venueId = venueId;
      if (!venueCache.has(venueId) && query) {
        needGeo.push({ venueId, query });
      }
    }
  }
  // Resolve a few new venues per refresh (Nominatim: 1 req/s, be polite).
  for (const g of needGeo.slice(0, 3)) {
    const coords = await geocodeVenue(g.venueId, g.query);
    venueCache.set(g.venueId, coords);
  }
  // Attach coordinates for everything the cache now knows.
  let resolving = 0;
  for (const ev of raw) {
    const vid = (ev as { venueId?: string }).venueId;
    if (!vid) continue;
    const c = venueCache.get(vid);
    if (c) {
      ev.lat = c.lat;
      ev.lon = c.lon;
    } else if (c === undefined) {
      resolving++;
    }
    delete (ev as { venueId?: string }).venueId;
  }
  return { events: raw, resolving: resolving + (needGeo.length > 3 ? needGeo.length - 3 : 0) };
}

export async function GET() {
  try {
    const settled = await Promise.all(
      LEAGUES.map((l) =>
        fetchLeague(l).then(
          (r) => ({ id: l.id as LeagueId, label: l.label, ok: true as const, ...r }),
          (err: unknown) => ({
            id: l.id as LeagueId,
            label: l.label,
            ok: false as const,
            events: [] as SportsEvent[],
            resolving: 0,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
      ),
    );
    const leagues: Record<string, unknown> = {};
    for (const s of settled) leagues[s.id] = s;
    const failed = settled.filter((s) => !s.ok).map((s) => s.label);
    return proxied(
      { leagues, failed },
      { source: "espn", note: failed.length ? `unavailable: ${failed.join(", ")}` : undefined },
    );
  } catch (err) {
    return jsonError(err);
  }
}
