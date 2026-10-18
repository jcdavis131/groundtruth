// Keeps docs/SCREENER.md in step with the field registry. Regenerate the
// tables with:  UPDATE_SCREENER_DOCS=1 npx vitest run lib/screener/docs.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENTITY_KINDS, fieldTableMarkdown } from "./fields";

const DOC = path.resolve(__dirname, "../../docs/SCREENER.md");

function block(kind: string, table: string): string {
  return `<!-- fields:${kind} -->\n${table}\n<!-- /fields:${kind} -->`;
}

describe("docs/SCREENER.md", () => {
  it("exists and carries one generated field table per entity kind", () => {
    expect(fs.existsSync(DOC)).toBe(true);
    let text = fs.readFileSync(DOC, "utf8");
    const update = process.env.UPDATE_SCREENER_DOCS === "1";
    for (const kind of ENTITY_KINDS) {
      const expected = block(kind, fieldTableMarkdown(kind));
      const re = new RegExp(`<!-- fields:${kind} -->[\\s\\S]*?<!-- /fields:${kind} -->`);
      if (update) {
        text = re.test(text) ? text.replace(re, expected) : text + "\n\n" + expected + "\n";
        continue;
      }
      const m = text.match(re);
      expect(m, `docs/SCREENER.md lacks the ${kind} field table; run UPDATE_SCREENER_DOCS=1 npx vitest run lib/screener/docs.test.ts`).not.toBeNull();
      expect(m![0], `${kind} field table is out of date; run UPDATE_SCREENER_DOCS=1 npx vitest run lib/screener/docs.test.ts`).toBe(expected);
    }
    if (update) fs.writeFileSync(DOC, text);
  });
});
