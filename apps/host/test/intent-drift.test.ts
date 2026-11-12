// D-040, the intent drift alarm: with a model on this computer, a divergent report raises an alert and one on track
// does not; what is sent is redacted; with no local model, or only a gateway, the feature says it is unavailable.
import { describe, expect, it, vi } from "vitest"
import { checkIntent } from "../src/intent-drift.js"
import type { LocalRuntimeConfig } from "../src/providers/local-runtime.js"

const local: LocalRuntimeConfig = { kind: "ollama", url: "http://127.0.0.1:11434", models: [{ name: "qwen2.5:7b" }] }
const redact = (t: string) => t.replace(/sk-ant-\w+/g, "[REDACTED:anthropic-key]")

describe("the intent drift alarm (D-040)", () => {
  it("raises an alert for divergent work, and not for work on track", async () => {
    const chat = vi.fn(async (_c: unknown, body: { messages: Array<{ content: string | null }> }) => ({
      text: String(body.messages[1]!.content).includes("dark mode") ? "DRIFT: the agent is restyling the app, not adding exports" : "ON-TRACK: it is writing the CSV export",
      toolCalls: [],
      usage: { input: 1, output: 1 },
    }))
    const drifted = await checkIntent({ goal: "Add CSV export of orders", said: "I have started a dark mode theme for the whole app, key sk-ant-abc", cfg: local, redact, chat: chat as never })
    expect(drifted).toEqual({ available: true, drift: true, reason: "the agent is restyling the app, not adding exports" })
    expect(JSON.stringify(chat.mock.calls[0])).not.toContain("sk-ant-abc")
    const fine = await checkIntent({ goal: "Add CSV export of orders", said: "The CSV writer is done; tests next.", cfg: local, redact, chat: chat as never })
    expect(fine).toMatchObject({ available: true, drift: false })
  })

  it("says it is unavailable with no local model, or only a gateway, and asks nothing", async () => {
    const chat = vi.fn()
    expect(await checkIntent({ goal: "g", said: "s", cfg: undefined, redact, chat: chat as never })).toMatchObject({ available: false, why: expect.stringMatching(/unavailable: no model runtime/) })
    expect(await checkIntent({ goal: "g", said: "s", cfg: { ...local, kind: "gateway" }, redact, chat: chat as never })).toMatchObject({ available: false, why: expect.stringMatching(/gateway/) })
    expect(chat).not.toHaveBeenCalled()
  })
})
