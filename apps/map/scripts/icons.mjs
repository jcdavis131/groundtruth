// Renders public/icon.svg to the PNG sizes the manifest and iOS want.
// Needs `npm i --no-save playwright-core` and a Chromium (GEV_SHOT_BROWSER).
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const svg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: process.env.GEV_SHOT_BROWSER || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const page = await browser.newPage();
const targets = [
  ["public/icon-192.png", 192, false],
  ["public/icon-512.png", 512, false],
  ["public/apple-touch-icon.png", 180, false],
  // Maskable: the artwork sits inside the safe zone (80% circle) on a solid ground.
  ["public/icon-maskable-512.png", 512, true],
];
for (const [file, size, maskable] of targets) {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable ? svg.replace('rx="96"', 'rx="0"').replace('viewBox="0 0 512 512"', 'viewBox="-64 -64 640 640"') : svg;
  await page.setContent(`<html><body style="margin:0;background:#03070a">${inner.replace(/width="512" height="512"/, `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("wrote", file);
}
await browser.close();
