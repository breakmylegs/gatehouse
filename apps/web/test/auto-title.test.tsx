// @vitest-environment jsdom
// T-018 and T-019 (t3code review): a session you have not named is named once its first turn ends; a title you gave
// it is never replaced; Name it again asks once more.
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
const asked: unknown[] = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, _u: string, body: unknown) => (asked.push(body), { ok: true, status: 200, data: { title: "Login page fix" } })),
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (cmd: Record<string, unknown>) => (sent.push(cmd), { ok: true })) }
})
const { useStore } = await import("../src/store")
const { nameSession, useAutoTitles, firstExchange } = await import("../src/lib/autoTitle")

const items = [
  { kind: "user", id: "u1", text: "Fix the login page" },
  { kind: "text", id: "t0", text: "helper", subagent: "a1" },
  { kind: "text", id: "t1", text: "Fixed it." },
  { kind: "result", id: "r1", isError: false },
]
const session = (o: Record<string, unknown> = {}) => ({
  id: "s1",
  cwd: "C:\\dev\\shop",
  project: "shop",
  mode: "default",
  state: "idle",
  pendingApprovals: 0,
  createdAt: "2026-11-14T08:00:00Z",
  sdkSessionId: "sdk-1",
  ...o,
})

beforeEach(() => {
  sent.length = 0
  asked.length = 0
  localStorage.clear()
})

describe("sessions named by Claude (T-018, T-019)", () => {
  it("names an unnamed session once its first turn ends, and only once", async () => {
    expect(firstExchange(items as never)).toEqual([
      { who: "you", text: "Fix the login page" },
      { who: "claude", text: "Fixed it." },
    ])
    useStore.setState({ sessions: { s1: session({ state: "running" }) }, transcripts: { s1: { items, todos: [], seq: 1 } } } as never)
    const { rerender } = renderHook(() => useAutoTitles())
    expect(asked).toEqual([])
    useStore.setState({ sessions: { s1: session() } } as never)
    rerender()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ type: "session_meta", sdkSessionId: "sdk-1", title: "Login page fix", cwd: "C:\\dev\\shop" })
    useStore.setState({ sessions: { s1: session({ pendingApprovals: 0, seq: 2 }) } } as never)
    rerender()
    await new Promise((r) => setTimeout(r, 20))
    expect(asked).toHaveLength(1)
  })

  it("never replaces a title you gave it, unless you ask to name it again", async () => {
    const named = session({ title: "My own" }) as never
    expect(await nameSession(named, items as never)).toBeUndefined()
    expect(asked).toEqual([])
    expect(await nameSession(named, items as never, true)).toBe("Login page fix")
  })
})
