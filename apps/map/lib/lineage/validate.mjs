// Verbatim validator for the Method Lineage seed graph (SPEC C3.4).
// Plain Node, no dependencies — CI runs: node lib/lineage/validate.mjs
//
// Named checks, each with a code:
//   verbatim            every Quote.text is a case- and whitespace-normalised
//                       substring of the cited paper's abstract or title, as
//                       stored in the node. A failing edge is DROPPED from
//                       graph.json (never fuzzed) and listed in dropped[].
//   year-order          from.year <= to.year. Fails the build (exit 1).
//   no-reverse          no (to, from) edge. Fails the build (exit 1).
//   one-axis            exactly one axis, a member of the 14-axis enum.
//   types               enum membership (edge type, strength, node kind) and
//                       strength consistent with type.
//   strong-has-mechanism  strong edges have a non-null, non-empty mechanism.
//   no-synthetic        no node id matches /^synth|placeholder|example/i;
//                       every paper (and every embedded paper) names
//                       provenance.retrievedAt. Fails the build (exit 1).
//   no-cjk              no CJK characters in any string. Fails the build (exit 1).
//   budget              <= 300 nodes. Fails the build (exit 1).
//
// Output: lib/lineage/build-report.json
//   { nodes, edges, strong, weak, dropped: [{edgeId, code, detail}],
//     failures: [{edgeId, code, detail}], passed: bool }
// Counts are post-drop. Exit 0 only when passed is true.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = path.join(DIR, "graph.json");
const REPORT_PATH = path.join(DIR, "build-report.json");

// Axis names copied from the Intern-Atlas paper arXiv:2604.28158, Table 4.
// Source of truth for the enum is schema.ts (BottleneckAxisSchema).
const AXES = new Set([
  "computational complexity",
  "memory efficiency",
  "parallelization",
  "accuracy",
  "generalization",
  "scalability",
  "data efficiency",
  "training stability",
  "inference speed",
  "expressiveness",
  "simplicity",
  "robustness",
  "hyperparameter sensitivity",
  "training complexity",
]);
const EDGE_TYPES = new Set([
  "extends",
  "improves",
  "replaces",
  "adapts",
  "uses_component",
  "compares",
  "background",
]);
const STRONG_TYPES = new Set(["extends", "improves", "replaces", "adapts"]);
const SYNTHETIC_ID = /^(synth|placeholder|example)/i;
const CJK = /[\u4e00-\u9fff]/;

/** Case- and whitespace-normalised, per SPEC C3.4. */
export function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function collectStrings(value, out, at) {
  if (typeof value === "string") {
    out.push({ text: value, at });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectStrings(v, out, `${at}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectStrings(v, out, `${at}.${k}`);
  }
}

function main() {
  const graphPath = process.argv[2] ?? GRAPH_PATH;
  const graph = JSON.parse(readFileSync(graphPath, "utf8"));
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const dropped = [];
  const failures = [];
  const fail = (edgeId, code, detail) => failures.push({ edgeId, code, detail });

  // no-cjk: every string in the graph.
  const strings = [];
  collectStrings(graph, strings, "$");
  for (const { text, at } of strings) {
    if (CJK.test(text)) fail(null, "no-cjk", `CJK characters at ${at}`);
  }

  // no-synthetic + provenance presence, per node.
  for (const node of graph.nodes) {
    if (SYNTHETIC_ID.test(node.id)) {
      fail(null, "no-synthetic", `node id ${node.id} looks synthetic`);
    }
    const paper = node.paper;
    if (paper && !paper.provenance?.retrievedAt) {
      fail(null, "no-synthetic", `node ${node.id} paper is missing provenance.retrievedAt`);
    }
    if (node.kind === "paper" && !paper) {
      fail(null, "no-synthetic", `paper node ${node.id} carries no paper object`);
    }
  }

  // budget.
  if (graph.nodes.length > 300) {
    fail(null, "budget", `${graph.nodes.length} nodes exceeds the 300-node budget`);
  }

  // Per-edge checks. Verbatim failures drop the edge; anything else fails the build.
  const kept = [];
  const seenPairs = new Map();
  for (const edge of graph.edges) {
    const pair = `${edge.from}→${edge.to}`;
    if (seenPairs.has(pair)) {
      fail(edge.id, "types", `duplicate edge for pair ${pair}`);
    }
    seenPairs.set(pair, edge.id);

    if (!EDGE_TYPES.has(edge.type)) {
      fail(edge.id, "types", `unknown edge type ${edge.type}`);
    }
    const wantStrong = STRONG_TYPES.has(edge.type);
    if ((edge.strength === "strong") !== wantStrong) {
      fail(edge.id, "types", `strength ${edge.strength} inconsistent with type ${edge.type}`);
    }
    if (!AXES.has(edge.axis)) {
      fail(edge.id, "one-axis", `unknown axis ${JSON.stringify(edge.axis)}`);
    }
    if (wantStrong && (!edge.evidence?.mechanism?.text || !edge.evidence.mechanism.text.trim())) {
      fail(edge.id, "strong-has-mechanism", "strong edge has no mechanism quote");
    }

    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) {
      fail(edge.id, "unknown-node", `edge references unknown node ${!from ? edge.from : edge.to}`);
      continue;
    }
    if (from.year > to.year) {
      fail(edge.id, "year-order", `${edge.from} (${from.year}) is later than ${edge.to} (${to.year})`);
    }
    if (seenPairs.has(`${edge.to}→${edge.from}`)) {
      fail(edge.id, "no-reverse", `reverse edge also exists for ${pair}`);
    }

    // verbatim: each quote must be a normalised substring of the cited
    // paper's abstract (locator "abstract") or title (locator "title").
    let verbatimOk = true;
    for (const key of ["bottleneck", "mechanism", "tradeoff"]) {
      const quote = edge.evidence?.[key];
      if (!quote) continue;
      const cited = nodesById.get(quote.sourceId);
      const sourceText = cited?.paper
        ? quote.locator === "title"
          ? cited.paper.title
          : cited.paper.abstract
        : null;
      if (sourceText === null || sourceText === undefined) {
        verbatimOk = false;
        dropped.push({
          edgeId: edge.id,
          code: "verbatim",
          detail: `${key} quote cites unknown paper node ${quote.sourceId}`,
        });
        break;
      }
      if (!normalize(sourceText).includes(normalize(quote.text))) {
        verbatimOk = false;
        dropped.push({
          edgeId: edge.id,
          code: "verbatim",
          detail: `${key} quote is not a verbatim substring of ${quote.sourceId} ${quote.locator}`,
        });
        break;
      }
    }
    if (verbatimOk) kept.push(edge);
  }

  const strong = kept.filter((e) => e.strength === "strong").length;
  const report = {
    nodes: graph.nodes.length,
    edges: kept.length,
    strong,
    weak: kept.length - strong,
    dropped,
    failures,
    passed: failures.length === 0,
  };

  if (dropped.length > 0) {
    graph.edges = kept;
    writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    console.log(`dropped ${dropped.length} edge(s) failing verbatim from ${graphPath}`);
    for (const d of dropped) console.log(`  ${d.edgeId}: ${d.detail}`);
  }
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `nodes=${report.nodes} edges=${report.edges} strong=${report.strong} ` +
      `weak=${report.weak} dropped=${dropped.length} passed=${report.passed}`,
  );
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`FAIL ${f.code} ${f.edgeId ?? ""} ${f.detail}`);
    }
  }
  process.exit(report.passed ? 0 : 1);
}

main();
