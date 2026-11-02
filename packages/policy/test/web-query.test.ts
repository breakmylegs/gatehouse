// W1-10, ADR 0007: a web search or page address leaves this computer, so one holding a term on your redaction list
// is refused with a rule id, before any rule of yours, and never rewritten.
import fs from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { holdsTerm, PolicyEngine } from "../src/engine.js"
import { loadPolicy } from "../src/loader.js"
import type { Policy } from "../src/types.js"
import { fwd, makeFixture, SEED_RULES, type Fixture } from "./helpers.js"

let fx: Fixture
let policy: Policy
beforeAll(() => {
  fx = makeFixture()
  policy = loadPolicy({ rulesPath: SEED_RULES, workspaceRootsOverride: [fwd(fx.ws)] })
})
afterAll(() => fs.rmSync(fx.root, { recursive: true, force: true }))

const engine = (terms: string[]) =>
  new PolicyEngine({ getPolicy: () => policy, sensitiveTerms: () => terms })
const ctx = () => ({ cwd: fwd(fx.ws) })

describe("a web search or address with a listed term", () => {
  it("is refused with its own rule id, without saying which term", async () => {
    const e = engine(["Project Falcon", "acme-internal"])
    const v = await e.evaluate(
      { toolName: "WebSearch", input: { query: "pricing for project falcon launch" } },
      ctx(),
    )
    expect(v).toMatchObject({ outcome: "deny", ruleId: "web-query-redaction", decidedBy: "rules" })
    expect(v.reason).not.toMatch(/falcon/i)
    const page = await e.evaluate(
      { toolName: "WebFetch", input: { url: "https://acme-internal.example.com/x", prompt: "read" } },
      ctx(),
    )
    expect(page.ruleId).toBe("web-query-redaction")
  })

  it("lets one without a listed term go on to the rules, and checks only what leaves", async () => {
    const e = engine(["Project Falcon"])
    const v = await e.evaluate({ toolName: "WebSearch", input: { query: "vite config" } }, ctx())
    expect(v.ruleId).not.toBe("web-query-redaction")
    // The fetch prompt is for Claude, not sent to the site, so it is not what is checked.
    const page = await e.evaluate(
      { toolName: "WebFetch", input: { url: "https://example.com", prompt: "Project Falcon" } },
      ctx(),
    )
    expect(page.ruleId).not.toBe("web-query-redaction")
    // With no list, nothing is refused for this reason.
    const none = await engine([]).evaluate(
      { toolName: "WebSearch", input: { query: "project falcon" } },
      ctx(),
    )
    expect(none.ruleId).not.toBe("web-query-redaction")
  })

  it("matches regardless of case and ignores one-letter terms", () => {
    expect(holdsTerm("ACME roadmap", ["acme"])).toBe(true)
    expect(holdsTerm("a b c", ["a"])).toBe(false)
    expect(holdsTerm("anything", ["  "])).toBe(false)
  })
})
