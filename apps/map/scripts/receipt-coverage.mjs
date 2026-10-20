// receipt-coverage: of the valued lines world_context emits for the recorded fixtures, the share that carry a receipt
// (publisher + upstreamRecordUrl + retrievedAt). Prints n/N per fixture and a total, and the uncovered lines by source.
//
//   node scripts/receipt-coverage.mjs [--min <percent>] [--list] [input.json ...]
//
// Inputs: a world fixture (lib/mcp/__fixtures__/world/*.json; all twelve if none is named), a world_context reply, or a
// v3-shaped facts file, the same three shapes scripts/cite-check.mjs reads, through the same loader.
// Reporting only: exit 0 whatever the number is. With --min it exits 1 when the total share is below it, which is how
// the step in .github/workflows/map-ci.yml would gate once the total reaches 95 percent. Exit 2: a bad flag or a file
// that cannot be read. What is counted, and what is not, is in lib/provenance/receiptCoverage.ts and apps/map/docs/MCP.md.
// No network. Needs Node 22.18+ and apps/map's node_modules (world_context needs zod; see scripts/cite-load.mjs).

import { root } from "./cite-load.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const { runReceiptCoverage } = await import(pathToFileURL(path.join(root, "lib/provenance/receiptCoverage.ts")).href);

const r = await runReceiptCoverage(process.argv.slice(2));
process.stdout.write(r.text);
process.exit(r.code);
