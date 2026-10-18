// Withholding: the CIKs whose people the app never emits (docs/PEOPLE.md, G16
// and D9, both [proposed]).
//
// The list is not in this repository. A CIK resolves to a name on EDGAR, so a
// committed list would publish who asked. It lives in two server-side
// environment variables:
//
//   GEV_PEOPLE_WITHHELD       HMAC-SHA256 digests, hex, separated by commas,
//                             spaces or newlines
//   GEV_PEOPLE_WITHHELD_KEY   the HMAC key
//
// One digest is HMAC-SHA256(key, the 10-digit zero-padded CIK), in hex:
//
//   node -e "console.log(require('crypto').createHmac('sha256',process.env.GEV_PEOPLE_WITHHELD_KEY).update(process.argv[1].padStart(10,'0')).digest('hex'))" <cik>
//
// The key matters: a plain hash of a CIK is reversed in seconds by hashing
// every CIK there is. The check fails closed: a list with no key, or an entry
// that is not 64 hex characters, throws, so nothing is served until the
// setting is fixed. The error names the variable and a count, never an entry.
//
// Every place that emits a reporting owner asks isWithheld before it does:
// lib/people/store.ts and the /api/rsu events now, and EmployerAside when it
// reads people (M8). A withheld owner is left out with no count and no marker,
// so an answer reads the same as one for an owner who never filed.
// Server only (node:crypto).

import { createHmac } from "node:crypto";
import { normalizeCik } from "@/lib/fabric/parties";

export const WITHHELD_ENV = "GEV_PEOPLE_WITHHELD";
export const WITHHELD_KEY_ENV = "GEV_PEOPLE_WITHHELD_KEY";

const DIGEST_RE = /^[0-9a-f]{64}$/;

export class WithheldConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WithheldConfigError";
  }
}

type Env = Record<string, string | undefined>;

/** HMAC-SHA256 of the 10-digit CIK under `key`, hex. */
export function withheldDigest(cik: string | number, key: string): string {
  const code = normalizeCik(cik);
  if (!code) throw new Error("withheldDigest needs a CIK of 1 to 10 digits");
  if (!key) throw new WithheldConfigError(`${WITHHELD_KEY_ENV} is empty`);
  return createHmac("sha256", key).update(code).digest("hex");
}

interface WithheldList {
  key: string;
  digests: Set<string>;
}

let parsed: { raw: string; key: string; list: WithheldList | null } | null = null;

function withheldList(env: Env): WithheldList | null {
  const raw = (env[WITHHELD_ENV] ?? "").trim();
  const key = env[WITHHELD_KEY_ENV] ?? "";
  if (parsed && parsed.raw === raw && parsed.key === key) return parsed.list;
  let list: WithheldList | null = null;
  if (raw) {
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    const bad = tokens.filter((t) => !DIGEST_RE.test(t.toLowerCase())).length;
    if (bad) throw new WithheldConfigError(`${WITHHELD_ENV} holds ${bad} of ${tokens.length} entries that are not 64-character hex digests`);
    if (!key) throw new WithheldConfigError(`${WITHHELD_ENV} is set and ${WITHHELD_KEY_ENV} is not`);
    list = { key, digests: new Set(tokens.map((t) => t.toLowerCase())) };
  }
  parsed = { raw, key, list };
  return list;
}

/** A predicate over CIKs for one answer, so the environment is read once. Throws WithheldConfigError when the setting is malformed. */
export function withheldCheck(env: Env = process.env): (cik: string | number) => boolean {
  const list = withheldList(env);
  if (!list) return () => false;
  return (cik) => {
    const code = normalizeCik(cik);
    return code ? list.digests.has(withheldDigest(code, list.key)) : false;
  };
}

/** True when this CIK's owner is withheld. The parsed list is cached until the variables change. */
export function isWithheld(cik: string | number, env: Env = process.env): boolean {
  return withheldCheck(env)(cik);
}
