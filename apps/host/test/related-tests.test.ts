// The gate's related tests when memory is short (owner, 12 Nov): the test files that reach a changed file through
// their imports, relative or through the @gatehouse packages, and not the rest.
import { describe, expect, it } from "vitest"
import { relatedTests, resolveImport } from "../../../scripts/related-tests.mjs"

// Reading every file's imports takes a while when the computer is short of memory.
const SLOW = 120_000

describe("related tests from the imports", () => {
  it(
    "finds the tests a file reaches directly and through other files, and not the others",
    () => {
      const t = relatedTests(["apps/host/src/provenance.ts"])
      expect(t).toContain("apps/host/test/taint-egress.test.ts")
      // Through canuse.ts, which imports provenance.ts.
      expect(t).toContain("apps/host/test/extreme.test.ts")
      expect(t).not.toContain("apps/host/test/test-shards.test.ts")
    },
    SLOW,
  )

  it(
    "follows the @gatehouse packages to their files",
    () => {
      expect(resolveImport("apps/web/src/x.ts", "@gatehouse/shared/ws-protocol")?.replace(/\\/g, "/")).toMatch(/packages\/shared\/src\/ws-protocol\.ts$/)
      expect(resolveImport("apps/web/src/x.ts", "react")).toBeUndefined()
      expect(relatedTests(["packages/shared/src/ws-protocol.ts"]).some((f) => f.startsWith("apps/web/test/"))).toBe(true)
    },
    SLOW,
  )
})
