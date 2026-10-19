import { describe, expect, it } from "vitest";
import { donkiSummary, gScale, issStreamFrom, NASA_AUTHOR_URL, parseKp } from "./weather";

describe("parseKp", () => {
  it("keeps GFZ's status per value and leaves out fills instead of showing them as 0", () => {
    const r = parseKp({
      Kp: [2.333, -1, 5.667, Number.NaN],
      datetime: ["2026-09-25T00:00:00Z", "2026-09-25T03:00:00Z", "2026-09-25T06:00:00Z", "2026-09-25T09:00:00Z"],
      status: ["def", "def", "pre", "pre"],
      meta: { license: "CC BY 4.0" },
    });
    expect(r.kp).toEqual([
      { time: "2026-09-25T00:00:00Z", kp: 2.333, status: "def" },
      { time: "2026-09-25T06:00:00Z", kp: 5.667, status: "pre" },
    ]);
    expect(r.license).toBe("CC BY 4.0");
  });
  it("reads nothing from an answer with no arrays, and an absent status as unknown, not preliminary", () => {
    expect(parseKp({}).kp).toEqual([]);
    expect(parseKp({ Kp: [1], datetime: ["t"] }).kp[0].status).toBe("");
  });
});

describe("gScale", () => {
  it("follows NOAA's published Kp to G table", () => {
    expect(gScale(4.667)).toBeNull();
    expect(gScale(5)).toBe("G1 minor");
    expect(gScale(7.333)).toBe("G3 strong");
    expect(gScale(9)).toBe("G5 extreme");
  });
});

describe("donkiSummary", () => {
  it("takes the paragraph under Summary and stops at the next heading", () => {
    const body = "## NASA Goddard Space Flight Center\n\nMessage Type: Space Weather Notification - FLR\n\n## Summary:\n\nM1.2 flare from Active Region 14200\npeaking at 2026-09-24T10:02Z.\n\n## Notes:\n\nnot this";
    expect(donkiSummary(body)).toBe("M1.2 flare from Active Region 14200 peaking at 2026-09-24T10:02Z.");
    expect(donkiSummary(undefined)).toBeUndefined();
    expect(donkiSummary("x".repeat(400))!.endsWith("…")).toBe(true);
  });
});

describe("issStreamFrom", () => {
  const at = Date.UTC(2026, 8, 26);
  it("shows the stream only when NASA's own channel titles it as the Space Station stream", () => {
    const ok = issStreamFrom("abc", { title: "Live Video from the International Space Station (Official NASA Stream)", author_name: "NASA", author_url: `${NASA_AUTHOR_URL}/` }, at);
    expect(ok).toEqual({
      available: true,
      videoId: "abc",
      title: "Live Video from the International Space Station (Official NASA Stream)",
      author: "NASA",
      authorUrl: `${NASA_AUTHOR_URL}/`,
      checkedAt: at,
    });
  });
  it("refuses another channel, even one named NASA", () => {
    const r = issStreamFrom("abc", { title: "ISS live", author_name: "NASA", author_url: "https://www.youtube.com/@someone" }, at);
    expect(r.available).toBe(false);
    expect(r.videoId).toBeUndefined();
    expect(r.reason).toMatch(/not https:\/\/www\.youtube\.com\/@NASA/);
  });
  it("refuses a NASA video that is not the station stream (a launch, a briefing)", () => {
    const r = issStreamFrom("abc", { title: "Artemis II Launch Coverage", author_url: NASA_AUTHOR_URL }, at);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/not titled as the Space Station stream/);
  });
});
