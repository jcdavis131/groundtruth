// Flag pool items whose `sources` come from the material that built the system under test.
//
//   node eval/lineage.mjs --pool <pool.json> [--list eval/lineage-list.json]
//
// lineage-list.json holds rules: {id, kind: "path", match, why} flags a source whose text (backslashes read as
// slashes, case ignored) contains `match`; {id, kind: "pr", repo, number, why} flags a source that names
// "<repo> PR #<number>" exactly (a gods-eye-view PR with the same number is another repo and is not flagged).
// Prints one line per flag: id, rule, the matching source. Flags are information for the exclusion list;
// the exit code is 0 either way. Exit 2 on usage.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { itemId, parseArgs, readPool } from "./lib.mjs";

const norm = (s) => s.replaceAll("\\", "/").toLowerCase();

export function lineageFlags(items, list) {
  const rules = Array.isArray(list) ? list : list.rules;
  const flags = [];
  for (const it of items) {
    for (const rule of rules) {
      const hit = (it.sources ?? []).find((s) => {
        if (rule.kind === "path") return norm(s).includes(norm(rule.match));
        if (rule.kind === "pr") return new RegExp(`(?<![\\w-])${rule.repo} PR #${rule.number}(?!\\d)`, "i").test(s);
        throw new Error(`unknown rule kind ${rule.kind}`);
      });
      if (hit) flags.push({ id: itemId(it.question), question: it.question, rule: rule.id, source: hit });
    }
  }
  return flags;
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.pool) {
    console.error("usage: node eval/lineage.mjs --pool <pool.json> [--list <lineage-list.json>]");
    process.exit(2);
  }
  const list = JSON.parse(readFileSync(a.list ?? path.join(here, "lineage-list.json"), "utf8"));
  const flags = lineageFlags(readPool(a.pool), list);
  for (const f of flags) console.log(`flag ${f.id} ${f.rule}  ${f.source.slice(0, 120)}`);
  console.log(`${flags.length} flag(s)`);
}
