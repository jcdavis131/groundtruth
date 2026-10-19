// Space weather and the ISS live stream, fetched server-side. Route handlers
// only; the HUD reads the shapes below from /api/space.
//
//   GFZ Potsdam Kp         3-hourly planetary index, CC BY 4.0; recent values are
//                          marked preliminary ("pre") by GFZ and shown that way
//   NASA DONKI (CCMC)      solar flares (FLR) of the last 7 days and space-weather
//                          notifications of the last 3; "Experimental Research
//                          Information" by DONKI's own disclaimer
//   YouTube oEmbed         NASA's ISS stream, by its id, through YouTube's official
//                          oEmbed endpoint: embeddable, authored by NASA and titled
//                          as the Space Station stream, or not shown. No YouTube
//                          page is ever fetched: YouTube's Terms of Service bar
//                          automated access except to search engines.
//
// NOAA SWPC is the official US source for space-weather forecasts; its
// services reset connections from the machine this was built on, so it is not
// used here and the panel says where the official word lives.

import { cached } from "@/lib/server/cache";
import { polite, upstream, UpstreamError, upstreamJson } from "@/lib/server/upstream";
import { retrying } from "@/lib/server/net";
import { donkiSummary, issStreamFrom, parseKp, type GfzKpJson, type IssStream, type OEmbed, type SpaceWeather } from "./weather";

const MIN = 60_000;
const DONKI = "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function donki<T>(path: string): Promise<T[]> {
  const text = await retrying(async () => {
    const res = await polite("nasa-donki", 500, 60_000, () => upstream("nasa-donki", `${DONKI}/${path}`, { timeoutMs: 25_000 }));
    return (await res.text()).trim();
  }, 2);
  // DONKI answers an empty range with "[]" and sometimes with an empty body.
  if (!text) return [];
  return JSON.parse(text) as T[];
}

export function spaceWeather() {
  return cached("space:weather", 15 * MIN, async (): Promise<SpaceWeather> => {
    const now = Date.now();
    const hour = Math.floor(now / 3600_000) * 3600_000;
    const start = new Date(hour - 3 * 86_400_000).toISOString().slice(0, 19) + "Z";
    const end = new Date(hour).toISOString().slice(0, 19) + "Z";
    const flaresFrom = day(now - 7 * 86_400_000);
    const noticesFrom = day(now - 3 * 86_400_000);
    const [kp, flr, notif] = await Promise.allSettled([
      // The bare ?index=Kp answers with a redirect; ask for the window explicitly.
      retrying(
        () =>
          polite("gfz-kp", 500, 60_000, () =>
            upstreamJson<GfzKpJson>(
              "gfz-kp",
              `https://kp.gfz.de/app/json/?start=${start}&end=${end}&index=Kp`,
              { timeoutMs: 20_000 },
            ),
          ),
        2,
      ),
      donki<{ flrID: string; classType?: string; beginTime?: string; peakTime?: string; endTime?: string; sourceLocation?: string; activeRegionNum?: number; link?: string }>(
        `FLR?startDate=${flaresFrom}&endDate=${day(now)}`,
      ),
      donki<{ messageType: string; messageID: string; messageURL?: string; messageIssueTime: string; messageBody?: string }>(
        `notifications?startDate=${noticesFrom}&endDate=${day(now)}&type=all`,
      ),
    ]);
    const failed: string[] = [];
    const out: SpaceWeather = { kp: [], flares: null, notices: null, flaresFrom, noticesFrom, failed };
    if (kp.status === "fulfilled") {
      const parsed = parseKp(kp.value);
      out.kp = parsed.kp;
      out.kpLicense = parsed.license;
    } else failed.push("GFZ Kp");
    if (flr.status === "fulfilled") {
      out.flares = flr.value
        .map((f) => ({
          id: f.flrID,
          classType: f.classType,
          begin: f.beginTime,
          peak: f.peakTime,
          end: f.endTime,
          location: f.sourceLocation,
          region: f.activeRegionNum ?? undefined,
          link: f.link,
        }))
        .sort((a, b) => (b.peak ?? b.begin ?? "").localeCompare(a.peak ?? a.begin ?? ""));
    } else failed.push("DONKI flares");
    if (notif.status === "fulfilled") {
      out.notices = notif.value
        .map((m) => ({ id: m.messageID, type: m.messageType, issued: m.messageIssueTime, summary: donkiSummary(m.messageBody), url: m.messageURL }))
        .sort((a, b) => b.issued.localeCompare(a.issued))
        .slice(0, 12);
    } else failed.push("DONKI notifications");
    if (failed.length === 3) throw new Error("GFZ and DONKI both failed");
    return out;
  });
}

/**
 * NASA's continuous ISS stream on YouTube, as NASA's channel lists it
 * ("Live Video from the International Space Station (Official NASA Stream)",
 * checked through oEmbed 2026-09-26). When NASA replaces the stream this id
 * stops passing the check below and the dossier hides the block; update it
 * from NASA's channel by hand.
 */
export const ISS_STREAM_ID = "M3HKLzjvKPc";

/**
 * The ISS stream, confirmed through oEmbed only: the video must be embeddable
 * (oEmbed answers), authored by NASA's own channel (author_url, since display
 * names are not unique) and titled as the Space Station stream, so a launch or
 * a press conference is never embedded as the ISS view.
 */
export function issStream() {
  return cached("iss:stream", 30 * MIN, async (): Promise<IssStream> => {
    const checkedAt = Date.now();
    let o: OEmbed;
    try {
      o = await retrying(
        () =>
          polite("youtube-oembed", 2000, 5 * MIN, () =>
            upstreamJson<OEmbed>(
              "youtube-oembed",
              `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ISS_STREAM_ID}`)}&format=json`,
              { timeoutMs: 15_000 },
            ),
          ),
        2,
      );
    } catch (err) {
      // oEmbed answers 401/404 for a video that is private, removed or not embeddable.
      if (err instanceof UpstreamError && err.status >= 400 && err.status < 500) {
        return { available: false, reason: `oEmbed does not list stream ${ISS_STREAM_ID} as embeddable (${err.status})`, checkedAt };
      }
      throw err;
    }
    return issStreamFrom(ISS_STREAM_ID, o, checkedAt);
  });
}
