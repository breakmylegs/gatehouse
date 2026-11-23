// E-055 on real sessions: a new session in the folder receives the last session's handover note in its instructions,
// once; a session brought back after a restart does not.
import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
const given: string[] = []
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
  const notes = ["Where it stands: cart totals half done"]
  s.deps.handoverFor = (_folder, id) => {
    const n = notes.shift()
    if (n) given.push(id)
    return n
  }
}, 90_000)
afterAll(async () => {
  for (const x of s.manager.liveSessions()) await x.close()
  await s.stop()
})

const appended = () => {
  const p = (s.sdk.queries.at(-1)?.options as Options).systemPrompt as { append?: string } | string | undefined
  return typeof p === "object" ? (p.append ?? "") : String(p ?? "")
}

describe("handover notes on real sessions", () => {
  it("gives a new session the last session's note once, and asks every session to leave one", async () => {
    s.sdk.turn = async () => undefined
    const a = await s.manager.start({ cwd: s.repo })
    expect(appended()).toContain("Where it stands: cart totals half done")
    expect(appended()).toContain("write_handover")
    expect(given).toEqual([a.id])
    await s.manager.start({ cwd: s.repo })
    expect(appended()).not.toContain("cart totals")
    expect(appended()).toContain("write_handover")
  })
})
