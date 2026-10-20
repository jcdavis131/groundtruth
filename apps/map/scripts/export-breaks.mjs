// STUB for the red commit: export-breaks.mjs is written in the next commit.

/**
 * Every breaks file as {path relative to apps/map: bytes}, computed from the committed inputs.
 * @param {string} root apps/map
 * @returns {Map<string, string>}
 */
export function buildAll(root) {
  if (root) throw new Error(`export-breaks.mjs is not written yet (${root})`);
  return new Map();
}
