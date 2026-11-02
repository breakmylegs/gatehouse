import { describe, expect, it } from "vitest"
import { sanitiseEnv } from "../src/index.js"

describe("sanitiseEnv (invariant 6)", () => {
  it("removes credential variables in any case and keeps the rest", () => {
    const out = sanitiseEnv({
      ANTHROPIC_API_KEY: "a",
      anthropic_auth_token: "b",
      CLAUDE_CODE_OAUTH_TOKEN: "c",
      PATH: "p",
    })
    expect(Object.keys(out)).toEqual(["PATH"])
  })
})
