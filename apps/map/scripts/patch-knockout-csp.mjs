// Knockout 3.5.1, vendored inside @cesium/widgets, opens with
//
//   var A = this || (0,eval)("this");
//
// the classic UMD trick for finding the global object. Bundled as an ES
// module, top-level `this` is undefined, so the `(0,eval)` branch always runs
// — and a Content-Security-Policy without 'unsafe-eval' refuses it. The throw
// happens during module evaluation, which kills the whole Cesium chunk: the
// globe never boots and the page is left as empty HUD chrome over black. See
// next.config.ts for the policy this keeps strict.
//
// `globalThis` is what that expression is reaching for and has been in every
// browser we support since 2019, so the rewrite is a no-op at runtime and
// costs the policy nothing. Idempotent: re-running finds nothing to do, and a
// Cesium release that fixes this upstream simply makes it a no-op too.
//
// Runs on postinstall, predev and prebuild, so every install (local, CI,
// Vercel) gets it before the bundler sees the file.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const NEEDLE = `(0,eval)("this")`;
const FIX = "globalThis";
const FILE = "@cesium/widgets/Source/ThirdParty/knockout-3.5.1.js";

let path;
try {
  path = require.resolve(FILE);
} catch {
  // Cesium moved or dropped its vendored Knockout: nothing to patch, and the
  // CSP smoke test in the build will catch it if the globe stops booting.
  console.log(`[patch-knockout-csp] ${FILE} not found; skipping`);
  process.exit(0);
}

const src = readFileSync(path, "utf8");
if (!src.includes(NEEDLE)) {
  console.log("[patch-knockout-csp] already CSP-safe");
  process.exit(0);
}

const out = src.split(NEEDLE).join(FIX);
writeFileSync(path, out);
console.log(`[patch-knockout-csp] rewrote ${src.split(NEEDLE).length - 1} eval() call(s) to globalThis in Knockout`);
