// Polite, cached HTTP for the athlete builder. Plain Node 22+ (global fetch), no install.
//
// - One request at a time, at least `gapMs` apart, with a User-Agent that names the project.
// - 429 and 5xx back off (Retry-After when given) and retry, then fail.
// - Every 200 body is cached under <data-root>/raw/athletes/<sha256 of method, url and body>.body with a
//   .json beside it ({url, status, retrievedAt, bytes, sha256}). A cached body is checked against its
//   sha256 before use and keeps its first retrievedAt, so a rerun cites when the bytes were really read.
// - A request that names Wikidata's date of birth (P569), or another personal property on the never-list,
//   is refused before it is sent, as a filter too.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const UA = "groundtruth-athletes/0.1 (https://github.com/jcdavis131/groundtruth; research data build)";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// P569 date of birth, P570 date of death, P26 spouse, P40 child, P22 father, P25 mother, P3373 sibling,
// P1038 relative, P551 residence, P6375 street address.
const NEVER = ["P569", "P570", "P26", "P40", "P22", "P25", "P3373", "P1038", "P551", "P6375"];

/** Throws when a request names a never-list Wikidata property. */
export function refuseNeverList(text) {
  const hit = NEVER.find((p) => new RegExp(`\\b${p}\\b`).test(text));
  if (hit) throw new Error(`refused: the request names ${hit}, a never-list property; athlete builds never ask for it`);
}

const cacheKey = (method, url, body) => sha(`${method}\n${url}\n${body ?? ""}`);

export function makeClient({ rawDir, gapMs = 1500, log = () => {}, offline = false, fetchImpl = globalThis.fetch }) {
  mkdirSync(rawDir, { recursive: true });
  const requests = [];
  let last = 0;

  /** Where a GET's cached body lives. */
  const bodyPath = (url) => path.join(rawDir, `${cacheKey("GET", url)}.body`);

  async function request(url, { method = "GET", body, accept, purpose, contentType } = {}) {
    refuseNeverList(url + (body ?? ""));
    const key = cacheKey(method, url, body);
    const bodyFile = path.join(rawDir, `${key}.body`);
    const metaFile = path.join(rawDir, `${key}.json`);
    const note = (meta, cached) =>
      requests.push({ purpose, method, url, bodySha256: body ? sha(body) : undefined, status: meta.status, retrievedAt: meta.retrievedAt, bytes: meta.bytes, sha256: meta.sha256, cached });
    if (existsSync(bodyFile) && existsSync(metaFile)) {
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      const buf = readFileSync(bodyFile);
      if (sha(buf) === meta.sha256) {
        note(meta, true);
        return { buf, meta };
      }
      log(`cached body for ${url} fails its sha256; refetching`);
    }
    if (offline) throw new Error(`offline and not cached: ${url}`);
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let res;
      try {
        const headers = { "User-Agent": UA };
        if (accept) headers.Accept = accept;
        if (contentType) headers["Content-Type"] = contentType;
        res = await fetchImpl(url, { method, body, headers, signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        log(`${url.slice(0, 80)}: ${e.message}; retry ${attempt + 1}`);
        await sleep(5000 * (attempt + 1));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        const ms = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 10_000 * (attempt + 1);
        log(`${res.status} from ${url.slice(0, 80)}; waiting ${ms} ms`);
        await sleep(ms);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = { url, method, status: res.status, retrievedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"), bytes: buf.length, sha256: sha(buf) };
      note(meta, false);
      if (res.status !== 200) throw new Error(`${res.status} from ${url}`);
      writeFileSync(bodyFile, buf);
      writeFileSync(metaFile, JSON.stringify(meta));
      return { buf, meta };
    }
    throw new Error(`gave up on ${url}`);
  }

  /** A SPARQL SELECT against the Wikidata Query Service, as JSON bindings. */
  async function sparql(query, purpose) {
    const { buf, meta } = await request("https://query.wikidata.org/sparql", {
      method: "POST",
      body: new URLSearchParams({ query }).toString(),
      contentType: "application/x-www-form-urlencoded",
      accept: "application/sparql-results+json",
      purpose,
    });
    return { rows: JSON.parse(buf.toString("utf8")).results.bindings, meta };
  }

  return { request, sparql, requests, bodyPath, rawDir };
}
