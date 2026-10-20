// The freshness line: for each collection with a committed manifest, how old its newest snapshot is, against the
// publisher's own stated cadence in data/cadence.json. Prints the collections past their cadence, and the ones whose
// publisher states no interval (those are never called overdue). Plain Node, no install, core modules only.
//
//   node data/schema/freshness.mjs [--today YYYY-MM-DD] [--manifests DIR] [--cadence FILE]
//
// Output, one line each:
//   freshness as of <day>
//   held: <collection> newest <day> (<snapshot id>) age <n> days, cadence <d> days | unstated | no row
//   overdue: <collection> newest <day> cadence <d> (age <n> days)       zero or more; or the line "none overdue"
//   unstated: <collection> (<reason>), ...                              or "unstated: none"
//   missing cadence row: ...          only when a committed collection has no row in the table
//   no manifest for cadence row: ...  only when a row names a collection with no committed manifest
//
// "Newest" is the newest snapshot of the collection across its regions, by the manifest's createdAt day. A
// collection is overdue when that day is more than expectedDays before --today (default: today, UTC). It reports and
// never gates: exit 0 whatever the manifests say. Exit 2 only when it cannot run: a bad option, or a table or a
// manifest it cannot read.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY_MS = 86_400_000;
const isDay = (s) => typeof s === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const ageDays = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The newest snapshot per collection: Map(collection -> {day, id}), from <dir>/<collection>/*.json. */
function newestByCollection(dir) {
  const newest = new Map();
  for (const coll of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort())
    for (const f of readdirSync(path.join(dir, coll)).filter((n) => n.endsWith(".json")).sort()) {
      const m = JSON.parse(readFileSync(path.join(dir, coll, f), "utf8"));
      const id = typeof m.snapshotId === "string" ? m.snapshotId : f.slice(0, -5);
      const day = typeof m.createdAt === "string" && isDay(m.createdAt.slice(0, 10)) ? m.createdAt.slice(0, 10) : id.split(".")[2];
      if (!isDay(day)) throw new Error(`${path.join(coll, f)} has no usable date (createdAt or the snapshot id's day)`);
      const have = newest.get(coll);
      if (!have || day > have.day || (day === have.day && id > have.id)) newest.set(coll, { day, id });
    }
  return newest;
}

function main(argv) {
  let today = new Date().toISOString().slice(0, 10);
  let manifests = path.join(HERE, "..", "manifests");
  let cadence = path.join(HERE, "..", "cadence.json");
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (v === undefined || !["--today", "--manifests", "--cadence"].includes(k)) {
      console.error("usage: node data/schema/freshness.mjs [--today YYYY-MM-DD] [--manifests DIR] [--cadence FILE]");
      return 2;
    }
    if (k === "--today") today = v;
    else if (k === "--manifests") manifests = path.resolve(v);
    else cadence = path.resolve(v);
  }
  if (!isDay(today)) {
    console.error(`freshness: --today ${today} is not a calendar day (YYYY-MM-DD)`);
    return 2;
  }
  let rows;
  let newest;
  try {
    rows = JSON.parse(readFileSync(cadence, "utf8")).collections;
    if (!Array.isArray(rows)) throw new Error("no collections array");
  } catch (e) {
    console.error(`freshness: cannot read the cadence table ${cadence}: ${e.message}`);
    return 2;
  }
  try {
    newest = newestByCollection(manifests);
  } catch (e) {
    console.error(`freshness: cannot read the manifests in ${manifests}: ${e.message}`);
    return 2;
  }
  const rowOf = (c) => rows.find((r) => r?.collection === c);
  const names = [...newest.keys()].sort();
  const out = [`freshness as of ${today}`];
  const overdue = [];
  const unstated = [];
  const noRow = [];
  for (const c of names) {
    const { day, id } = newest.get(c);
    const age = ageDays(day, today);
    const row = rowOf(c);
    const cadenceText = !row ? "no row" : Number.isInteger(row.expectedDays) ? `${row.expectedDays} days` : "unstated";
    out.push(`held: ${c} newest ${day} (${id}) age ${age} days, cadence ${cadenceText}`);
    if (!row) noRow.push(c);
    else if (Number.isInteger(row.expectedDays)) {
      if (age > row.expectedDays) overdue.push(`overdue: ${c} newest ${day} cadence ${row.expectedDays} (age ${age} days)`);
    } else unstated.push(`${c} (${row.reason ?? "no reason given"})`);
  }
  out.push(...(overdue.length ? overdue : ["none overdue"]));
  out.push(`unstated: ${unstated.length ? unstated.join(", ") : "none"}`);
  if (noRow.length) out.push(`missing cadence row: ${noRow.join(", ")}`);
  const ghosts = rows.map((r) => r?.collection).filter((c) => typeof c === "string" && !newest.has(c)).sort();
  if (ghosts.length) out.push(`no manifest for cadence row: ${ghosts.join(", ")}`);
  console.log(out.join("\n"));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
