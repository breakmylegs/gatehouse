import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    // Many tests spawn git, pwsh or node. On a machine with real-time scanning they are slow, and
    // running every file at once makes them slower still, so cap the workers and allow generous time.
    testTimeout: 60000,
    hookTimeout: 120000,
    maxWorkers: 4,
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
