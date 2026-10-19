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
  // Frozen eval evidence: the 2026-10-18 panel write-ups cite these scripts as run, so they are
  // never edited to satisfy a rule. Some are CommonJS (.cjs), where require() is the only import.
  {
    files: ["lib/embed/__eval__/**"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
