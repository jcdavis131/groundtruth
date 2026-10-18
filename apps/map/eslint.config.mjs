import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cesium's runtime assets are copied here by scripts/copy-cesium.mjs.
    "public/cesium/**",
    // On-the-fly compile scratch for scripts/turbidity-check.mjs and scripts/mcp-stdio.mjs.
    ".tmp-turb/**",
    ".tmp-mcp/**",
  ]),
]);

export default eslintConfig;
