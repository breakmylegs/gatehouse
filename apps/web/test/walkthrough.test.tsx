// @vitest-environment jsdom
// Backlog G31: a session's evidence in one place: plan and commits, changes, tests, and the decisions that were not
// the rules allowing by themselves, each opening its audit record.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({
    ok: true,
    status: 200,
    data: {
      records: [
        {
          seq: 12,
          ts: "2026-11-09T10:02:00Z",
          tool: "Bash",
          event: "human_decision",
          verdict: {
            outcome: "allow",
            ruleId: "no-rule",
            reason: "",
            risk: 50,
            decidedBy: "human-desktop",
          },
        },
        {
          seq: 11,
          ts: "2026-11-09T10:01:00Z",
          tool: "Read",
          event: "decision",
          verdict: {
            outcome: "allow",
            ruleId: "read-in-project",
            reason: "",
            risk: 0,
            decidedBy: "rules",
          },
        },
        {
          seq: 10,
          ts: "2026-11-09T10:00:00Z",
          tool: "Bash",
          event: "decision",
          verdict: {
            outcome: "deny",
            ruleId: "destructive-shell",
            reason: "",
            risk: 90,
            decidedBy: "rules",
          },
        },
      ],
    },
  })),
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async () => ({
      ok: true,
      data: { files: [{ path: "src/basket.ts", change: "modified", added: 12, removed: 3 }] },
    })),
  }
})
const { useStore } = await import("../src/store")
const { Walkthrough, walkthroughMarkdown, testRuns } = await import("../src/components/Walkthrough")

afterEach(cleanup)

const items = [
  {
    id: "1",
    kind: "tool",
    toolUseId: "t1",
    name: "Bash",
    input: { command: "npm test" },
    result: { text: "1 failed", isError: true },
  },
  {
    id: "2",
    kind: "tool",
    toolUseId: "t2",
    name: "Bash",
    input: { command: "ls" },
    result: { text: "", isError: false },
  },
  {
    id: "3",
    kind: "tool",
    toolUseId: "t3",
    name: "Bash",
    input: { command: "npx vitest run" },
    result: { text: "ok", isError: false },
  },
] as never

describe("the walkthrough", () => {
  it("reads the test runs in order, and nothing else", () => {
    expect(testRuns(items)).toEqual([
      { command: "npm test", passed: false },
      { command: "npx vitest run", passed: true },
    ])
  })

  it("shows the plan, changes, tests and the decisions worth a look, oldest first, each opening its record", async () => {
    useStore.setState({
      sessions: {
        s1: {
          id: "s1",
          cwd: "C:/dev/shop",
          project: "shop",
          mode: "default",
          state: "idle",
          pendingApprovals: 0,
          createdAt: "2026-11-09T09:00:00Z",
        },
      } as never,
      transcripts: {
        s1: {
          items,
          todos: [{ content: "Add a basket", status: "completed", commits: ["1a2b3c4"] }],
          seq: 3,
        },
      } as never,
      route: "workspace",
    })
    const close = vi.fn()
    render(<Walkthrough sessionId="s1" onClose={close} />)
    const w = screen.getByRole("region", { name: "Walkthrough of shop" })
    expect(w.textContent).toContain("Done: Add a basket 1a2b3c4")
    await waitFor(() => expect(w.textContent).toContain("src/basket.ts +12 -3"))
    expect(w.textContent).toMatch(/Failed npm test.*Passed npx vitest run/)
    await waitFor(() =>
      expect(within(w).getAllByRole("button", { name: /Open record/ })).toHaveLength(2),
    )
    // The rules' plain allow is left out; the deny and your allow are in, oldest first.
    const opens = within(w).getAllByRole("button", { name: /Open record/ })
    expect(opens.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open record 10",
      "Open record 12",
    ])
    fireEvent.click(opens[1]!)
    expect(useStore.getState()).toMatchObject({ route: "audit", auditOpen: 12 })
    expect(close).toHaveBeenCalled()
  })

  it("writes it all as Markdown", () => {
    const md = walkthroughMarkdown({
      title: "shop",
      todos: [{ content: "Add a basket", status: "completed", commits: ["1a2b3c4"] }],
      files: [{ path: "src/basket.ts", change: "modified", added: 12, removed: 3 }],
      tests: [{ command: "npm test", passed: true }],
      decisions: [],
    })
    expect(md).toContain("- [x] Add a basket (1a2b3c4)")
    expect(md).toContain("- src/basket.ts: modified, +12 -3")
    expect(md).toContain("- Passed: `npm test`")
    expect(md).toContain("Every call was allowed by your rules.")
  })
})
