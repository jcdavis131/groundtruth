// Shared bits for the eval kit. Plain Node, no install.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// An item's id is the first 12 hex of sha256(question), so ids survive reordering of pool.json and the
// pool file never has to be edited to carry them.
export const itemId = (question) => sha256(question).slice(0, 12);

// pool.json is {rules, selection, pool: [...]}; a bare array is accepted too.
export function readPool(file) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  const items = Array.isArray(j) ? j : j.pool;
  if (!Array.isArray(items)) throw new Error(`${file}: no pool array`);
  return items;
}

// "--name value" pairs into an object; a flag with no value is true.
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[argv[i].slice(2)] = true;
    else {
      out[argv[i].slice(2)] = next;
      i++;
    }
  }
  return out;
}

// The header markers of the files that must never be committed. Joined so no source file carries one.
export const marker = (kind) => ["groundtruth", "eval", kind, "v1"].join("-");
