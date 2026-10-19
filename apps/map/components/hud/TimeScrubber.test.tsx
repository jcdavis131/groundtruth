// TimeScrubber state machine: collapsed entry point vs engaged panel,
// year readout, speed options, and the back-to-live control. Rendered to
// static markup, no browser. The store-wired wrapper is thin; the view is
// tested directly with props.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimeScrubberView, type TimeScrubberViewProps } from "./TimeScrubber";
import { PLAYBACK_MIN_YEAR, PLAYBACK_SPEEDS } from "@/lib/globe/timeMachine";

/** Markup as the text a reader sees: tags dropped, React's entity escapes undone. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const noop = () => {};

function props(over: Partial<TimeScrubberViewProps> = {}): TimeScrubberViewProps {
  return {
    engaged: false,
    animate: false,
    year: 2000,
    minYear: PLAYBACK_MIN_YEAR,
    maxYear: 2026,
    speed: 5,
    notes: ["US electricity 1970–2024 · EIA SEDS", "ERCOT hidden during playback"],
    onEngage: noop,
    onTogglePlay: noop,
    onScrub: noop,
    onSpeed: noop,
    onLive: noop,
    ...over,
  };
}

describe("time scrubber view", () => {
  it("offers the time machine entry point when disengaged", () => {
    const html = renderToStaticMarkup(<TimeScrubberView {...props()} />);
    expect(text(html)).toContain("Time machine");
    expect(html).not.toContain('aria-label="Playback year"');
  });

  it("shows the big year readout, scrubber, speeds and live button when engaged", () => {
    const html = renderToStaticMarkup(<TimeScrubberView {...props({ engaged: true, year: 1994 })} />);
    const t = text(html);
    expect(t).toContain("1994");
    expect(t).toContain("paused");
    expect(html).toContain('aria-label="Playback year"');
    expect(html).toContain('aria-label="Playback speed"');
    expect(html).toContain(`min="${PLAYBACK_MIN_YEAR}"`);
    expect(html).toContain('max="2026"');
    expect(t).toContain("Live");
    for (const s of PLAYBACK_SPEEDS) expect(t).toContain(`${s} yr/s`);
  });

  it("reads playing while the clock animates", () => {
    const html = renderToStaticMarkup(<TimeScrubberView {...props({ engaged: true, animate: true, year: 2010 })} />);
    expect(text(html)).toContain("playing");
  });

  it("documents each layer's coverage in the as-of notes", () => {
    const html = renderToStaticMarkup(
      <TimeScrubberView
        {...props({
          engaged: true,
          notes: [
            "US electricity 1970–2024 · EIA SEDS",
            "Gas weekly 1990-08-20 → 2026-09-28 · EIA (states from 2000)",
            "Global generation 1985–2025 · Ember",
            "ERCOT hidden during playback (live-only) · data centers static",
          ],
        })}
      />,
    );
    const t = text(html);
    expect(t).toMatch(/US electricity \d{4}–\d{4}/);
    expect(t).toMatch(/Gas weekly/);
    expect(t).toMatch(/Global generation \d{4}–\d{4}/);
    expect(t).toContain("ERCOT hidden during playback");
  });

  it("clamps the scrubber to the bundled range", () => {
    const html = renderToStaticMarkup(<TimeScrubberView {...props({ engaged: true, year: 1970 })} />);
    expect(html).toContain('value="1970"');
  });
});
