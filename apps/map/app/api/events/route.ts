// Events API: GDELT 2.0 conflict events, coded automatically from news, folded
// into the cities they were coded at (lib/events/gdelt.ts has the rules: city-
// level only, conflict classes only, no actors, no article links).
//
//   /api/events?op=conflict&hours=1   the last `hours` (1 to 6) of GDELT's 15-minute
//                                     export files, folded into places
//
// Each export file is small (20-60 kB zipped) and never changes once
// published, so each is cached for six hours by its timestamp; lastupdate.txt,
// which names the newest, is asked at most every five minutes.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, polite, upstream } from "@/lib/server/upstream";
import { badRequest, ok, options, withCors } from "@/lib/server/respond";
import { retrying } from "@/lib/server/net";
import { firstEntryText } from "@/lib/server/zip";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { eventFeature, exportStamps, exportUrl, foldEvents } from "@/lib/events/gdelt";

export const maxDuration = 60;
export const OPTIONS = options;

const LAST_UPDATE = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";

async function lastUpdate(): Promise<string> {
  const r = await cached(
    "gdelt:lastupdate",
    5 * 60_000,
    () => retrying(() => polite("gdelt", 300, 60_000, async () => (await upstream("gdelt", LAST_UPDATE, { timeoutMs: 15_000, headers: { accept: "text/plain" } })).text()), 2),
    { deadlineMs: 20_000 },
  );
  return r.value;
}

async function exportText(stamp: string): Promise<string | null> {
  try {
    const r = await cached(
      `gdelt:export:${stamp}`,
      6 * 3600_000,
      async () => {
        const res = await retrying(() => polite("gdelt", 300, 60_000, () => upstream("gdelt", exportUrl(stamp), { timeoutMs: 20_000, headers: { accept: "application/zip" } })), 2);
        return firstEntryText(new Uint8Array(await res.arrayBuffer())).text;
      },
      { deadlineMs: 25_000 },
    );
    return r.value;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "conflict": {
        const raw = q.get("hours");
        const hours = raw == null || raw.trim() === "" ? 1 : Number(raw);
        if (!Number.isInteger(hours) || hours < 1 || hours > 6) return badRequest("hours is a whole number from 1 to 6, e.g. hours=1");
        const stamps = exportStamps(await lastUpdate(), hours * 4);
        const texts = await Promise.all(stamps.map(exportText));
        const got = stamps.filter((_, i) => texts[i] != null);
        if (!got.length) throw new Error("GDELT: no export file answered");
        const folded = foldEvents(texts.filter((t): t is string => t != null));
        const newest = got[0];
        const oldest = got[got.length - 1];
        const iso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}Z`;
        const windowText = `GDELT files ${iso(oldest)} to ${iso(newest)} (${got.length} of ${stamps.length} quarter hours)`;
        const features = folded.places.map((p) => eventFeature(p, windowText));
        const missing = stamps.filter((_, i) => texts[i] == null);
        const caveats = [
          "Events a machine coded from news reports (GDELT 2.0, CAMEO classes): counts of what reports described, not verified incidents, and the same incident reported twice can be two events.",
          "City-level locations and conflict classes (QuadClass 3 and 4) only; events geocoded only to a country or a state are counted in `leftOff`, not drawn at a centroid. No actor names and no article links are relayed.",
          "An event is coded when a report appears, so it can be older than the window: see each place's coded event dates.",
          "Cite the GDELT Project and link https://www.gdeltproject.org/ (its terms).",
        ];
        if (missing.length) caveats.push(`GDELT export file${missing.length === 1 ? "" : "s"} ${missing.join(", ")} did not answer; their events are missing, not absent.`);
        return ok(
          { type: "FeatureCollection", features },
          {
            meta: {
              source: "GDELT 2.0 Event Database",
              window: { from: iso(oldest), to: iso(newest), files: got.length, asked: stamps.length },
              places: features.length,
              events: folded.places.reduce((s, p) => s + p.events, 0),
              leftOff: { rowsRead: folded.rows, notConflict: folded.notConflict, notCityLevel: folded.notCityLevel, noPosition: folded.noPosition },
            },
            provenance: [
              provenance(source("gdelt"), {
                kind: "published",
                seriesId: `${got.length} export files, ${newest} back`,
                upstreamUrl: exportUrl(newest),
                period: `${iso(oldest)}/${iso(newest)}`,
                retrievedAt: new Date().toISOString(),
                notes: ["folded by city (ActionGeo_FeatureID); QuadClass 3 and 4 only; actor columns and SOURCEURL not relayed"],
              }),
            ],
            caveats,
            ttlS: 600,
          },
        );
      }
      default:
        return badRequest("unknown op: conflict");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
