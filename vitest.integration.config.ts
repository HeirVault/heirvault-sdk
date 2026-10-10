import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a real Soroban Testnet contract. They are kept
 * out of the default `npm test` run because they require network access, a
 * funded account and a deployed contract id — see `.env.example`.
 *
 * Run with `npm run test:integration` after exporting the required variables.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    sequence: { concurrent: false },
  },
});
