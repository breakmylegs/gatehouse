import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: "v8",
      include: ["packages/policy/src/**/*.ts"],
      // The barrel file has no logic. The replay CLI is a thin wrapper, exercised by a test that runs it.
      exclude: ["packages/policy/src/index.ts", "packages/policy/src/replay-cli.ts"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 95 },
    },
  },
})
