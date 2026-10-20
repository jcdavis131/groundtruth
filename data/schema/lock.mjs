// The snapshot lock: data/manifests/LOCK.json maps each snapshot id to the sha256 of its committed manifest.
//   node data/schema/lock.mjs --check     fail (exit 1, code lock) on a changed, missing or untracked manifest
//   node data/schema/lock.mjs --write     add ids the lock doesn't hold yet; REFUSE to change an id already in it
// A written snapshot and its manifest are never edited in place (data/SCHEMA.md, The snapshot). A changed
// manifest is a new snapshot id on a new UTC day, which --write then adds. Plain Node, no install.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MANIFESTS_DIR = path.join(HERE, "..", "manifests");
export const LOCK_PATH = path.join(MANIFESTS_DIR, "LOCK.json");

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** snapshot id -> sha256 of the manifest file's bytes, for every <dir>/<collection>/<id>.json. */
export function scanManifests(dir) {
  const out = {};
  for (const coll of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort())
    for (const f of readdirSync(path.join(dir, coll)).filter((n) => n.endsWith(".json")).sort())
      out[f.slice(0, -5)] = sha256(path.join(dir, coll, f));
  return out;
}

/** RED EVIDENCE (neutered, restored in the next commit): reports nothing. */
export function lockErrors(dir, lock) {
  return [];
}

/** RED EVIDENCE (neutered, restored in the next commit): adds nothing, refuses nothing, writes nothing. */
export function writeLock(dir, lockFile) {
  return { added: [] };
}

function main(argv) {
  if (argv[0] === "--check" && argv.length === 1) {
    if (!existsSync(LOCK_PATH)) {
      console.error("lock: data/manifests/LOCK.json is missing");
      return 1;
    }
    const errs = lockErrors(MANIFESTS_DIR, JSON.parse(readFileSync(LOCK_PATH, "utf8")));
    for (const e of errs) console.error(`${e.code} ${e.path} ${e.message}`);
    console.log(errs.length ? `${errs.length} lock error(s)` : `lock ok: ${Object.keys(scanManifests(MANIFESTS_DIR)).length} manifests match LOCK.json`);
    return errs.length ? 1 : 0;
  }
  if (argv[0] === "--write" && argv.length === 1) {
    try {
      const { added } = writeLock(MANIFESTS_DIR, LOCK_PATH);
      console.log(added.length ? `locked ${added.length} new: ${added.join(", ")}` : "nothing new to lock");
      return 0;
    } catch (e) {
      console.error(String(e.message));
      return 1;
    }
  }
  console.log("usage: node data/schema/lock.mjs --check | --write");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
