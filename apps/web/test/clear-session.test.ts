// @vitest-environment jsdom
// T-046 (t3code review): /clear starts a fresh session in the same folder and pane, set up as this one (mode,
// approval, model, effort, account: never looser), without resuming the conversation; refused while Claude works.
import { beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }) }))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return cmd.type === "create_session" ? { ok: true, data: { sessionId: "s2" } } : { ok: true }
    }),
  }
})

const { useStore } = await import("../src/store")
const { clearSession, sessionInWorktree } = await import("../src/lib/fork")

const session = (o: Record<string, unknown> = {}) => ({
  id: "s1",
  cwd: "C:\\dev\\shop",
  project: "shop",
  mode: "acceptEdits" as const,
  extreme: true,
  model: "claude-opus-5-5",
  effort: "high" as const,
  account: "work",
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-11-03T01:00:00Z",
  sdkSessionId: "sdk-1",
  ...o,
})

beforeEach(() => {
  sent.length = 0
  useStore.setState({ route: "workspace", panes: ["s0", "s1"], selectedSession: "s1", sessions: { s1: session() } } as never)
})

describe("/clear (T-046)", () => {
  it("starts afresh in the same pane, set up as before, without the old conversation", async () => {
    expect(await clearSession("s1")).toBe("s2")
    expect(sent).toEqual([
      { type: "create_session", cwd: "C:\\dev\\shop", mode: "acceptEdits", extreme: true, model: "claude-opus-5-5", effort: "high", account: "work" },
    ])
    expect(sent[0]).not.toHaveProperty("resume")
    expect(useStore.getState().panes).toEqual(["s0", "s2"])
  })

  it("carries Extreme approval only when it was on, and waits while Claude works", async () => {
    useStore.setState({ sessions: { s1: session({ extreme: false }) } } as never)
    await clearSession("s1")
    expect(sent[0]).not.toHaveProperty("extreme")
    sent.length = 0
    useStore.setState({ sessions: { s1: session({ state: "running" }) } } as never)
    expect(await clearSession("s1")).toBeUndefined()
    expect(sent).toEqual([])
  })
})

describe("New session in this worktree (T-085)", () => {
  it("starts beside it in the same worktree folder, set up as this one, and only for a worktree session", async () => {
    useStore.setState({ sessions: { s1: session({ worktree: { branch: "fix", repo: "C:\dev\shop" }, cwd: "C:\dev\wt\fix" }) }, openBeside: () => undefined } as never)
    expect(await sessionInWorktree("s1")).toBe("s2")
    expect(sent).toEqual([
      { type: "create_session", cwd: "C:\dev\wt\fix", mode: "acceptEdits", extreme: true, model: "claude-opus-5-5", effort: "high", account: "work" },
    ])
    sent.length = 0
    useStore.setState({ sessions: { s1: session() } } as never)
    expect(await sessionInWorktree("s1")).toBeUndefined()
    expect(sent).toEqual([])
  })
})
