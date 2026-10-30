// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { describeDecision, laterDecision, type Decision } from "../src/lib/decision"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

const asked: string[] = []
let history: unknown[] = []

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) => {
    asked.push(url)
    return url.startsWith("/api/audit?")
      ? { ok: true, status: 200, data: { records: history } }
      : { ok: false, status: 404, error: "no route" }
  }),
}))
// The lists are virtual and draw nothing in jsdom, which has no layout; here they draw every row.
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
    computeItemKey,
  }: {
    data: unknown[]
    itemContent: (i: number, d: unknown) => React.ReactNode
    computeItemKey?: (i: number, d: unknown) => string
  }) => (
    <div>
      {data.map((d, i) => (
        <div key={computeItemKey?.(i, d) ?? i}>{itemContent(i, d)}</div>
      ))}
    </div>
  ),
}))

const session = {
  id: "s1",
  cwd: "C:\\dev\\Test",
  project: "Test",
  mode: "default" as const,
  state: "running" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-30T09:00:00Z",
}

const rules = (outcome: Decision["outcome"], ruleId: string, reason: string) => ({
  outcome,
  ruleId,
  reason,
  risk: 10,
  decidedBy: "rules" as const,
})

function tools() {
  const h = useStore.getState().handleEvent
  const call = (id: string, name: string, input: Record<string, unknown>) =>
    h({
      type: "sdk_message",
      sessionId: "s1",
      message: {
        type: "assistant",
        message: { content: [{ type: "tool_use", id, name, input }] },
      },
    })
  call("t1", "Read", { file_path: "C:\\dev\\Test\\a.ts" })
  call("t2", "Bash", { command: "git push --force" })
  call("t3", "Write", { file_path: "C:\\dev\\Test\\b.ts", content: "x" })
}

beforeEach(() => {
  asked.length = 0
  history = []
  useStore.setState({
    conn: "open",
    sessions: { s1: session },
    transcripts: {},
    activity: {},
    pending: {},
    resolved: {},
    decisions: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
  })
})
afterEach(cleanup)

describe("why each tool call was allowed, asked or blocked", () => {
  it("shows each call's decision as it is made, and marks only what asked you or was stopped", async () => {
    tools()
    const h = useStore.getState().handleEvent
    h({
      type: "session_event",
      sessionId: "s1",
      event: "decision",
      data: {
        toolUseId: "t1",
        ...rules("allow", "read-workspace", "Reading files inside this project."),
      },
    })
    h({
      type: "session_event",
      sessionId: "s1",
      event: "decision",
      data: {
        toolUseId: "t2",
        ...rules("deny", "force-push", "Force pushing rewrites shared history."),
      },
    })
    // A person's answer arrives as the Host's audit record.
    h({
      type: "audit",
      record: {
        session: "s1",
        toolUseId: "t3",
        ts: new Date().toISOString(),
        verdict: {
          ...rules("allow", "no-rule", "Approved on desktop."),
          decidedBy: "human-desktop",
        },
      },
    })
    render(<Workspace />)
    const group = screen.getByRole("button", { name: /1 blocked/ })
    fireEvent.click(group)
    const card = (text: RegExp) => screen.getByText(text).closest("details") as HTMLElement
    const read = card(/^Allowed by your rules: Reading files inside this project\./)
    expect(within(read).queryByText("Blocked")).toBeNull()
    expect(read.querySelector("summary")?.textContent).not.toMatch(/allowed/i)
    const push = card(/^Blocked by your rules: Force pushing/)
    expect(within(push.querySelector("summary") as HTMLElement).getByText("Blocked")).toBeTruthy()
    const write = card(/^You allowed this on this computer\./)
    expect(
      within(write.querySelector("summary") as HTMLElement).getByText("You allowed"),
    ).toBeTruthy()

    fireEvent.click(within(push).getByRole("button", { name: "Change what Claude may do" }))
    expect(useStore.getState().route).toBe("policy")
  })

  it("reads the decisions back from the audit log when the workspace opens", async () => {
    tools()
    history = [
      {
        session: "s1",
        toolUseId: "t2",
        ts: "2026-10-30T09:01:00Z",
        verdict: rules("deny", "force-push", "Force pushing rewrites shared history."),
      },
    ]
    render(<Workspace />)
    await waitFor(() => expect(screen.getByRole("button", { name: /1 blocked/ })).toBeTruthy())
    expect(asked.some((u) => u.startsWith("/api/audit?") && u.includes("session=s1"))).toBe(true)
  })
})

describe("which decision to show, and in what words", () => {
  const d = (over: Partial<Decision>): Decision => ({
    outcome: "allow",
    decidedBy: "rules",
    ruleId: "r",
    reason: "Because.",
    risk: 0,
    at: 1,
    ...over,
  })
  it("prefers the answer to the question that led to it, then the later answer", () => {
    const question = d({ outcome: "escalate", at: 5 })
    const answer = d({ outcome: "allow", decidedBy: "human-desktop", at: 2 })
    expect(laterDecision(question, answer)).toBe(answer)
    expect(laterDecision(answer, question)).toBe(answer)
    const later = d({ outcome: "deny", decidedBy: "timeout", at: 9 })
    expect(laterDecision(answer, later)).toBe(later)
  })
  it("says who decided, quietly for your rules' allows", () => {
    expect(describeDecision(d({}))).toEqual({
      line: "Allowed by your rules: Because.",
      stopped: false,
    })
    expect(describeDecision(d({ decidedBy: "timeout", outcome: "deny" }))).toMatchObject({
      mark: "Not answered",
      stopped: true,
    })
    expect(describeDecision(d({ decidedBy: "floor", outcome: "deny" })).line).toBe(
      "Always blocked: Because.",
    )
    expect(describeDecision(d({ ruleId: "cancelled", outcome: "deny" })).mark).toBe("Cancelled")
    expect(describeDecision(d({ ruleId: "claude-code-auto" })).mark).toBeUndefined()
  })
})
