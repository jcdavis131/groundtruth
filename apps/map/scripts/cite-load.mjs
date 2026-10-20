// Loads lib/cite (TypeScript) into a plain-Node script. Node 22.18+ strips types natively; scripts/ts-resolve-hook.mjs adds
// the one thing it lacks, resolving the extensionless relative imports the app's tsconfig requires. world_context needs the
// app's own `zod` (npm ci in apps/map). Nothing here touches the network.
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(path.join(root, "scripts", "ts-resolve-hook.mjs")).href);

const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

/** hosts.ts (the table, recordIdOf, refusal) and fetch.ts (the gate and fetchPublisher). */
export const loadCite = async () => ({ ...(await load("lib/cite/hosts.ts")), ...(await load("lib/cite/fetch.ts")) });

/** Items world_context emits for one recorded fixture (lib/mcp/__fixtures__/world/*.json), without any network. */
export async function worldItems(file) {
  return (await load("lib/cite/worldItems.ts")).worldItems(file);
}
