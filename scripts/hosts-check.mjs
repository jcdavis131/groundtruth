// hosts-check: AGENTS.md's "Public, keyless sources only. No paid APIs", as a check.
// Every host that non-test source under apps/map names must be classified in apps/map/lib/server/hosts.allow.json:
// what it is (request, link or identifier), and for a host the app requests, who publishes it and whether it needs
// a key. A new host fails until someone writes that entry; an entry no code names any more fails too.
//
//   node scripts/hosts-check.mjs            check apps/map beside this script
//   node scripts/hosts-check.mjs <dir>      check another apps/map checkout (its lib/server/hosts.allow.json)
//
// Plain Node, no install. The scan and the rules are apps/map/lib/server/hosts.scan.mjs, the same module
// apps/map/lib/server/hosts.test.ts runs in map-ci, so this script holds no logic of its own. Its header says what
// the check sees and what it cannot. Exit 0 when clean, 1 with one line per problem.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, "..", "apps", "map"));
const { checkAllowlist, describeProblems, loadAllowlist, scanHosts, settingsKeyIds } = await import(
  pathToFileURL(path.join(root, "lib", "server", "hosts.scan.mjs")).href
);

const scan = scanHosts(root);
const res = checkAllowlist(scan, loadAllowlist(path.join(root, "lib", "server", "hosts.allow.json")), { keyIds: settingsKeyIds(root) });
const lines = describeProblems(res);
if (lines.length > 0) {
  console.error(lines.join("\n"));
  console.error(`hosts-check: ${lines.length} problem(s) in ${scan.hosts.size} hosts across ${scan.files} files`);
  process.exit(1);
}
console.log(`hosts-check: ${scan.hosts.size} hosts across ${scan.files} files, every one classified in lib/server/hosts.allow.json`);
