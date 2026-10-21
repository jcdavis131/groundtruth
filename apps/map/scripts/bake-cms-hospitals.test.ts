import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cmsSlice from "@/lib/infra/fixtures/cms-tx.json";
import raptSlice from "@/lib/infra/fixtures/rapt-tx.slice.json";

// scripts/bake-cms-hospitals.mjs writes lib/infra/data/cms-hospitals.json. A live run asks CMS and FEMA, so it is never
// run here; the script's --from mode rebuilds the same file from a saved set of the answers with no network, and that is
// what these cases run: the repo's own slices of the two answers (lib/infra/fixtures, unmodified) as page 0 of each, and
// `{}` for the metastore and the layer description, which state nothing, so the bake records no modified or last-edit
// date. Nothing is asked of a publisher and nothing is invented.
//
// meta.builtAt is when the script wrote the file after reading the answers. A live run stamps new Date(); a rebuild
// from saved answers cannot know when they were read, so it stamps nothing unless --built-at says when. The committed
// bake has no builtAt (nothing recorded when it was built), and this test does not touch it: --out is a scratch file.

const APP = path.resolve(__dirname, "..");
const SCRIPT = path.join(APP, "scripts", "bake-cms-hospitals.mjs");
const AT = "2026-10-21T09:08:07.006Z";

describe("scripts/bake-cms-hospitals.mjs: the build time it records in the bake's meta", () => {
  let dir: string;
  let saved: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gev-bake-cms-"));
    saved = path.join(dir, "saved");
    await mkdir(saved);
    const files: Record<string, unknown> = { "cms-metastore": {}, "cms-0": cmsSlice, "hifld-layer": {}, "hifld-0": raptSlice };
    for (const [name, body] of Object.entries(files)) await writeFile(path.join(saved, `${name}.json`), JSON.stringify(body));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  /** Run the script on the saved answers, writing to a scratch file (--out is relative to apps/map). */
  function bake(name: string, ...extra: string[]) {
    const out = path.join(dir, name);
    const run = spawnSync(process.execPath, [SCRIPT, "--from", saved, "--out", path.relative(APP, out), ...extra], { cwd: APP, encoding: "utf8", timeout: 60_000 });
    return { run, out };
  }
  const read = async (file: string) => readFile(file, "utf8");
  const metaOf = (text: string) => (JSON.parse(text) as { meta: Record<string, unknown> }).meta;

  it("given --built-at it records that instant as meta.builtAt, and a rerun with the same instant is byte-identical", async () => {
    const a = bake("a.json", "--built-at", AT);
    expect(a.run.status, `${a.run.stdout}\n${a.run.stderr}`).toBe(0);
    const text = await read(a.out);
    expect(metaOf(text).builtAt).toBe(AT);
    expect(Number(metaOf(text).attached), "a real bake of the slices, not an empty file").toBeGreaterThan(0);
    const b = bake("b.json", "--built-at", AT);
    expect(b.run.status, `${b.run.stdout}\n${b.run.stderr}`).toBe(0);
    expect(await read(b.out)).toBe(text);
  });

  it("a rebuild from saved answers given no --built-at records none: it cannot know when they were read, and writes no key and no null", async () => {
    const a = bake("none.json");
    expect(a.run.status, `${a.run.stdout}\n${a.run.stderr}`).toBe(0);
    const meta = metaOf(await read(a.out));
    expect(Object.keys(meta)).not.toContain("builtAt");
    expect(meta.cmsModified, "the saved metastore stated no modified date").toBeNull();
    expect(meta.hifldDataLastEdit, "the saved layer description stated no last-edit date").toBeNull();
  });

  // 'yesterday' fails the shape. 2026-02-31T00:00:00.000Z passes the shape and Date.parse (V8 reads it as 2026-03-03), so
  // only a round trip through toISOString() shows it is not on the calendar. Each probe gets its own --out, so a file
  // one wrote cannot be mistaken for another's.
  const REFUSED = ["yesterday", "2026-02-31T00:00:00.000Z"];
  it("refuses a --built-at that is not a calendar-valid ISO 8601 UTC instant, shaped like one or not, and writes no file", async () => {
    for (const [i, bad] of REFUSED.entries()) {
      const a = bake(`bad-${i}.json`, "--built-at", bad);
      expect(a.run.status, `--built-at ${bad}: ${a.run.stdout}\n${a.run.stderr}`).toBe(2);
      expect(a.run.stderr, `--built-at ${bad}`).toContain("--built-at");
      await expect(read(a.out), `--built-at ${bad} wrote a file`).rejects.toThrow();
    }
  });

  it("a live run (no --from) stamps the instant it wrote the file, new Date().toISOString(), after reading the answers; read from the script's source, because running it would ask the publishers", async () => {
    const script = await read(SCRIPT);
    expect(script).toMatch(/const builtAt = [^;\n]*\? null : new Date\(\)\.toISOString\(\)/);
    const call = script.indexOf("bakeCms(cms, hifld");
    expect(call, "the script calls bakeCms").toBeGreaterThan(0);
    expect(script.slice(call, script.indexOf("});", call)), "bakeCms is handed it").toMatch(/\bbuiltAt\b/);
    expect(script.indexOf("const builtAt ="), "stamped after the answers are read").toBeGreaterThan(script.indexOf("hifld.push("));
  });
});
