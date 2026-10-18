import { describe, expect, it } from "vitest";
import { haversineM, parseGeosearch, parseOnThisDay, parseSummary, stripHtml } from "./client";

const GEOSEARCH = {
  query: {
    pages: {
      "1998": {
        pageid: 1998,
        title: "Austin, Texas",
        index: 1,
        coordinates: [{ lat: 30.26722, lon: -97.74306, primary: "" }],
        extract: "Austin is the capital city of Texas.",
        canonicalurl: "https://en.wikipedia.org/wiki/Austin,_Texas",
      },
      "42": {
        pageid: 42,
        title: "No coordinates here",
        index: 2,
        extract: "Cannot be drawn.",
        canonicalurl: "https://en.wikipedia.org/wiki/No_coordinates_here",
      },
      "7": {
        pageid: 7,
        title: "No extract",
        index: 3,
        coordinates: [{ lat: 30.27, lon: -97.74 }],
        fullurl: "https://en.wikipedia.org/wiki/No_extract",
      },
    },
  },
};

describe("parseGeosearch", () => {
  it("keeps only pages with coordinates and computes distance from the origin", () => {
    const out = parseGeosearch(GEOSEARCH, { lat: 30.2672, lon: -97.7431 });
    expect(out.map((a) => a.title)).toEqual(["Austin, Texas", "No extract"]);
    expect(out[0].pageid).toBe(1998);
    expect(out[0].distM).toBeLessThan(20);
    expect(out[0].extract).toContain("capital city");
    expect(out[0].url).toBe("https://en.wikipedia.org/wiki/Austin,_Texas");
    expect(out[1].extract).toBeUndefined();
    expect(out[1].distM).toBeGreaterThan(100);
  });

  it("tolerates empty and malformed answers", () => {
    expect(parseGeosearch(null)).toEqual([]);
    expect(parseGeosearch({})).toEqual([]);
    expect(parseGeosearch({ query: { pages: {} } })).toEqual([]);
  });
});

describe("parseSummary", () => {
  it("reads canonical title, extract, url and coordinates", () => {
    const s = parseSummary({
      titles: { canonical: "Travis County, Texas" },
      extract: "Travis County is located in south central Texas.",
      description: "County in Texas, United States",
      coordinates: { lat: 30.3333, lon: -97.7833 },
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Travis_County,_Texas" } },
    });
    expect(s).toEqual({
      title: "Travis County, Texas",
      extract: "Travis County is located in south central Texas.",
      url: "https://en.wikipedia.org/wiki/Travis_County,_Texas",
      description: "County in Texas, United States",
      lat: 30.3333,
      lon: -97.7833,
    });
  });

  it("returns a summary without coordinates and null without a title", () => {
    const s = parseSummary({ title: "Texas", extract: "A state." });
    expect(s?.lat).toBeUndefined();
    expect(s?.url).toBe("https://en.wikipedia.org/wiki/Texas");
    expect(parseSummary(null)).toBeNull();
    expect(parseSummary({ extract: "no title" })).toBeNull();
  });
});

describe("parseOnThisDay", () => {
  it("maps feed sections to typed items and strips HTML from titles", () => {
    const out = parseOnThisDay({
      events: [
        {
          text: "Something happened.",
          year: 1963,
          pages: [
            {
              titles: { canonical: "Some Place", display: "Some <i>Place</i>" },
              extract: "A place.",
              coordinates: { lat: 1, lon: 2 },
              content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Some_Place" } },
            },
            { title: "No Coords", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/No_Coords" } } },
          ],
        },
      ],
      births: [{ text: "A person is born.", year: 1900, pages: [] }],
      holidays: [{ text: "A holiday with no year" }],
      selected: [{ text: "<b>Featured</b> entry.", year: 2001, pages: [{ titles: { display: "Feat <i>ured</i>" } }] }],
    });
    expect(out.map((i) => i.type)).toEqual(["selected", "event", "birth"]);
    const ev = out.find((i) => i.type === "event")!;
    expect(ev.year).toBe(1963);
    expect(ev.pages[0]).toEqual({
      title: "Some Place",
      url: "https://en.wikipedia.org/wiki/Some_Place",
      extract: "A place.",
      lat: 1,
      lon: 2,
    });
    expect(ev.pages[1].lat).toBeUndefined();
    expect(out.find((i) => i.type === "selected")?.text).toBe("Featured entry.");
  });

  it("tolerates missing sections", () => {
    expect(parseOnThisDay(null)).toEqual([]);
    expect(parseOnThisDay({})).toEqual([]);
  });
});

describe("helpers", () => {
  it("stripHtml removes tags and decodes common entities", () => {
    expect(stripHtml("Tom &amp; <b>Jerry</b>")).toBe("Tom & Jerry");
    expect(stripHtml(undefined)).toBe("");
  });

  it("haversineM is zero for a point and sane for Austin to Dallas", () => {
    expect(haversineM(30.2672, -97.7431, 30.2672, -97.7431)).toBe(0);
    expect(haversineM(30.2672, -97.7431, 32.7767, -96.797)).toBeGreaterThan(250_000);
  });
});
