// Self-test for eval/gold/build-gold.mjs. Plain Node (22.18+), no install, no network.
//   node eval/gold.test.mjs
// Every publisher URL below is read out of a recorded reply's header in apps/map/lib/cite/__fixtures__/publisher/
// (never typed here); every expected value is read from the recorded body by this test with its own regex, so the
// matcher is not the oracle for itself. Question strings are labels for the test, never graded.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { itemId, marker } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const script = path.join(here, "gold", "build-gold.mjs");
const FIX = path.join(repo, "apps", "map", "lib", "cite", "__fixtures__", "publisher");
const sha = (b) => createHash("sha256").update(b).digest("hex");
let failed = 0;
const check = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${msg}`);
};

const rec = (src, id) => JSON.parse(readFileSync(path.join(FIX, src, `${id}.json`), "utf8"));
const svi = rec("cdc-svi", "48453.a6392c62");
const nri = rec("fema-nri", "48453.83bef9a8");
const cmsNA = rec("cms-provider-data", "390272.d1001587");
const cms3 = rec("cms-provider-data", "450056.e1a254a4");
const sviValue = Number(/"RPL_THEMES":([-\d.]+)/.exec(svi.body)[1]);
const nriRating = /"SOVI_RATNG":"([^"]+)"/.exec(nri.body)[1];
const cmsRating = /"hospital_overall_rating":"([^"]+)"/.exec(cms3.body)[1];
check(/Not Available/.test(cmsNA.body) && sviValue >= 0 && nriRating.length > 0 && cmsRating.length > 0, "the recorded replies carry what the expectations below are read from");

const q = (n) => `build-gold test question ${n}`;
const SVI = { sourceId: "cdc-svi", fact: "CDC/ATSDR SVI 2022 overall percentile", code: "48453", upstreamRecordUrl: svi.url, retrievedAt: svi.retrievedAt, field: "RPL_THEMES" };
const NRI = { sourceId: "fema-nri", fact: "FEMA NRI social vulnerability rating (Census Community Resilience Estimate; not CDC SVI)", code: "48453", upstreamRecordUrl: nri.url, retrievedAt: nri.retrievedAt, field: "SOVI_RATNG" };
const CMS = (r, id) => ({ sourceId: "cms-provider-data", fact: "CMS overall hospital star rating", code: id, upstreamRecordUrl: r.url, retrievedAt: r.retrievedAt, field: "hospital_overall_rating" });
// The NID layer has no recorded reply yet (groundtruth issue #71: the endpoint answers 503). The URL is the shape the host table accepts.
const NID = { sourceId: "usace-nid", fact: "dam", code: "nid:XX00001", upstreamRecordUrl: "https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0/query?where=NIDID%3D'XX00001'&outFields=NIDID,NAME&returnGeometry=false&f=json", retrievedAt: "2026-10-20T00:00:00.000Z", field: "NIDID" };
const PUB = "https://example.test/publisher-record-page";

const tasks = {
  tasks: [
    { question: q("svi"), placeKind: "county", type: "number", queries: [SVI] },
    { question: q("nri"), placeKind: "county", type: "exact", queries: [NRI] },
    { question: q("cms-flag"), placeKind: "hospital", type: "exact", queries: [CMS(cmsNA, "390272")] },
    { question: q("cms-3"), placeKind: "hospital", type: "exact", queries: [CMS(cms3, "450056")] },
    { question: q("list"), placeKind: "county", type: "list", queries: [{ ...SVI, decimals: 4 }, NRI] },
    { question: q("nid"), placeKind: "dam", type: "exact", queries: [NID] },
    { question: q("route-pr"), placeKind: "territory", type: "exact", routeMissing: { reason: "source:not_published_for_puerto_rico", url: PUB } },
    { question: q("route-release"), placeKind: "county", type: "exact", routeMissing: { reason: "source:not_in_release", url: PUB } },
    { question: q("route-join"), placeKind: "county", type: "exact", routeMissing: { reason: "join:multi_county", url: PUB } },
    { question: q("route-failed"), placeKind: "county", type: "exact", routeMissing: { reason: "source:failed", url: PUB } },
    { question: q("none"), placeKind: "county", type: "exact", unrecorded: "no recorded publisher reply answers this question" },
    { question: q("route-nourl"), placeKind: "county", type: "exact", routeMissing: { reason: "source:not_in_release" } },
  ],
};

const dir = mkdtempSync(path.join(tmpdir(), "gold-"));
const tasksFile = path.join(dir, "tasks.json");
writeFileSync(tasksFile, JSON.stringify(tasks));
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

// 1. refuses an --out path inside the git root, prints no hash, writes nothing
const inside = path.join(repo, "eval", "out-must-not-exist.json");
let r = run(["--tasks", tasksFile, "--out", inside]);
check(r.status !== 0 && r.stdout === "" && !existsSync(inside), "refuses --out inside the git root: non-zero exit, empty stdout, no file");
const insideDeep = path.join(repo, "apps", "..", "eval", "x", "..", "out-must-not-exist2.json");
r = run(["--tasks", tasksFile, "--out", insideDeep]);
check(r.status !== 0 && r.stdout === "" && !existsSync(path.join(repo, "eval", "out-must-not-exist2.json")), "refuses an --out that reaches the git root through ..");

// 2. a valid run prints only the sha256 of the file it wrote
const out = path.join(dir, "gold-out.json");
r = run(["--tasks", tasksFile, "--out", out]);
check(r.status === 0 && /^[0-9a-f]{64}\n$/.test(r.stdout), "a valid run prints only a sha256 and a newline to stdout");
const buf = readFileSync(out);
check(r.stdout.trim() === sha(buf), "the printed sha256 is the sha256 of the written file");
const gold = JSON.parse(buf.toString("utf8"));
check(gold.marker === marker("gold"), "the gold file carries the gold header marker");
const items = gold.items;
const row = (n) => items[itemId(q(n))];

// 3. hand-read expectations
check(row("svi")?.verdict === "PUBLISHED" && row("svi").gold === sviValue && row("svi").type === "number" && row("svi").tolerance === 0.00005, `svi row: PUBLISHED, gold ${sviValue} read from the recorded body, the matcher's declared tolerance`);
check(row("nri")?.verdict === "PUBLISHED" && row("nri").gold === nriRating, `nri row: PUBLISHED, gold "${nriRating}"`);
check(row("cms-3")?.verdict === "PUBLISHED" && String(row("cms-3").gold) === cmsRating, `cms row: PUBLISHED, gold ${cmsRating}`);
check(row("cms-flag")?.verdict === "NOT_PUBLISHED" && row("cms-flag").gold === null && /Not Available/.test(row("cms-flag").flag), "cms 'Not Available' is NOT_PUBLISHED from the publisher's own flag, gold null");
check(JSON.stringify(row("list")?.gold) === JSON.stringify([sviValue.toFixed(4), nriRating]) && row("list").type === "list", "list row: both publisher values, the SVI to the declared 4 places");
check(row("route-pr")?.verdict === "NOT_PUBLISHED" && row("route-pr").flag.includes("not_published"), "a route's not_published missing entry gives NOT_PUBLISHED");
check(row("route-release")?.verdict === "NOT_PUBLISHED" && row("route-release").flag.includes("not_in_release"), "a route's not_in_release missing entry gives NOT_PUBLISHED");

// 4. every gold row carries its publisher URL and a verdict
const all = Object.values(items);
check(all.length > 0 && all.every((x) => /^https:\/\//.test(x.url ?? "") && ["PUBLISHED", "NOT_PUBLISHED"].includes(x.verdict)), "every gold row has an https publisher URL and a verdict");
check(row("svi")?.url === svi.url && row("cms-flag")?.url === cmsNA.url && row("route-pr")?.url === PUB, "each row's URL is the one its query named");
check(row("svi")?.sha256 === svi.sha256, "a matcher-derived row carries the sha256 of the recorded body it rests on");

// 5. not gold: no recorded reply (NID), a route code that is not an abstain code, a route entry with no URL
for (const n of ["nid", "none", "route-join", "route-failed", "route-nourl"]) check(row(n) === undefined, `${n} is not a gold row`);
const side = JSON.parse(readFileSync(out + ".unrecorded.json", "utf8"));
const why = (n) => side.unrecorded.find((u) => u.id === itemId(q(n)))?.reason ?? "";
check(side.unrecorded.length === 5 && /no recorded publisher reply answers/.test(why("none")) && /no recorded reply/.test(why("nid")), "NID is listed UNRECORDED (no recorded reply), not gold");
check(/join_gap/.test(why("route-join")) && /failed/.test(why("route-failed")), "join_gap and failed route entries are listed, never turned into NOT_PUBLISHED");
check(/no publisher URL/.test(why("route-nourl")), "a route entry with no publisher URL is listed, not gold");
check(Object.keys(items).length + side.unrecorded.length === tasks.tasks.length, "every task is a gold row or listed: none dropped silently");

// 6. refuses to overwrite a sealed gold file
const before = sha(readFileSync(out));
r = run(["--tasks", tasksFile, "--out", out]);
check(r.status !== 0 && r.stdout === "" && sha(readFileSync(out)) === before, "refuses to overwrite an existing gold file");

// 7. a task whose question is not in the pool is refused
const poolFile = path.join(dir, "pool.json");
writeFileSync(poolFile, JSON.stringify({ pool: [{ question: q("svi"), placeKind: "county", sources: ["t"] }] }));
const out2 = path.join(dir, "gold-out2.json");
r = run(["--tasks", tasksFile, "--pool", poolFile, "--out", out2]);
check(r.status !== 0 && r.stdout === "" && !existsSync(out2), "a task whose question is not in --pool is refused");

// 8. the same inputs give the same bytes
const out3 = path.join(dir, "gold-out3.json");
r = run(["--tasks", tasksFile, "--out", out3]);
check(r.status === 0 && r.stdout.trim() === sha(buf), "the same tasks give a byte-identical gold file");

console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
