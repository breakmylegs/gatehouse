// @vitest-environment jsdom
// O41: in Neighbourhood Watch the page did not see the conversation happen, so each greeting from the computer (the
// page opening, and every return after a drop) reads each session's conversation afresh and replaces what was shown:
// a live session opened part way through shows all of it, and what was missed in a gap is there, once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
let history: unknown[] = []
vi.mock("../src/lib/cnwConnection", () => ({
  cnwComputer: () => "c1",
  CnwConnection: class {
    online = true
    start() {}
    send(cmd: Record<string, unknown>) {
      sent.push(cmd)
      return Promise.resolve(cmd.type === "history_messages" ? { ok: true, data: history } : { ok: true })
    }
  },
}))
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })) }))

const said = (text: string, uuid: string) => ({ type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text }] } })
const info = { id: "s1", cwd: "C:\\dev\\shop", project: "shop", mode: "default", state: "running", pendingApprovals: 0, createdAt: "", sdkSessionId: "sdk-1" }
const hello = (pending: unknown[] = []) => ({ type: "hello", sessions: [info], pending, health: {}, usage: {} }) as never

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  vi.stubEnv("VITE_CODEHOUSE_REMOTE", "cnw")
  vi.resetModules()
})
afterEach(() => vi.unstubAllEnvs())

const texts = (t: { items: unknown[] } | undefined) => JSON.stringify(t?.items ?? [])

describe("a session's conversation in Neighbourhood Watch", () => {
  it("is read whole for a live session the page opened part way through, and afresh after a drop, never twice", async () => {
    const { useStore, startConnection } = await import("../src/store")
    startConnection()
    history = [said("first answer", "a1")]
    useStore.getState().handleEvent(hello())
    await vi.waitFor(() => expect(texts(useStore.getState().transcripts.s1)).toContain("first answer"))
    expect(sent.filter((c) => c.type === "history_messages")).toEqual([expect.objectContaining({ sdkSessionId: "sdk-1" })])
    // A drop and a return: the computer's conversation now has more, said while the page could not hear.
    history = [said("first answer", "a1"), said("missed in the gap", "a2")]
    useStore.getState().handleEvent(hello())
    await vi.waitFor(() => expect(texts(useStore.getState().transcripts.s1)).toContain("missed in the gap"))
    expect(texts(useStore.getState().transcripts.s1).split("first answer")).toHaveLength(2)
  })

  it("drops a permission prompt the greeting no longer has", async () => {
    const { useStore, startConnection } = await import("../src/store")
    startConnection()
    useStore.getState().handleEvent(hello([{ request: { id: "P1", sessionId: "s1" } }]))
    expect(Object.keys(useStore.getState().pending)).toEqual(["P1"])
    useStore.getState().handleEvent(hello([]))
    expect(useStore.getState().pending).toEqual({})
  })
})
