// The release calendar for scripts/mcp-stdio.mjs, the way app/api/mcp/route.ts passes it to createServer.
//
// lib/mcp compiles alone (the stdio script runs tsc over lib/mcp/*.ts and nothing else), and lib/releases/calendar.ts
// imports a type from "@/lib/provenance/sources", which tsc cannot resolve there. The import is type-only, so a
// transpile without type-checking drops it and leaves a module that imports nothing. `ts` is the typescript package
// (the script already depends on it for tsc); it is passed in so a test can use the copy vitest loads.
import { readFileSync, writeFileSync } from "node:fs";

/** Emit the calendar source `srcFile` as an ES module at `outFile`; it exports cadenceOf, the function the route injects. */
export function emitCalendar(ts, srcFile, outFile) {
  const out = ts.transpileModule(readFileSync(srcFile, "utf8"), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  writeFileSync(outFile, out.outputText);
}
