// @vitest-environment jsdom
// T-125 (t3code review): Ask Claude to triage starts an ordinary chat in Plan mode, has the Host give it the redacted
// log and report, then asks; if the Host cannot, the chat is closed and nothing is asked.
import { beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
let prepared = true
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => (prepared ? { ok: true, status: 200, data: { prompt: "Triage it." } } : { ok: false, status: 503, error: "x" })),
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) =>
      (sent.push(cmd), cmd.type === "create_session" ? { ok: true, data: { sessionId: "c1" } } : { ok: true }),
    ),
  }
})
const { startTriage } = await import("../src/lib/triage")

beforeEach(() => {
  sent.length = 0
  prepared = true
})

describe("Ask Claude to triage (T-125)", () => {
  it("starts a Plan-mode chat, then asks once the files are in place", async () => {
    expect(await startTriage("report")).toBe("c1")
    expect(sent.map((c) => c.type)).toEqual(["create_session", "prompt"])
    expect(sent[0]).toMatchObject({ kind: "chat", mode: "plan", cwd: "chat" })
    expect(sent[1]).toEqual({ type: "prompt", sessionId: "c1", text: "Triage it." })
  })

  it("closes the chat and asks nothing when the Host could not give it the files", async () => {
    prepared = false
    expect(await startTriage("report")).toBeUndefined()
    expect(sent.map((c) => c.type)).toEqual(["create_session", "close_session"])
  })
})
