// Shapes /api/space returns, the one published scale the panel applies, and
// the pure parsers behind them (GFZ Kp, DONKI summaries, the ISS oEmbed
// check), so they are tested without a network. Safe to import from the
// browser (no server code).

export interface KpValue {
  time: string;
  kp: number;
  /** GFZ status as published: "pre" preliminary, "def" definitive. */
  status: string;
}

export interface Flare {
  id: string;
  classType?: string;
  begin?: string;
  peak?: string;
  end?: string;
  location?: string;
  region?: number;
  link?: string;
}

export interface Notice {
  id: string;
  type: string;
  issued: string;
  summary?: string;
  url?: string;
}

export interface SpaceWeather {
  kp: KpValue[];
  kpLicense?: string;
  /** null when DONKI did not answer; [] when it answered with nothing. */
  flares: Flare[] | null;
  notices: Notice[] | null;
  flaresFrom: string;
  noticesFrom: string;
  failed: string[];
}

export interface IssStream {
  available: boolean;
  videoId?: string;
  title?: string;
  author?: string;
  authorUrl?: string;
  /** Why the block is hidden, when it is. */
  reason?: string;
  checkedAt: number;
}

/** NOAA space-weather G-scale from Kp (NOAA SWPC's published table): Kp 5 = G1 … Kp 9 = G5. */
export function gScale(kp: number): string | null {
  if (kp >= 9) return "G5 extreme";
  if (kp >= 8) return "G4 severe";
  if (kp >= 7) return "G3 strong";
  if (kp >= 6) return "G2 moderate";
  if (kp >= 5) return "G1 minor";
  return null;
}

/** DONKI's own disclaimer, quoted in the panel. */
export const DONKI_DISCLAIMER =
  "NOAA's Space Weather Prediction Center is the United States Government official source for space weather forecasts. This \"Experimental Research Information\" consists of preliminary NASA research products and should be interpreted and used accordingly.";

// ---------------------------------------------------------------- parsers (pure; lib/space/sources.ts fetches)

/** GFZ's JSON answer for ?index=Kp: parallel arrays, as published. */
export interface GfzKpJson {
  Kp?: number[];
  datetime?: string[];
  status?: string[];
  meta?: { license?: string };
}

/** Kp values with their GFZ status; a negative or non-numeric value (GFZ's fill) is left out, never shown as 0. */
export function parseKp(j: GfzKpJson): { kp: KpValue[]; license?: string } {
  const n = Math.min(j.Kp?.length ?? 0, j.datetime?.length ?? 0);
  const kp: KpValue[] = [];
  for (let i = 0; i < n; i++) {
    const v = j.Kp![i];
    if (!Number.isFinite(v) || v < 0) continue;
    kp.push({ time: j.datetime![i], kp: v, status: j.status?.[i] ?? "" });
  }
  return { kp, license: j.meta?.license };
}

/** First paragraph under "## Summary:" in a DONKI message body, at most 360 characters. */
export function donkiSummary(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const i = body.indexOf("## Summary:");
  const rest = i >= 0 ? body.slice(i + "## Summary:".length) : body;
  const text = rest.split(/\n\s*\n##|\n##/)[0].replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 360) + (text.length > 360 ? "…" : "") : undefined;
}

/** NASA's own YouTube channel; display names are not unique, so the channel URL is what is checked. */
export const NASA_AUTHOR_URL = "https://www.youtube.com/@NASA";

/** The fields of YouTube's oEmbed answer the ISS check reads. */
export interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
}

/**
 * Whether a stream may be shown as NASA's ISS view, from YouTube's oEmbed
 * answer alone: on NASA's own channel and titled as the Space Station stream,
 * so a launch or a press conference is never embedded as the ISS view. (That
 * oEmbed answered at all is what says it is embeddable.)
 */
export function issStreamFrom(videoId: string, o: OEmbed, checkedAt: number): IssStream {
  if ((o.author_url ?? "").replace(/\/$/, "") !== NASA_AUTHOR_URL) {
    return { available: false, reason: `the stream's channel is ${o.author_url ?? "unknown"}, not ${NASA_AUTHOR_URL}`, checkedAt };
  }
  if (!/space station|\bISS\b/i.test(o.title ?? "")) {
    return { available: false, reason: `NASA's stream ${videoId} is not titled as the Space Station stream: ${o.title ?? "no title"}`, checkedAt };
  }
  return { available: true, videoId, title: o.title, author: o.author_name, authorUrl: o.author_url, checkedAt };
}
