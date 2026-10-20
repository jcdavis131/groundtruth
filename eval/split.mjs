// Write the v4 eval split once: seeded, stratified by placeKind, exclusions applied, never overwritten.
//
//   node eval/split.mjs --pool <pool.json> --exclusions <exclusions.json> --out <split.json> [--seed 20261019]
//
// pool.json is the frozen task pool (read, never edited). exclusions.json is {"excluded":[{"id","rule","arm"}]}
// and lives outside the repo, hashed on groundtruth#15 before this runs. Each item's id is itemId(question).
// Within each placeKind, items are ordered by sha256(seed|id) and dealt to the half that has fewer of that
// kind (ties: the half with fewer overall, then a seeded coin), so every kind is within one item across the
// two halves. The output carries a header marker; guard.mjs refuses a committed file that has one. Prints
// the sha256 of the split file and of the exclusion list. Refuses to overwrite (harness2's rule: a split
// is written once). Exit 0 written, 1 refused, 2 usage.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { itemId, marker, parseArgs, readPool, sha256 } from "./lib.mjs";

const SEED = 20261019;

export function makeSplit(pool, excludedIds, seed = SEED) {
  const gone = new Set(excludedIds);
  const kept = pool.map((p) => ({ id: itemId(p.question), kind: p.placeKind })).filter((p) => !gone.has(p.id));
  const byKind = new Map();
  for (const p of kept) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p.id]);
  const rank = (s) => sha256(`${seed}|${s}`);
  const halves = { open: [], sealed: [] };
  for (const kind of [...byKind.keys()].sort()) {
    const ids = byKind.get(kind).sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
    const here = { open: 0, sealed: 0 };
    for (const id of ids) {
      let h;
      if (here.open !== here.sealed) h = here.open < here.sealed ? "open" : "sealed";
      else if (halves.open.length !== halves.sealed.length) h = halves.open.length < halves.sealed.length ? "open" : "sealed";
      else h = parseInt(rank(`coin|${id}`)[0], 16) % 2 === 0 ? "open" : "sealed";
      here[h]++;
      halves[h].push(id);
    }
  }
  halves.open.sort();
  halves.sealed.sort();
  return { open: halves.open, sealed: halves.sealed, excluded: [...gone].sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.pool || !a.exclusions || !a.out) {
    console.error("usage: node eval/split.mjs --pool <pool.json> --exclusions <exclusions.json> --out <split.json> [--seed N]");
    process.exit(2);
  }
  if (existsSync(a.out)) {
    console.error(`refusing to overwrite ${a.out}: a split is written once`);
    process.exit(1);
  }
  const seed = a.seed === undefined ? SEED : Number(a.seed);
  const exclBytes = readFileSync(a.exclusions);
  const excl = JSON.parse(exclBytes);
  const ids = (excl.excluded ?? []).map((e) => e.id);
  const pool = readPool(a.pool);
  const split = {
    marker: marker("split"),
    seed,
    pool_sha256: sha256(readFileSync(a.pool)),
    exclusions_sha256: sha256(exclBytes),
    ...makeSplit(pool, ids, seed),
  };
  const body = JSON.stringify(split, null, 2) + "\n";
  writeFileSync(a.out, body, { flag: "wx" });
  console.log(`split sha256 ${sha256(Buffer.from(body))}`);
  console.log(`exclusions sha256 ${sha256(exclBytes)} (${ids.length} excluded)`);
}
