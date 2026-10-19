// HUD screenshots at phone, tablet and desktop sizes against a running server
// (default http://localhost:3100). Needs a Chromium (the remote environment
// ships one under /opt/pw-browsers) plus `npm i --no-save playwright-core`.
//
//   node scripts/hud-shots.mjs <outDir> '<scenarios json>'
//   scenario: { name, viewport:{width,height}, mobile?:bool, query?:"?lat=..", wait?:ms,
//               actions?: [{ nav:"Market" } | { label:"Expand panel" } | { click:"css" } | { eval:"js" } | { wait: ms }] }
//
// GEV_SHOT_BROWSER points at another Chromium executable; GEV_SHOT_BASE at
// another origin. Prints one line per shot with the document's scroll width
// so horizontal overflow shows up as a number, not a hunch.
import { chromium } from "playwright-core";

const out = process.argv[2] || ".";
const scenarios = JSON.parse(process.argv[3] || "[]");
const base = process.env.GEV_SHOT_BASE || "http://localhost:3100";
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const browser = await chromium.launch({
  executablePath: process.env.GEV_SHOT_BROWSER || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
for (const sc of scenarios) {
  const mobile = sc.mobile ?? true;
  const ctx = await browser.newContext({ viewport: sc.viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? PHONE_UA : undefined });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", sc.name, e.message.slice(0, 200)));
  await page.goto(base + "/" + (sc.query || ""), { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(sc.wait ?? 4000);
  for (const a of sc.actions ?? []) {
    try {
      if (a.nav) await page.locator("nav button", { hasText: a.nav }).first().click({ timeout: 8000 });
      if (a.label) await page.locator(`button[aria-label="${a.label}"]`).first().click({ timeout: 8000 });
      if (a.click) await page.click(a.click, { timeout: 5000 });
      if (a.eval) await page.evaluate(a.eval);
      if (a.wait) await page.waitForTimeout(a.wait);
    } catch (e) {
      console.log("ACTIONFAIL", sc.name, JSON.stringify(a), e.message.split("\n")[0]);
    }
  }
  await page.screenshot({ path: `${out}/${sc.name}.png` });
  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  console.log("SHOT", sc.name, JSON.stringify(overflow));
  await ctx.close();
}
await browser.close();
