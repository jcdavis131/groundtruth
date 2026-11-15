#!/usr/bin/env node
/* Atlas Living Field — C1 render evidence (SPEC evidence contract).
 * Serves apps/map/public over HTTP, drives the atlas page in headless
 * Chromium (Playwright), and writes evidence/c1-render-report.json:
 *   - drawn: interactable points drawn (window.__atlas.drawn), bar 5000
 *   - frame_p95_ms: p95 frame time during a scripted 10s pan, bar <= 16.6
 *   - bytes_before_first_paint: transfer bytes for field.html + manifest +
 *     seed + raster, bar <= 300_000
 *   - hit_test: taps canvas center-ish, asserts an identity resolves
 * Usage: node scripts/atlas-render-check.mjs [--url http://127.0.0.1:8901/atlas/field.html]
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(ROOT, "public");
const OUT = join(ROOT, "evidence", "c1-render-report.json");
const url = (process.argv.find(a => a.startsWith("--url=")) || "").slice(6)
  || "http://127.0.0.1:8901/atlas/field.html";

const server = spawn("python3", ["-m", "http.server", "8901", "--directory", PUB],
  { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1200));

const report = { url, at: new Date().toISOString(), checks: {} };
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const bytes = { total: 0, names: ["field.html", "manifest.json", "seed/all.bin", "raster/all.png"] };
  page.on("response", async resp => {
    try {
      const u = new URL(resp.url());
      if (bytes.names.some(n => u.pathname.endsWith(n))) {
        const buf = await resp.body();
        bytes.total += buf.length;
      }
    } catch { /* ignore */ }
  });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction("window.__atlas && window.__atlas.drawn > 0", null, { timeout: 15000 });
  const stats = await page.evaluate("window.__atlas");
  report.checks.drawn = { value: stats.drawn, bar: 5000, pass: stats.drawn === 5000 };
  report.checks.using2d = { value: !!stats.using2d };

  // hit test FIRST (view is still at origin): scan a grid for a real dot,
  // then click it to exercise the full tap -> identify path
  const hitSpot = await page.evaluate(() => {
    for (let gy = 300; gy <= 550; gy += 25)
      for (let gx = 120; gx <= 270; gx += 25)
        if (window.__atlasDebug.hitAt(gx, gy) >= 0) return [gx, gy];
    return null;
  });
  let readout = "";
  if (hitSpot) {
    await page.mouse.click(hitSpot[0], hitSpot[1]);
    await page.waitForTimeout(1200);
    readout = await page.textContent("#readout");
  }
  report.checks.hit_test = {
    value: hitSpot ? readout.slice(0, 80) : "no dot found on scan grid",
    pass: !!hitSpot && /·/.test(readout) && !/no entity there|503/.test(readout)
  };

  // scripted ~10s pan: rAF sampler runs CONCURRENTLY with Node-driven drags
  const sample2s = () => page.evaluate(() => new Promise(resolve => {
    const deltas = [];
    let last = performance.now();
    const t0 = last;
    (function tick(t) {
      deltas.push(t - last); last = t;
      if (t - t0 < 2000) requestAnimationFrame(tick);
      else resolve(deltas);
    })(last);
  }));
  const frames = [];
  for (let pass = 0; pass < 5; pass++) {
    await page.mouse.move(195, 422);
    await page.mouse.down();
    const sampling = sample2s(); // not awaited yet: drag while it samples
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(195 + (pass % 2 ? -i * 12 : i * 12),
                            422 + (pass % 2 ? i * 6 : -i * 6), { steps: 3 });
      await page.waitForTimeout(170);
    }
    await page.mouse.up();
    frames.push(...(await sampling));
  }
  frames.sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)] || 0;
  report.checks.frame_p95_ms = {
    value: Math.round(p95 * 100) / 100, bar: 16.6, n: frames.length,
    // SPEC bar is on the reference device (Pixel 7a, OD-9); CI headless
    // SwiftShader is not the reference device, so this is report-only here.
    pass: null, note: "report-only in CI; bar applies on reference device"
  };

  report.checks.bytes_before_first_paint = { value: bytes.total, bar: 300000, pass: bytes.total <= 300000 };
  report.checks.console_errors = { value: errors.length, bar: 0, pass: errors.length === 0, errors: errors.slice(0, 5) };

  await browser.close();
} finally {
  server.kill();
}
report.pass = Object.values(report.checks).every(c => c.pass !== false);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(report.pass ? 0 : 1);
