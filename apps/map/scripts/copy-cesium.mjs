// Copies Cesium's static runtime assets (web workers, third-party libs,
// textures, widget CSS) into public/cesium so the browser can load them from
// CESIUM_BASE_URL. Runs on postinstall, predev and prebuild. Idempotent.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const cesiumPkg = dirname(require.resolve("cesium/package.json"));
const src = join(cesiumPkg, "Build", "Cesium");
const dest = join(process.cwd(), "public", "cesium");
const version = JSON.parse(readFileSync(join(cesiumPkg, "package.json"), "utf8")).version;
const stamp = join(dest, ".version");

if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === version) {
  console.log(`[copy-cesium] public/cesium already at ${version}`);
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const dir of ["Workers", "ThirdParty", "Assets", "Widgets"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
writeFileSync(stamp, version);
console.log(`[copy-cesium] copied Cesium ${version} assets -> public/cesium`);
