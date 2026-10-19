// Stand-in for @spz-loader/core.
//
// Cesium imports `loadSpz` from that package to decode .spz Gaussian-splat
// glTF payloads. The package is an Emscripten build with ~250 KB of
// WebAssembly inlined as a JS string; Turbopack's production minifier
// rewrites that string as a template literal, and the legacy octal escapes
// it contains ("\00") are illegal there, so the whole Cesium chunk fails to
// parse in production builds ("Octal escape sequences are not allowed in
// template strings"). This app never loads splats, so next.config.ts aliases
// the package to this stub, which fails loudly if anything reaches it.

export function loadSpz(): never {
  throw new Error("Gaussian splat (.spz) loading is disabled in Embedding Atlas (see lib/vendor/spz-loader-stub.ts)");
}

export default { loadSpz };
