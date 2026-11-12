// Mac fork: Codehouse.app's own settings stay with its Host and Approver, and never reach Claude's sessions.
import { sanitiseEnv } from "@gatehouse/shared"
import { describe, expect, it } from "vitest"
import { MAC_APP_ENV, withoutMacAppEnv } from "../src/env-mac.js"

describe("a session's environment in the Mac app", () => {
  it("leaves out the Mac app's settings and keeps everything else", () => {
    const env = {
      PATH: "/opt/homebrew/bin:/usr/bin",
      HOME: "/Users/someone",
      GATEHOUSE_MAC_APP_VERSION: "2.0.210",
      GATEHOUSE_MAC_LIMITS: "/Applications/Codehouse.app/Contents/MacOS/codehouse-limits",
      GATEHOUSE_LOCAL_RULES:
        "/Users/someone/Library/Application Support/Gatehouse/policy/rules.local.yaml",
      GATEHOUSE_USER_RULES: "/x/rules.user.yaml",
      GATEHOUSE_OVERLAY_DIR: "/x/projects",
    }
    const out = withoutMacAppEnv(sanitiseEnv(env))
    for (const k of MAC_APP_ENV) expect(out).not.toHaveProperty(k)
    expect(out).toMatchObject({ PATH: env.PATH, HOME: env.HOME })
    expect(env.GATEHOUSE_MAC_APP_VERSION).toBe("2.0.210")
  })

  it("is not how the Approver is started, so it still reads the same rules as the Host", () => {
    expect(sanitiseEnv({ GATEHOUSE_LOCAL_RULES: "/r.yaml" })).toEqual({
      GATEHOUSE_LOCAL_RULES: "/r.yaml",
    })
  })
})
