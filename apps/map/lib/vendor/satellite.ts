// Pure-JS entry points of satellite.js 7.
//
// The package root (`import ... from "satellite.js"`) also re-exports a
// WASM/pthreads runtime that imports node:module and node:worker_threads.
// Browser bundlers cannot handle that: Turbopack hangs in `next build` and
// webpack fails with UnhandledSchemeError. The package export map only
// exposes the root, so the SGP4 modules are reached by relative path instead.
// Everything the app needs is here and nothing touches WASM.

export { json2satrec, twoline2satrec } from "../../node_modules/satellite.js/dist/io.js";
export { propagate, gstime } from "../../node_modules/satellite.js/dist/propagation.js";
export {
  eciToGeodetic,
  eciToEcf,
  ecfToLookAngles,
  degreesLat,
  degreesLong,
} from "../../node_modules/satellite.js/dist/transforms.js";
export type { SatRec } from "../../node_modules/satellite.js/dist/propagation/SatRec.js";
export type {
  OMMJsonObject,
  PositionAndVelocity,
  GeodeticLocation,
} from "../../node_modules/satellite.js/dist/common-types.js";
