// The City of Chicago's terms ask for its disclaimer "at the site where the
// software application ... can be accessed": the About dialog must carry it
// verbatim. Rendered to static markup, no browser.
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHICAGO_DISCLAIMER } from "@/lib/civic/terms";
import DataTerms from "./DataTerms";

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

describe("data terms on the site", () => {
  it("renders the City of Chicago's disclaimer verbatim", () => {
    const html = renderToStaticMarkup(<DataTerms />);
    expect(text(html)).toContain(CHICAGO_DISCLAIMER);
    expect(html).toContain('href="https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html"');
  });

  it("is part of the About dialog", () => {
    const src = readFileSync(path.join(__dirname, "AboutDialog.tsx"), "utf8");
    expect(src).toMatch(/import DataTerms from "\.\/DataTerms";/);
    expect(src).toContain("<DataTerms />");
  });
});
