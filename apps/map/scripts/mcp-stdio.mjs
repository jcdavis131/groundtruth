// Embedding Atlas as a local MCP server over stdio, for Claude Desktop, Claude
// Code (`claude mcp add gev -- node scripts/mcp-stdio.mjs`) and any other
// client that spawns a process. The tools call the HTTP API at GEV_BASE_URL
// (default http://localhost:3000), so run `npm run dev` or point it at the
// hosted app.
//
//   node scripts/mcp-stdio.mjs               serve MCP on stdin/stdout
//   node scripts/mcp-stdio.mjs --manifest    print the tool manifest as JSON and exit
//   node scripts/mcp-stdio.mjs --doc-table   print the markdown tool table (docs/MCP.md) and exit
//
// Why compile with tsc instead of `node --experimental-strip-types`: strip-types
// needs every relative import to carry its ".ts" extension, which the app's
// tsconfig (no allowImportingTsExtensions) rejects. So, like
// scripts/turbidity-check.mjs, we emit lib/mcp/*.ts into .tmp-mcp/ with tsc,
// add ".js" to the relative specifiers, and import the result. lib/mcp uses
// relative imports only (no "@/") so it compiles on its own. The emit is
// skipped when the outputs are newer than the sources, so a warm start is
// instant. Logs go to stderr: stdout is the protocol channel.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "lib", "mcp");
const outDir = path.join(root, ".tmp-mcp");
const sources = readdirSync(srcDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

function stale() {
  const newest = Math.max(...sources.map((f) => statSync(path.join(srcDir, f)).mtimeMs));
  return sources.some((f) => {
    const out = path.join(outDir, f.replace(/\.ts$/, ".js"));
    return !existsSync(out) || statSync(out).mtimeMs < newest;
  });
}

if (stale()) {
  mkdirSync(outDir, { recursive: true });
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  execFileSync(
    process.execPath,
    [tsc, ...sources.map((f) => path.join(srcDir, f)), "--outDir", outDir, "--module", "es2022", "--target", "es2022", "--moduleResolution", "bundler", "--lib", "es2022,dom", "--skipLibCheck", "--types", "node"],
    { stdio: ["ignore", "inherit", "inherit"], cwd: root },
  );
  for (const f of sources) {
    const jp = path.join(outDir, f.replace(/\.ts$/, ".js"));
    writeFileSync(jp, readFileSync(jp, "utf8").replace(/from "(\.\/[^"]+?)"/g, (m, spec) => (spec.endsWith(".js") ? m : `from "${spec}.js"`)));
  }
  writeFileSync(path.join(outDir, "package.json"), '{ "type": "module" }');
}

const { createServer, toolManifest, toolTable } = await import(pathToFileURL(path.join(outDir, "server.js")).href);
const { httpFetchJson, DEFAULT_BASE_URL } = await import(pathToFileURL(path.join(outDir, "tools.js")).href);

if (process.argv.includes("--manifest")) {
  process.stdout.write(JSON.stringify(toolManifest(), null, 2) + "\n");
  process.exit(0);
}
if (process.argv.includes("--doc-table")) {
  process.stdout.write(toolTable() + "\n");
  process.exit(0);
}

const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const base = (process.env.GEV_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
const server = createServer({
  fetchJson: httpFetchJson(base),
  docsDir: path.join(root, "docs"),
  openapiPath: path.join(root, "public", "openapi.json"),
});
await server.connect(new StdioServerTransport());
console.error(`gev mcp: stdio server up, API at ${base}`);
