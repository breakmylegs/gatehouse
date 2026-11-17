// T-020: sessions are started with the SDK's prompt suggestions on, unless Settings turns them off. A suggestion only
// fills the prompt box when you press Tab (the web's tests); nothing here sends one.
import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
}, 90_000)
afterAll(async () => {
  for (const x of s.manager.liveSessions()) await x.close()
  await s.stop()
})

describe("suggested next prompts (T-020)", () => {
  it("are asked for unless turned off", async () => {
    s.sdk.turn = async () => undefined
    await s.manager.start({ cwd: s.repo })
    expect((s.sdk.queries.at(-1)?.options as Options).promptSuggestions).toBe(true)
    const config = s.deps.config
    s.deps.config = () => ({ ...config(), promptSuggestions: false })
    try {
      await s.manager.start({ cwd: s.repo })
      expect((s.sdk.queries.at(-1)?.options as Options).promptSuggestions).toBeUndefined()
    } finally {
      s.deps.config = config
    }
  })
})
