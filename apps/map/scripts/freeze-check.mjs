// Holds the catalogue at the size FREEZE.json names until its "until" date.
// Reads the COLLECTIONS array in lib/catalog/collections.ts as text (no
// import, no build) and counts its top-level entries: a line that is exactly
// two spaces and "{", followed by a line of four spaces and `id: "..."`.
// Nested objects in an entry sit deeper, so they never match.
//
// Before the date, more entries than "max" fails with the new ids named;
// on or after it, or at or under the cap, it passes and prints the count.
// Plain Node, no dependencies. Run from the repository root:
//   node scripts/freeze-check.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = /^ {2}\{\r?\n {4}id: "([^"]+)"/gm;

// The text of the COLLECTIONS array: from its declaration to the first line
// that is exactly "];" after it.
export function collectionsBlock(text) {
  const start = text.indexOf("export const COLLECTIONS");
  if (start < 0) throw new Error("no `export const COLLECTIONS` in the file");
  const rest = text.slice(start);
  const end = rest.search(/^\];/m);
  if (end < 0) throw new Error("COLLECTIONS array has no closing `];` line");
  return rest.slice(0, end);
}

export function collectionIds(text) {
  return [...collectionsBlock(text).matchAll(ENTRY)].map((m) => m[1]);
}

// today and until are YYYY-MM-DD; string order is date order.
export function verdict(ids, freeze, today) {
  const { max, until } = freeze.collections;
  const binding = today < until;
  if (!binding || ids.length <= max) {
    return { ok: true, message: `${ids.length} collections (freeze max ${max} until ${until}${binding ? "" : ", lifted"}).` };
  }
  const added = ids.slice(max);
  return {
    ok: false,
    message:
      `${ids.length} collections, over the freeze of ${max} until ${until}. ` +
      `New since the freeze (the last ${added.length} in the array): ${added.join(", ")}. ` +
      `${freeze.collections.why ?? ""}`.trim(),
  };
}

function main() {
  const root = process.cwd();
  const freeze = JSON.parse(fs.readFileSync(path.join(root, "FREEZE.json"), "utf8"));
  const ids = collectionIds(fs.readFileSync(path.join(root, "lib/catalog/collections.ts"), "utf8"));
  if (new Set(ids).size !== ids.length) console.log("warning: duplicate collection ids in COLLECTIONS");
  console.log(ids.join("\n"));
  const today = new Date().toISOString().slice(0, 10);
  const v = verdict(ids, freeze, today);
  console.log(`\n${v.message}`);
  if (!v.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
