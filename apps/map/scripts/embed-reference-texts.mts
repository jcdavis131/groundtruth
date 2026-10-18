// The texts the potion port is checked on (lib/embed/potion.test.ts): every
// catalogue card's text, the record text of every real fixture row the
// record-vector builders take, and tokeniser edge cases copied from catalogue
// prose. Writes lib/embed/__fixtures__/reference-texts.json; the Python
// reference (scripts/embed-reference.py) embeds the same file with model2vec.
//
//   npx vite-node --config vitest.config.ts scripts/embed-reference-texts.mts

import { writeFileSync } from "node:fs";
import path from "node:path";
import { allCardTexts } from "@/lib/catalog/cardText";
import { receivedRecordText } from "@/lib/catalog/recordText";
import { recordFixtures } from "@/lib/embed/__fixtures__/records";

const texts: Array<{ source: string; text: string }> = [];
for (const c of allCardTexts()) texts.push({ source: `card:${c.id}`, text: c.text });
for (const r of recordFixtures()) {
  const seen = new Set<string>();
  for (const f of r.features) {
    const t = receivedRecordText(f.properties);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (seen.size > 6) break;
    texts.push({ source: `record:${r.card}${r.captured ? "" : " (test-written row)"}`, text: t });
  }
}
// Edge cases, each a string that occurs in the catalogue or a fixture (hyphen, parentheses,
// digits, slashes, an accent-free acronym), plus the empty and punctuation-only cases.
for (const t of [
  "303(d)",
  "PFAS",
  "Toxics Release Inventory",
  "non-community",
  "1879-2006",
  "MM/DD/YYYY",
  "Rice's whale",
  "doi:10.5066/P96WBCHS",
  "3,001 in a 0.4 by 0.25 degree Houston box",
  "",
  "; ;",
]) texts.push({ source: "edge", text: t });

const out = path.resolve("lib/embed/__fixtures__/reference-texts.json");
writeFileSync(out, JSON.stringify({ kind: "texts the port is checked on: card texts, record texts of real fixture rows, catalogue edge cases", generatedBy: "scripts/embed-reference-texts.mts", texts }, null, 1) + "\n");
console.log(`wrote ${texts.length} texts to ${out}`);
