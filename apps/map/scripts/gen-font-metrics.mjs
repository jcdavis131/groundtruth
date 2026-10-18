// Regenerates lib/insights/render/metrics.json from the vendored Geist TTFs
// in lib/insights/render/fonts/: per weight, the vertical metrics, the hmtx
// count and the advance width of every code point the chart renderer may
// print, plus each file's byte length and sha256 so a font swap without a
// regeneration is caught by metrics.test.ts.
//
//   node scripts/gen-font-metrics.mjs
//
// No dependencies beyond the repo's own TypeScript. The parser is
// lib/insights/render/ttf.ts, the same one the sync test uses, transpiled in
// process with typescript.transpileModule and imported from a data: URL
// (one parser, two callers). Not `node --experimental-strip-types`: like
// scripts/mcp-stdio.mjs says, strip-types needs ".ts" import specifiers the
// app's tsconfig rejects; ttf.ts has no imports, so a single-file transpile
// is all it takes.
//
// Byte-idempotent on purpose: no timestamp, no absolute path, keys in a
// fixed order, LF line endings. `node scripts/gen-font-metrics.mjs && git
// diff --exit-code lib/insights/render/metrics.json` is the acceptance check.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const renderDir = path.join(root, "lib", "insights", "render");
const fontDir = path.join(renderDir, "fonts");
const out = path.join(renderDir, "metrics.json");

// The files as published in the vercel/geist-font v1.7.2 release asset
// geist-font-v1.7.2.zip, under geist-font/Geist/ttf/; LICENSE.txt is that
// archive's geist-font/OFL.txt, verbatim.
const SOURCE = "https://github.com/vercel/geist-font/releases/download/v1.7.2/geist-font-v1.7.2.zip";
const WEIGHTS = [
  [400, "Geist-Regular.ttf"],
  [700, "Geist-Bold.ttf"],
  [900, "Geist-Black.ttf"],
];

const src = fs.readFileSync(path.join(renderDir, "ttf.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: "ttf.ts",
}).outputText;
const { parseTtf, fontMetrics, metricCodePoints } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const codePoints = metricCodePoints();
const weights = {};
for (const [weight, file] of WEIGHTS) {
  const bytes = fs.readFileSync(path.join(fontDir, file));
  const m = fontMetrics(parseTtf(new Uint8Array(bytes)), codePoints);
  weights[weight] = {
    file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...m,
  };
}

const doc = { family: "Geist", version: "1.7.2", source: SOURCE, generator: "scripts/gen-font-metrics.mjs", weights };
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
for (const [weight] of WEIGHTS) {
  const w = weights[weight];
  console.log(`${w.file}: ${w.bytes} B, hmtx ${w.numberOfHMetrics}, ${Object.keys(w.adv).length}/${codePoints.length} code points mapped`);
}
