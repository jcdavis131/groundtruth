import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "public/**", "mcp/node_modules/**"],
    environment: "node",
    coverage: { provider: "v8", reporter: ["text", "lcov"], include: ["lib/**", "mcp/src/**"] },
  },
});
