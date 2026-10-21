// What scripts/world-record.mjs keeps of a route's provenance when it writes a fixture under lib/mcp/__fixtures__/world.
// Split out of the recorder so a test can run it on a planted entry: the recorder itself imports the compiled tool,
// reads argv and asks the network as soon as it is loaded.

/** The listed keys of `o` that are present (undefined is absent; null is kept). */
export const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * A route's provenance list reduced to what lib/mcp/world.ts reads: each entry's source (id, publisher, url) and the
 * entry's upstreamUrl and retrievedAt. Anything that is not a list is passed through as it came.
 */
export const prov = (list) => (Array.isArray(list) ? list.map((x) => ({ source: pick(x.source ?? {}, ["id", "publisher", "url"]), ...pick(x, ["upstreamUrl", "retrievedAt"]) })) : list);
