// Brief API: the same deterministic brief the place pages and the feeds
// carry, in the provenance envelope.
//
//   /api/brief?scope=county:48453                the default-lens brief for Travis County
//   /api/brief?scope=48453                       the same; a bare five-digit code is a county
//   /api/brief?scope=metro:41700&lens=realestate a lens brief for the San Antonio metro area
//   /api/brief?scope=state:TX                    a state brief
//   &format=txt                                  briefText() as text/plain
//
// This route exists because RSS, Atom and JSON Feed are fixed external
// standards: none of them can carry `{ ...meta, data, provenance,
// generatedAt, caveats? }`, and the envelope is the contract every other
// route in this app answers with. A script that wants the findings AND the
// sources in one object reads this; a feed reader reads /place/<fips>/feed.xml.
//
// The brief is assembled once per scope and lens per hour and cached, so two
// calls inside one window are byte-identical — including `generatedAt`, which
// is the brief's own stamp rather than the moment the response was written.
// buildBrief is pure, so that identity is a property of the code and not of
// the cache being warm.
//
// Places and institutions only: the brief's findings are about a county, a
// metro area or a state.

import type { NextRequest } from "next/server";
import { buildBrief, briefInputFromFacts, briefText } from "@/lib/brief/build";
import type { Brief } from "@/lib/brief/types";
import type { IndicatorCategory } from "@/lib/indicators/types";
import { PERSONA_BY_ID, isPersonaId, type PersonaId } from "@/lib/personas/registry";
import { placeFacts, type PlaceFacts } from "@/lib/places/facts";
import { parseCountyParam, parseMetroParam, parseStateParam, scopeId, scopePath, type PlaceScope } from "@/lib/places/scope";
import { cached } from "@/lib/server/cache";
import { CORS, badRequest, cacheControl, notFound, ok, options, withCors } from "@/lib/server/respond";
import { jsonError } from "@/lib/server/upstream";

export const maxDuration = 60;

/** One hour, the same window the place pages regenerate on. */
const TTL_S = 3600;
const TTL_MS = TTL_S * 1000;

const FIVE = /^[0-9]{5}$/;
const TWO_ALPHA = /^[A-Za-z]{2}$/;

const SCOPE_SYNTAX = "scope=county:48453 | metro:41700 | state:TX (a bare 48453 is a county, a bare TX is a state)";

const LENSES = Object.keys(PERSONA_BY_ID).sort().join(" | ");

/**
 * A scope parameter, split into the two failures a caller has to tell apart:
 * a string that is not a place id at all (400, with the grammar) and a
 * well-formed id nothing answers to (404). lib/places/scope.ts returns null
 * for both, so the shape is checked here first and the registry lookup
 * decides the second.
 */
type ScopeResult = { ok: true; scope: PlaceScope } | { ok: false; status: 400 | 404; message: string; details: Record<string, unknown> };

function parseScope(raw: string | null): ScopeResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, status: 400, message: `scope is required: ${SCOPE_SYNTAX}`, details: {} };
  const colon = text.indexOf(":");
  const kind = colon === -1 ? null : text.slice(0, colon);
  const id = colon === -1 ? text : text.slice(colon + 1);

  if (kind === "county" || (kind === null && FIVE.test(id))) {
    if (!FIVE.test(id)) return { ok: false, status: 400, message: `a county scope is five digits: ${SCOPE_SYNTAX}`, details: { scope: text } };
    // SSCCC ending 000 is the state row in QCEW, never a county.
    if (id.slice(2) === "000") return { ok: false, status: 400, message: `${id} is a state code, not a county; use scope=state:<USPS>`, details: { scope: text } };
    const scope = parseCountyParam(id);
    return scope ? { ok: true, scope } : { ok: false, status: 404, message: `no county with FIPS ${id}`, details: { scope: text } };
  }
  if (kind === "metro") {
    if (!FIVE.test(id)) return { ok: false, status: 400, message: `a metro scope is a five-digit CBSA code: ${SCOPE_SYNTAX}`, details: { scope: text } };
    const scope = parseMetroParam(id);
    return scope ? { ok: true, scope } : { ok: false, status: 404, message: `no metro area with CBSA code ${id}`, details: { scope: text } };
  }
  if (kind === "state" || (kind === null && TWO_ALPHA.test(id))) {
    if (!TWO_ALPHA.test(id)) return { ok: false, status: 400, message: `a state scope is a two-letter USPS code: ${SCOPE_SYNTAX}`, details: { scope: text } };
    const scope = parseStateParam(id);
    return scope ? { ok: true, scope } : { ok: false, status: 404, message: `no state with USPS code ${id.toUpperCase()}`, details: { scope: text } };
  }
  return { ok: false, status: 400, message: `unknown scope: ${SCOPE_SYNTAX}`, details: { scope: text } };
}

/** The national indicator set a lens narrows to; "explorer" and an "all" category narrow nothing. */
function categoryFor(lens: PersonaId | null): IndicatorCategory | undefined {
  if (!lens) return undefined;
  const c = PERSONA_BY_ID[lens].indicatorCategory;
  return c && c !== "all" ? c : undefined;
}

interface Assembled {
  brief: Brief;
  facts: PlaceFacts;
}

/**
 * The brief for one scope and lens. Every timestamp the response carries is
 * captured once here and handed to placeFacts and buildBrief explicitly —
 * neither is allowed to read the clock, which is what makes a cache hit and
 * the render that filled it the same bytes.
 */
async function assemble(scope: PlaceScope, lens: PersonaId | null): Promise<Assembled> {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const facts = await placeFacts(scope, { now, retrievedAt: generatedAt, indicatorCategory: categoryFor(lens) });
  const brief = buildBrief(briefInputFromFacts(facts, lens), { now, generatedAt });
  return { brief, facts };
}

export const OPTIONS = options;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const parsed = parseScope(q.get("scope"));
  if (!parsed.ok) return parsed.status === 404 ? notFound(parsed.message, parsed.details) : badRequest(parsed.message, parsed.details);
  const scope = parsed.scope;

  const rawLens = (q.get("lens") ?? "").trim();
  if (rawLens && !isPersonaId(rawLens)) return badRequest(`unknown lens: ${LENSES}`, { lens: rawLens });
  const lens: PersonaId | null = rawLens ? (rawLens as PersonaId) : null;

  // parseFormat() in lib/server/respond.ts knows json and csv only, and a
  // brief is not a table, so txt is read directly here and everything else
  // falls through to the envelope.
  const format = (q.get("format") ?? "").trim().toLowerCase();
  if (format && format !== "json" && format !== "txt") return badRequest("format=json|txt", { format });

  try {
    const r = await cached(`brief:${scopeId(scope)}:${lens ?? "default"}`, TTL_MS, () => assemble(scope, lens));
    const { brief, facts } = r.value;
    if (format === "txt") {
      return new Response(briefText(brief), {
        headers: {
          ...CORS,
          "content-type": "text/plain; charset=utf-8",
          "cache-control": cacheControl(TTL_S),
        },
      });
    }
    return ok(brief, {
      meta: {
        source: "Embedding Atlas place brief",
        scope: scopeId(scope),
        lens,
        status: brief.status,
        findings: brief.findings.length,
        page: scopePath(scope),
        provisional: scope.kind === "county" ? scope.provisional : false,
        rulesVersion: brief.rulesVersion,
        cacheAge: r.age,
      },
      provenance: brief.provenance,
      caveats: [...brief.caveats, ...facts.caveats.filter((c) => !brief.caveats.includes(c))],
      ttlS: TTL_S,
      // The brief's own stamp, not the moment this response was written: two
      // calls inside one cache window return identical bytes.
      generatedAt: brief.generatedAt,
    });
  } catch (err) {
    return withCors(jsonError(err));
  }
}
