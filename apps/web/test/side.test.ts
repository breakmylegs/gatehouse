// @vitest-environment jsdom
// T-034 (t3code review): a side session starts beside this one in the same folder, in Plan mode and never in Extreme
// approval; Bring back puts its latest answer in the first session's prompt box and closes it.
import { beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) =>
      (sent.push(cmd), cmd.type === "create_session" ? { ok: true, data: { sessionId: "side1" } } : { ok: true }),
    ),
  }
})
const { useStore } = await import("../src/store")
const { bringBack, latestAnswer, sideOf, startSide } = await import("../src/lib/side")
const { COMPOSE_EVENT } = await import("../src/lib/compose")

const main = {
  id: "s1",
  cwd: "C:\\dev\\shop",
  project: "shop",
  mode: "acceptEdits",
  extreme: true,
  state: "running",
  pendingApprovals: 0,
  createdAt: "2026-11-15T08:00:00Z",
}

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  useStore.setState({ sessions: { s1: main }, transcripts: {}, panes: ["s1"] } as never)
})

describe("side sessions (T-034)", () => {
  it("starts beside this one, in the same folder, in Plan mode, never in Extreme approval", async () => {
    expect(await startSide("s1", "How is the cache invalidated?")).toBe("side1")
    expect(sent[0]).toMatchObject({ type: "create_session", cwd: "C:\\dev\\shop", mode: "plan" })
    expect(sent[0]).not.toHaveProperty("extreme")
    expect(sent[1]).toEqual({ type: "prompt", sessionId: "side1", text: "How is the cache invalidated?" })
    expect(sideOf("side1")).toBe("s1")
  })

  it("brings back its latest answer to the first session's prompt box, then closes", async () => {
    await startSide("s1", "q")
    sent.length = 0
    useStore.setState((s) => ({
      sessions: { ...s.sessions, side1: { ...main, id: "side1", mode: "plan", extreme: false, state: "idle" } },
      transcripts: {
        side1: {
          items: [
            { kind: "text", id: "a", text: "First thought." },
            { kind: "text", id: "c", text: "It is cleared on every write." },
            { kind: "text", id: "b", text: "A helper says: by the tag.", subagent: "x" },
          ],
          todos: [],
          seq: 3,
        },
      },
    }) as never)
    expect(latestAnswer(useStore.getState().transcripts.side1!.items)).toBe("It is cleared on every write.")
    const composed: unknown[] = []
    const on = (e: Event) => composed.push((e as CustomEvent).detail)
    window.addEventListener(COMPOSE_EVENT, on)
    expect(bringBack("side1")).toBe(true)
    window.removeEventListener(COMPOSE_EVENT, on)
    // T-048: as a chip in the prompt box.
    expect(composed).toEqual([{ sessionId: "s1", text: "From a side session:\n\nIt is cleared on every write.\n\n", chip: { kind: "note", label: "a side session's answer" } }])
    expect(sent).toEqual([{ type: "close_session", sessionId: "side1" }])
    expect(sideOf("side1")).toBeUndefined()
  })
})
