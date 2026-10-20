// Module resolve hook for plain-Node scripts that import lib/*.ts: Node 22.18+ and 24 strip types natively but
// will not resolve an extensionless relative import ("./coverage"), which the app's tsconfig requires. This
// maps such a specifier to the .ts file beside it (or to the index.ts of a directory). Registered by scripts/cite-load.mjs.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    for (const tail of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      const url = new URL(tail, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
