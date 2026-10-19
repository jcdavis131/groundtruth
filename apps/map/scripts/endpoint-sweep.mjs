// Upstream endpoint sweep: finds the ArcGIS services and map-tile templates the app hard-codes and
// asks each one whether it still answers. Read-only, keyless, one request per endpoint (plus one
// retry). It does not cover the app's other upstreams (JSON APIs, CSV and file downloads, Socrata
// datasets); a dead one of those shows up in its own route's state, not here.
//
//   node scripts/endpoint-sweep.mjs            probe, print a table, exit 1 on a newly failing upstream
//                                              or a known-outage entry that fails (see below)
//   node scripts/endpoint-sweep.mjs --list     list what would be probed and what is not, probe nothing,
//                                              and check the known-outage entries (exit 1 if one fails)
//
// Why it exists: USFWS retired Wetlands_Raster_v5 and the zoomed-out wetlands layer drew nothing
// for days (fixed in #86). ArcGIS answers a dead service with HTTP 200 and {"error":{...}}, so a
// status check alone passes it. This sweep reads the body:
// - a URL is found as a string literal, or as a template built on a string constant defined
//   anywhere under lib/ or app/ (`${WFIGS}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0`);
// - an ArcGIS service is asked for its root with ?f=json, and an "error" body is DEAD;
// - a tile template is filled with one tile over Kansas, and the body must be an image;
// - a service or template that still has runtime parts (`${...}`), a placeholder we cannot fill,
//   or a base that is not a string constant is listed as not probed, counted by reason.
//
// A failing answer (DEAD, ERR or ODD) seen on both tries, 20 s apart, that is not in
// endpoint-sweep.known.json fails the run, so a host that is gone or now redirects to an HTML
// portal is caught too. A failure that recovers on the retry is a warning: shared runners and
// CloudFront's IPv6 path both reset connections now and then (lib/server/net.ts), so this
// resolves IPv4 first too.
//
// A known outage ages, so the list can't hide a dead upstream for good. Each entry's `since` sets
// its tier: info under 7 days, warn at 7-29, a louder warn at 30-89, and a failed run at 90 or
// more, when it is time to replace or drop the layer. An entry whose `match` hits no probed URL
// also fails the run (the layer was removed or moved and the entry went stale), and so does a
// `since` that is not a past YYYY-MM-DD date. --list checks the entries too, without a request.
//
// Credit: the age tiers and the stale-entry failure are an idea from hecat's awesome_lint
// (github.com/nodiscc/hecat, GPL-3.0, commit f26e82260ebb1232b27aa793d14a9c055a33db19), whose
// day thresholds warn and then fail on unmaintained entries, as awesome-selfhosted-data
// configures it in .hecat/awesome-lint.yml (CC-BY-SA-3.0, commit
// 11d52dc8b0312cc081485e36190b2ff0529a0db7). Idea only: no code or text from either is in here.

import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A tile placeholder is {z}, not the ${z} of a template's runtime part.
const PLACEHOLDER = /(?<!\$)\{[a-zA-Z]+\}/;
const ENDPOINT_RE =
  /"https:\/\/[^"`]*(?:\{[a-zA-Z]+\}|\/(?:Map|Image|Feature)Server|\/tile\/)[^"`]*"|`https:\/\/[^`]*(?:(?<!\$)\{[a-zA-Z]+\}|\/(?:Map|Image|Feature)Server|\/tile\/)[^`]*`/g;
const SERVICE_OR_TILE = /\/(?:Map|Image|Feature)Server|\/tile\/|(?<!\$)\{[a-zA-Z]+\}/;

// z6 x14 y24 is a web-mercator tile over Kansas; the projected box is about 100 km across there.
// ft is NOAA's sea level rise scenario, SLR_DEFAULT_FT in lib/terrain/products.ts.
const TILE = { z: "6", x: "14", y: "24", s: "a" };
const BOX = { westProjected: "-10950000", southProjected: "4650000", eastProjected: "-10850000", northProjected: "4750000" };
const FILL = { ...TILE, ...BOX, ft: "3" };

const fill = (s) => {
  let out = s;
  for (const [k, v] of Object.entries(FILL)) out = out.replaceAll(`{${k}}`, v);
  return out;
};

/** Every endpoint literal in one source file's text, as written. */
export function findEndpoints(text) {
  return [...text.matchAll(ENDPOINT_RE)].map((m) => m[0].slice(1, -1));
}

// const NAME = "https://..." or const NAME = `${OTHER}/...`, with or without export, a string
// annotation or `as const`.
const CONST_RE =
  /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(?:"(https:\/\/[^"\n]*)"|`((?:https:\/\/|\$\{)[^`]*)`)/g;

/** The URL-ish string constants one file defines, as written: name to raw value. */
export function findConstants(text) {
  const out = new Map();
  for (const m of text.matchAll(CONST_RE)) out.set(m[1], m[2] ?? m[3]);
  return out;
}

/**
 * Resolves every file's constants to plain https URLs. A name a file defines itself wins there;
 * otherwise a name means the one value every file that defines it agrees on. Templates of other
 * constants resolve once their parts do. Returns lookup(rel, name) -> { value } or { why }.
 */
export function resolveConstants(defsByFile) {
  const local = new Map([...defsByFile.keys()].map((rel) => [rel, new Map()]));
  let global = new Map();
  let ambiguous = new Set();
  const lookup = (rel, name) => {
    const own = local.get(rel)?.get(name);
    if (own) return { value: own };
    if (defsByFile.get(rel)?.has(name)) return { why: `base \${${name}} has runtime parts` };
    if (ambiguous.has(name)) return { why: `base \${${name}} has more than one value under lib/ and app/` };
    if (global.has(name)) return { value: global.get(name) };
    return { why: `base \${${name}} is not a string constant under lib/ or app/` };
  };
  for (let round = 0, changed = true; changed && round < 10; round++) {
    changed = false;
    for (const [rel, defs] of defsByFile) {
      for (const [name, raw] of defs) {
        if (local.get(rel).has(name)) continue;
        let ok = true;
        const value = raw.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (_, n) => {
          const r = lookup(rel, n);
          if (r.value === undefined) ok = false;
          return r.value ?? "";
        });
        if (!ok || value.includes("${") || !value.startsWith("https://")) continue;
        local.get(rel).set(name, value);
        changed = true;
      }
    }
    const seen = new Map();
    for (const defs of local.values()) for (const [n, v] of defs) seen.set(n, (seen.get(n) ?? new Set()).add(v));
    global = new Map([...seen].filter(([, vs]) => vs.size === 1).map(([n, vs]) => [n, [...vs][0]]));
    ambiguous = new Set([...seen].filter(([, vs]) => vs.size > 1).map(([n]) => n));
  }
  return lookup;
}

/**
 * One file's text with every `${NAME}` that names a resolved constant written out, and the
 * service or tile templates whose base still did not resolve, with the reason.
 */
export function expandConstants(text, lookup) {
  const expanded = text.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (whole, n) => lookup(n).value ?? whole);
  const unresolved = [];
  for (const m of expanded.matchAll(/`\$\{([^}`]+)\}([^`]*)`/g)) {
    if (!SERVICE_OR_TILE.test(m[2])) continue;
    const name = m[1];
    const why = /^[A-Za-z_$][\w$]*$/.test(name) ? lookup(name).why : `base \${${name}} is an expression`;
    unresolved.push({ literal: m[0].slice(1, -1), why });
  }
  return { text: expanded, unresolved };
}

/**
 * What to request for one endpoint literal: the ArcGIS service root, a filled tile, or null
 * (not probed) with the reason.
 */
export function probeTarget(literal) {
  const ags = literal.match(/^(https:\/\/[^?#]*?\/(?:MapServer|ImageServer|FeatureServer))(\/\d+)?/);
  if (ags && !ags[0].includes("${")) {
    const root = fill(`${ags[1]}${ags[2] ?? ""}`);
    const left = root.match(PLACEHOLDER);
    if (left) return { kind: null, why: `unfilled ${left[0]}` };
    return { kind: "arcgis", url: `${root}?f=json` };
  }
  if (literal.includes("${")) return { kind: null, why: "runtime parts" };
  if (!PLACEHOLDER.test(literal)) return { kind: null, why: "not a service or a template (a page link)" };
  const url = fill(literal);
  const left = url.match(PLACEHOLDER);
  if (left) return { kind: null, why: `unfilled ${left[0]}` };
  return { kind: "tile", url };
}

/**
 * The verdict for one response. OK, DEAD (the publisher says the thing is gone or broken),
 * ODD (answered, but not with what we ask for) or EMPTY (a tile server's "no tile here").
 * ERR, a request that got no answer, comes from fetchOnce.
 */
export function classify(kind, status, contentType, body) {
  if (kind === "arcgis") {
    let j = null;
    try {
      j = JSON.parse(body.toString("utf8"));
    } catch {
      /* not JSON */
    }
    if (status >= 400) return { verdict: "DEAD", detail: `HTTP ${status}` };
    if (!j) return { verdict: "ODD", detail: `HTTP ${status}, not JSON (${contentType})` };
    if (j.error) return { verdict: "DEAD", detail: `HTTP ${status} with error ${j.error.code}: ${j.error.message}` };
    return { verdict: "OK", detail: String(j.name ?? j.mapName ?? j.currentVersion ?? "json") };
  }
  const hex = body.subarray(0, 4).toString("hex");
  const image = hex === "89504e47" ? "png" : hex.startsWith("ffd8ff") ? "jpeg" : body.subarray(8, 12).toString() === "WEBP" ? "webp" : null;
  if (status < 400 && image) return { verdict: "OK", detail: `${image} ${body.length} B` };
  if (status < 400 && /protobuf|pbf|mvt|octet-stream/.test(contentType)) return { verdict: "OK", detail: `${contentType} ${body.length} B` };
  if (status === 404 && body.length === 0) return { verdict: "EMPTY", detail: "404 with no body (no tile here)" };
  if (status >= 400) return { verdict: "DEAD", detail: `HTTP ${status} ${contentType}` };
  return { verdict: "ODD", detail: `HTTP ${status} ${contentType}, not an image` };
}

const FAILING = new Set(["DEAD", "ERR", "ODD"]);

/** Whether a first answer earns the retry. */
export const isFailing = (verdict) => FAILING.has(verdict);

/**
 * The one result for an endpoint from its first answer and, when that failed, the retry.
 * failing is true only when both tries failed; a mixed pair keeps both verdicts (ERR+DEAD).
 * recovered marks a failure the retry did not repeat, which is a warning.
 */
export function settle(first, second) {
  if (!isFailing(first.verdict) || !second) return { ...first, failing: false, recovered: false };
  if (!isFailing(second.verdict)) {
    return { verdict: second.verdict, detail: `${second.detail} (first try ${first.verdict}: ${first.detail})`, failing: false, recovered: true };
  }
  if (second.verdict === first.verdict) return { verdict: first.verdict, detail: `${second.detail} (twice)`, failing: true, recovered: false };
  return {
    verdict: `${first.verdict}+${second.verdict}`,
    detail: `first ${first.verdict}: ${first.detail}; then ${second.verdict}: ${second.detail}`,
    failing: true,
    recovered: false,
  };
}

/** Not-probed items counted by reason, most common first. */
export function countReasons(notProbed) {
  const by = new Map();
  for (const n of notProbed) by.set(n.why, (by.get(n.why) ?? 0) + 1);
  return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The known-outage entry an endpoint falls under, if any. */
export function knownOutage(url, known) {
  return known.find((k) => url.includes(k.match)) ?? null;
}

const DAY_MS = 86_400_000;

/**
 * How old a known outage is on the clock passed in, and its tier: info (under 7 days), warn
 * (7-29), stale (30-89, the louder warn) or fail (90 or more). A since that is not a real
 * YYYY-MM-DD date, or is after now, is fail too: an entry we can't age could hide forever.
 */
export function ageTier(since, now) {
  const m = typeof since === "string" ? since.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  const start = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (!m || new Date(start).toISOString().slice(0, 10) !== since) {
    return { days: null, tier: "fail", why: `since ${JSON.stringify(since ?? null)} is not a YYYY-MM-DD date` };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((today - start) / DAY_MS);
  if (days < 0) return { days, tier: "fail", why: `since ${since} is in the future` };
  if (days >= 90) return { days, tier: "fail", why: `down ${days} days (90 or more): replace or drop the layer` };
  if (days >= 30) return { days, tier: "stale", why: `down ${days} days (30 or more): fails the run at 90` };
  if (days >= 7) return { days, tier: "warn", why: `down ${days} days (7 or more)` };
  return { days, tier: "info", why: `down ${days} day${days === 1 ? "" : "s"}` };
}

/**
 * Every known-outage entry checked against the probed URLs on the clock passed in. One row per
 * entry, with matched (its match hits at least one probed URL) and failing (its tier is fail,
 * or it matched nothing).
 */
export function assessKnown(known, probedUrls, now) {
  return known.map((entry) => {
    const age = ageTier(entry.since, now);
    const matched = typeof entry.match === "string" && entry.match !== "" && probedUrls.some((u) => u.includes(entry.match));
    const why = matched ? age.why : `match ${JSON.stringify(entry.match ?? null)} hits no probed URL: remove the entry or fix its match; ${age.why}`;
    return { entry, ...age, why, matched, failing: !matched || age.tier === "fail" };
  });
}

/** One line per known-outage entry, for the log and the run summary. */
export function knownLines(rows) {
  return rows.map((r) => `${(r.failing ? "FAIL" : r.tier.toUpperCase()).padEnd(5)} ${r.entry.match} (since ${r.entry.since}): ${r.why}`);
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== "node_modules" && !ent.name.startsWith(".")) walk(p, out);
    } else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) out.push(p);
  }
  return out;
}

/**
 * What the sweep would probe under one app root (apps/map), read from its lib/ and app/ source:
 * targets maps each probe URL to { kind, url, files }, and notProbed lists the rest with a reason.
 * Reads files only; no request.
 */
export function discoverTargets(root) {
  const sources = new Map();
  for (const file of [...walk(path.join(root, "lib")), ...walk(path.join(root, "app"))]) {
    sources.set(path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8"));
  }
  const lookup = resolveConstants(new Map([...sources].map(([rel, text]) => [rel, findConstants(text)])));

  const targets = new Map();
  const notProbed = [];
  for (const [rel, raw] of sources) {
    const { text, unresolved } = expandConstants(raw, (name) => lookup(rel, name));
    for (const u of unresolved) notProbed.push({ rel, ...u });
    for (const literal of findEndpoints(text)) {
      const t = probeTarget(literal);
      if (!t.kind) {
        notProbed.push({ rel, literal, why: t.why });
        continue;
      }
      if (!targets.has(t.url)) targets.set(t.url, { ...t, files: new Set() });
      targets.get(t.url).files.add(rel);
    }
  }
  return { targets, notProbed };
}

/** GitHub annotations for the known-outage rows, so a warn shows on the run page. */
function annotate(rows) {
  if (!process.env.GITHUB_ACTIONS) return;
  for (const r of rows) {
    const level = r.failing ? "error" : r.tier === "info" ? "notice" : "warning";
    console.log(`::${level} title=Known outage ${r.failing ? "fails the run" : r.tier}::${r.entry.match}: ${r.why}`);
  }
}

async function fetchOnce(target) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const r = await fetch(target.url, {
      headers: { "user-agent": "gods-eye-view endpoint sweep (read-only health check)" },
      signal: ac.signal,
      redirect: "follow",
    });
    const body = Buffer.from(await r.arrayBuffer());
    return classify(target.kind, r.status, r.headers.get("content-type") ?? "", body);
  } catch (e) {
    const why = e?.name === "AbortError" ? "timeout 30 s" : (e?.cause?.code ?? e?.message ?? String(e));
    return { verdict: "ERR", detail: why };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  dns.setDefaultResultOrder("ipv4first");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const known = JSON.parse(fs.readFileSync(path.join(root, "scripts", "endpoint-sweep.known.json"), "utf8")).outages;

  const { targets, notProbed } = discoverTargets(root);
  // The known-outage entries age by today's date (UTC) and must each still match a probed URL.
  const knownRows = assessKnown(known, [...targets.keys()], new Date());
  const knownFailing = knownRows.filter((r) => r.failing);
  const knownText = knownLines(knownRows);
  annotate(knownRows);
  const reasons = countReasons(notProbed);
  const notProbedLines = reasons.flatMap(([why]) => [
    `${why}:`,
    ...notProbed.filter((n) => n.why === why).map((n) => `  ${n.literal}  [${n.rel}]`),
  ]);
  const reasonText = reasons.map(([why, n]) => `${why} ${n}`).join("; ");
  const list = [...targets.values()];
  if (process.argv.includes("--list")) {
    for (const t of list) console.log(`${t.kind.padEnd(6)} ${t.url}`);
    console.log(`\nNot probed:\n${notProbedLines.join("\n")}`);
    console.log(`\n${list.length} to probe, ${notProbed.length} not probed (${reasonText})`);
    console.log(`\nKnown outages (endpoint-sweep.known.json):\n${knownText.join("\n") || "none"}`);
    if (knownFailing.length) process.exitCode = 1;
    return;
  }

  const results = [];
  for (let i = 0; i < list.length; i += 4) {
    results.push(...(await Promise.all(list.slice(i, i + 4).map(async (t) => ({ ...t, first: await fetchOnce(t) })))));
  }
  // One retry, one at a time, for anything that did not answer OK.
  const again = results.filter((r) => isFailing(r.first.verdict));
  if (again.length) await new Promise((r) => setTimeout(r, 20_000));
  for (const r of results) Object.assign(r, settle(r.first, again.includes(r) ? await fetchOnce(r) : null));

  const newlyFailing = [];
  const lines = [];
  for (const r of results.sort((a, b) => a.verdict.localeCompare(b.verdict))) {
    const k = knownOutage(r.url, known);
    let tag = r.verdict;
    if (r.failing && k) tag = `KNOWN ${r.verdict}`;
    else if (r.failing) newlyFailing.push(r);
    else if (k && r.verdict === "OK") tag = "BACK";
    else if (r.recovered) tag = `${r.verdict} (warn)`;
    const age = k ? knownRows.find((row) => row.entry === k) : null;
    const knownNote = k ? ` | known outage since ${k.since} (${age.days ?? "?"} days, ${age.failing ? "fails the run" : age.tier}): ${k.note}` : "";
    lines.push(`${tag.padEnd(5)} ${r.kind.padEnd(6)} ${r.url}\n      ${r.detail}${knownNote}  [${[...r.files].join(", ")}]`);
  }
  console.log(lines.join("\n"));
  const count = {};
  for (const r of results) count[r.verdict] = (count[r.verdict] ?? 0) + 1;
  const back = results.filter((r) => r.verdict === "OK" && knownOutage(r.url, known));
  const recovered = results.filter((r) => r.recovered);
  const summary = [
    `Probed ${results.length} ArcGIS services and tile templates found in lib/ and app/ (JSON APIs and file downloads are not covered).`,
    `Not probed ${notProbed.length}: ${reasonText || "none"}.`,
    `Verdicts: ${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    newlyFailing.length
      ? `NEWLY FAILING on both tries (fails the run): ${newlyFailing.map((r) => `${r.url} (${r.verdict})`).join(" ; ")}`
      : "No upstream newly failing on both tries.",
    recovered.length ? `Warning, failed once then answered: ${recovered.map((r) => `${r.url} (${r.first.verdict})`).join(" ; ")}` : "",
    back.length ? `Back up (remove from endpoint-sweep.known.json): ${back.map((r) => r.url).join(" ; ")}` : "",
    knownFailing.length
      ? `KNOWN OUTAGE ENTRIES that fail the run (90 days or more, no match, or a bad since): ${knownFailing.map((r) => `${r.entry.match} (${r.why})`).join(" ; ")}`
      : "",
    ...knownText.map((l) => `Known outage: ${l}`),
  ].filter(Boolean);
  console.log(`\n${summary.join("\n")}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Endpoint sweep\n\n${summary.map((s) => `- ${s}`).join("\n")}\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n\n### Not probed\n\n\`\`\`\n${notProbedLines.join("\n")}\n\`\`\`\n`,
    );
  }
  if (newlyFailing.length || knownFailing.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
