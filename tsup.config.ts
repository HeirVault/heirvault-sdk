import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  outDir: "dist",
  // `@stellar/stellar-sdk` is a runtime dependency; `@stellar/freighter-api`
  // is an optional peer loaded lazily, so neither is bundled.
  external: ["@stellar/stellar-sdk", "@stellar/freighter-api"],
});
