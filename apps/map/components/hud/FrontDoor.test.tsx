// The front door as a phone and a crawler get it before JavaScript: the same
// regexes the panel's acceptance check (front-door-check.mjs) runs against the
// served HTML, here against the server render of the chrome and the metadata.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { BASE_DESCRIPTION, BASE_METADATA, PROMISE } from "@/lib/seo/base";
import { CatalogLink, SiteSearch } from "./FrontDoor";
import MobileTopBar from "./MobileTopBar";
import TopBar from "./TopBar";

const H1 = /<h1[\s>]/i;
const CATALOG = /href="\/catalog"/;
const SEARCH = /<input[^>]*type="search"|role="search"/i;

describe("the front door in the server HTML", () => {
  it("the search form is a real form that works without JavaScript", () => {
    const html = renderToStaticMarkup(<SiteSearch />);
    expect(html).toMatch(/<form[^>]*role="search"[^>]*action="\/catalog"/);
    expect(html).toMatch(/<input[^>]*type="search"[^>]*name="q"/);
    // 44 px tap target, and no type under 12 px.
    expect(html).toContain("h-11");
    expect(html).not.toMatch(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/);
    expect(renderToStaticMarkup(<CatalogLink />)).toMatch(CATALOG);
  });

  it("the phone header carries the h1, the search field and the catalogue link", () => {
    const html = renderToStaticMarkup(<MobileTopBar />);
    expect(html).toMatch(H1);
    expect(html).toMatch(SEARCH);
    expect(html).toMatch(CATALOG);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it("the desktop header carries the h1, the search field and the catalogue link", () => {
    const html = renderToStaticMarkup(<TopBar />);
    expect(html).toMatch(H1);
    expect(html).toMatch(SEARCH);
    expect(html).toMatch(CATALOG);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });
});

describe("the promise", () => {
  it("is the description everywhere and says what eye is for", () => {
    expect(BASE_DESCRIPTION).toBe(PROMISE);
    expect(PROMISE).toMatch(/record/i);
    expect(PROMISE).toMatch(/cite|source/i);
    expect(PROMISE).toMatch(/place|county|US/);
    expect(BASE_METADATA.openGraph?.description).toBe(PROMISE);
    expect(BASE_METADATA.twitter?.description).toBe(PROMISE);
    expect(manifest().description).toBe(PROMISE);
    for (const s of [PROMISE, JSON.stringify(manifest())]) expect(s).not.toMatch(/spy satellite/i);
  });
});
