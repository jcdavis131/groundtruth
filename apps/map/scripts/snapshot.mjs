// Sample the live public feeds and append aggregate counts to data/series.
//
//   node scripts/snapshot.mjs                       run every collector, write data/series
//   node scripts/snapshot.mjs --only=quakes,gauges  a subset (ids from lib/series/collectors)
//   node scripts/snapshot.mjs --dry-run             collect and report, write nothing
//   node scripts/snapshot.mjs --dir=/tmp/series     write somewhere else
//   node scripts/snapshot.mjs --listen=60           AISStream window in seconds (default 180)
//
// Env: AISSTREAM_KEY (optional, unlocks the non-Baltic ports), GEV_SERIES_DIR
// (default for --dir), GEV_SNAPSHOT_LISTEN_S (default for --listen).
//
// Compiles the collector code with tsc into node_modules/.cache/gev-snapshot
// (already git-ignored) the way scripts/turbidity-check.mjs does, rewrites the
// "@/..." and extension-less imports the Next.js bundler would normally
// resolve, then runs runCollectors() against fileStore(dir) and writes an
// index.json of series metadata next to the files for the read-only raw
// adapter. Exits 1 only when every collector failed, so one flaky upstream
// never blocks the others from being committed.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) {
      console.error(`unknown argument ${a}`);
      process.exit(2);
    }
    return [m[1], m[2] ?? "true"];
  }),
);
if (args.has("help")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 18).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
const dryRun = args.get("dry-run") === "true";
const only = args.get("only") ? args.get("only").split(",").map((s) => s.trim()).filter(Boolean) : undefined;
const dir = path.resolve(args.get("dir") ?? process.env.GEV_SERIES_DIR ?? path.join("data", "series"));
const listenS = Number(args.get("listen") ?? process.env.GEV_SNAPSHOT_LISTEN_S ?? 180);
if (!Number.isFinite(listenS) || listenS < 1 || listenS > 900) {
  console.error("--listen must be 1..900 seconds");
  process.exit(2);
}

// ---- compile

const root = process.cwd();
const outDir = path.join(root, "node_modules", ".cache", "gev-snapshot");
mkdirSync(outDir, { recursive: true });
const entry = ["lib/series/collect.ts", "lib/series/read.ts", "lib/series/store.ts", "lib/series/githubRaw.ts", "lib/series/collectors/index.ts"];
const tsconfig = {
  extends: path.relative(outDir, path.join(root, "tsconfig.json")),
  compilerOptions: {
    noEmit: false,
    incremental: false,
    outDir: ".",
    rootDir: path.relative(outDir, root) || ".",
    module: "es2022",
    target: "es2022",
    moduleResolution: "bundler",
    isolatedModules: false,
    plugins: [],
    types: ["node"],
    lib: ["es2022", "dom"],
  },
  include: [],
  files: entry.map((f) => path.relative(outDir, path.join(root, f))),
};
writeFileSync(path.join(outDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
try {
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", path.join(outDir, "tsconfig.json")], { stdio: "inherit", cwd: root });
} catch {
  console.error("snapshot: TypeScript compile failed");
  process.exit(2);
}
writeFileSync(path.join(outDir, "package.json"), '{ "type": "module" }');

// tsc leaves "@/lib/x" and "./types" as written; Node ESM wants relative
// paths with extensions. Rewrite every emitted file once.
function rewrite(file) {
  const src = readFileSync(file, "utf8");
  const fromDir = path.dirname(file);
  const out = src.replace(/(from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g, (all, lead, spec) => {
    let target = null;
    if (spec.startsWith("@/")) target = path.join(outDir, spec.slice(2));
    else if (spec.startsWith("./") || spec.startsWith("../")) target = path.join(fromDir, spec);
    if (!target) return all;
    if (!/\.(m?js|json)$/.test(target)) {
      const asDir = path.join(target, "index.js");
      let isDir = false;
      try {
        isDir = statSync(target).isDirectory();
      } catch {
        // not a directory
      }
      target = isDir ? asDir : target + ".js";
    }
    let rel = path.relative(fromDir, target).split(path.sep).join("/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    return `${lead}"${rel}"`;
  });
  if (out !== src) writeFileSync(file, out);
}
function walk(d) {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) rewrite(p);
  }
}
walk(outDir);

// ---- run

const { runCollectors } = await import(pathToFileURL(path.join(outDir, "lib/series/collect.js")).href);
const { listSeries } = await import(pathToFileURL(path.join(outDir, "lib/series/read.js")).href);
const { fileStore, memoryStore } = await import(pathToFileURL(path.join(outDir, "lib/series/store.js")).href);

const store = dryRun ? memoryStore() : fileStore(dir);
const t0 = Date.now();
const report = await runCollectors({
  store,
  only,
  dryRun,
  keys: { AISSTREAM_KEY: process.env.AISSTREAM_KEY },
  listenMs: listenS * 1000,
  logger: (line) => console.log(`  ${line}`),
});

if (!dryRun && report.ran.length > 0) {
  // index.json feeds the read-only raw adapter's list(); listSeries() skips it
  // when it reads the same directory back.
  const metas = await listSeries(store);
  writeFileSync(path.join(dir, "index.json"), JSON.stringify(metas));
  console.log(`index.json: ${metas.length} series`);
}

console.log("");
console.log(`snapshot ${report.startedAt}${dryRun ? " (dry run)" : ` -> ${dir}`}`);
console.log(`  ran     ${report.ran.length ? report.ran.join(", ") : "none"}`);
for (const f of report.failed) console.log(`  failed  ${f.id}: ${f.error}`);
console.log(`  wrote   ${report.seriesWritten} series, ${report.pointsWritten} points in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

if (report.ran.length === 0 && report.failed.length > 0) {
  console.error("snapshot: every collector failed");
  process.exit(1);
}
