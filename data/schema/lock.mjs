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

/** Errors with code "lock": a manifest whose bytes changed, a locked one that is missing, one the lock doesn't list. */
export function lockErrors(dir, lock) {
  const held = lock?.snapshots ?? {};
  const have = scanManifests(dir);
  const errs = [];
  for (const id of Object.keys(held).sort()) {
    if (!(id in have)) errs.push({ code: "lock", path: `/snapshots/${id}`, message: `${id} is locked but its manifest is missing` });
    else if (have[id] !== held[id]) errs.push({ code: "lock", path: `/snapshots/${id}`, message: `${id} changed: manifest sha256 ${have[id].slice(0, 12)}, the lock says ${held[id].slice(0, 12)}. A written manifest is never edited in place; a changed manifest is a new snapshot id on a new UTC day` });
  }
  for (const id of Object.keys(have).sort()) if (!(id in held)) errs.push({ code: "lock", path: `/snapshots/${id}`, message: `${id} is untracked: run node data/schema/lock.mjs --write to lock it` });
  return errs;
}

/** Adds ids the lock lacks. Throws, writing nothing, if an id already in the lock now hashes differently. */
export function writeLock(dir, lockFile) {
  const held = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, "utf8")).snapshots ?? {} : {};
  const have = scanManifests(dir);
  const changed = Object.keys(held).filter((id) => id in have && have[id] !== held[id]);
  if (changed.length) throw new Error(`refusing to change the sha of a locked snapshot: ${changed.join(", ")}. A changed manifest is a new snapshot id on a new UTC day`);
  const added = Object.keys(have).filter((id) => !(id in held)).sort();
  const next = { ...held };
  for (const id of added) next[id] = have[id];
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(lockFile, JSON.stringify({ schemaVersion: "lock/1", snapshots: sorted }, null, 2) + "\n");
  return { added };
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
