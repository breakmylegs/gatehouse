// @vitest-environment jsdom
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Approvals } from "../src/surfaces/Approvals"
import { Sessions } from "../src/surfaces/Sessions"
import { Workspace } from "../src/surfaces/Workspace"
import { useStore } from "../src/store"

const sent: Array<{ type: string; requestId?: string }> = []
let reply: (cmd: { type: string }) => Promise<{
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
}> = async () => ({ ok: true })

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: { type: string }) => {
      sent.push(cmd)
      return reply(cmd)
    }),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
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

function view(id: string, over: Partial<PendingView["request"]> = {}, risk = 50): PendingView {
  return {
    request: {
      id,
      nonce: "n",
      kind: "permission",
      sessionId: "s1",
      toolUseId: `tu-${id}`,
      toolName: "Write",
      input: { file_path: "C:\\dev\\Test\\minisheet.html" },
      cwd: "C:\\dev\\Test",
      project: "Test",
      verdict: {
        outcome: "escalate",
        ruleId: "no-rule",
        reason: "No rule allows this call, so it needs your approval.",
        risk,
        decidedBy: "rules",
        policyHash: "h",
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      payloadHash: "p",
      ...over,
    },
    rawInput: { file_path: "C:\\dev\\Test\\minisheet.html", content: "<html></html>" },
    defaultToNo: risk >= 70,
    phone: "none",
    hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
  }
}

const session = {
  id: "s1",
  cwd: "C:\\dev\\Test",
  project: "Test",
  mode: "default" as const,
  extreme: true,
  state: "waiting" as const,
  pendingApprovals: 1,
  createdAt: "2026-10-29T18:00:00Z",
}

beforeEach(() => {
  sent.length = 0
  reply = async () => ({ ok: true })
  useStore.setState({
    conn: "open",
    sessions: { s1: session },
    transcripts: {},
    activity: {},
    pending: {},
    resolved: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
  })
})
afterEach(cleanup)

describe("Allow once and Deny on the queue", () => {
  it("decides a permission from its row without opening it", () => {
    const a = view("a")
    const b = view("b", { toolName: "PowerShell", project: "atlas" })
    const q = view("q", { kind: "question", toolName: "AskUserQuestion" })
    useStore.setState({ pending: { a, b, q } })
    render(<Approvals />)
    const rowA = screen.getByRole("group", { name: "Decide Write from Test" })
    fireEvent.click(within(rowA).getByRole("button", { name: "Allow once" }))
    // Until the Host answers, a second click cannot send a second decision.
    expect(within(rowA).getByRole("button", { name: "Deny" })).toHaveProperty("disabled", true)
    const rowB = screen.getByRole("group", { name: "Decide Run shell command from atlas" })
    fireEvent.click(within(rowB).getByRole("button", { name: "Deny" }))
    expect(sent).toEqual([
      { type: "approve", requestId: "a" },
      { type: "deny", requestId: "b" },
    ])
    // Neither click opened the request on the card.
    expect(useStore.getState().selectedRequest).not.toBe("b")
    // A question needs its answers, so its row has no Allow.
    expect(screen.getAllByRole("group", { name: /^Decide / })).toHaveLength(2)
  })

  it("says what the Host said when it refused, on the row itself", async () => {
    reply = async () => ({
      ok: false,
      error: { code: "unknown-request", message: "That request is not waiting any more" },
    })
    useStore.setState({ pending: { a: view("a") } })
    render(<Approvals />)
    fireEvent.click(screen.getAllByRole("button", { name: "Allow once" })[0]!)
    expect(await screen.findAllByText("That request is not waiting any more")).not.toHaveLength(0)
  })
})

describe("deciding in the session's own workspace", () => {
  it("shows the request above the prompt box and allows it there", () => {
    useStore.setState({ pending: { a: view("a") } })
    render(<Workspace />)
    const panel = screen.getByRole("region", { name: "Write" })
    expect(within(panel).getByText("C:\\dev\\Test\\minisheet.html")).toBeTruthy()
    expect(within(panel).getByText(/No rule allows this call/)).toBeTruthy()
    fireEvent.click(within(panel).getByRole("button", { name: /^Allow once/ }))
    expect(sent).toEqual([{ type: "approve", requestId: "a" }])
  })

  it("takes Ctrl+Enter and Esc only while focus is inside the request", () => {
    useStore.setState({ pending: { a: view("a") } })
    render(<Workspace />)
    // In the prompt box they do nothing to the request.
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true })
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })
    expect(sent.filter((c) => c.type === "approve" || c.type === "deny")).toEqual([])
    fireEvent.keyDown(screen.getByRole("region", { name: "Write" }), { key: "Escape" })
    expect(sent).toEqual([{ type: "deny", requestId: "a" }])
  })

  it("makes Deny the filled choice at high risk", () => {
    useStore.setState({ pending: { a: view("a", {}, 82) } })
    render(<Workspace />)
    const panel = screen.getByRole("region", { name: "Write" })
    expect(within(panel).getByRole("button", { name: /^Deny/ }).className).toContain("btn-primary")
    expect(within(panel).getByRole("button", { name: /^Allow once/ }).className).not.toContain(
      "btn-primary",
    )
  })

  it("shows what the session is doing while a turn runs, from the stream, and stops when it ends", () => {
    const running = { ...session, state: "running" as const, pendingApprovals: 0 }
    useStore.setState({ sessions: { s1: running } })
    const { handleEvent } = useStore.getState()
    const stream = (event: Record<string, unknown>) =>
      act(() =>
        handleEvent({
          type: "sdk_message",
          sessionId: "s1",
          message: { type: "stream_event", event },
        }),
      )
    render(<Workspace />)
    stream({ type: "message_start" })
    expect(screen.getByRole("status").textContent).toBe("Claude is thinking")
    stream({ type: "content_block_start", content_block: { type: "tool_use", name: "Write" } })
    stream({
      type: "content_block_delta",
      delta: {
        type: "input_json_delta",
        partial_json: `{"file_path": "minisheet.html", "content": "${"x".repeat(12_356)}`,
      },
    })
    expect(screen.getByRole("status").textContent).toBe("Claude is writing minisheet.html")
    expect(screen.getByText(/12,400 characters so far/)).toBeTruthy()
    act(() => handleEvent({ type: "session", info: { ...running, state: "idle" } }))
    expect(screen.queryByRole("status")).toBeNull()
    expect(useStore.getState().activity.s1).toBeUndefined()
  })
})

describe("the side panels of a pane", () => {
  it("open from the pane's buttons, close with Close or Esc, and give focus back", () => {
    render(<Workspace />)
    const files = screen.getByRole("button", { name: "Files" })
    fireEvent.click(files)
    expect(files.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByRole("complementary", { name: "Files" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(files.getAttribute("aria-pressed")).toBe("false")
    expect(files).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: "Plan" }))
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Plan" }), { key: "Escape" })
    expect(screen.getByRole("button", { name: "Plan" }).getAttribute("aria-pressed")).toBe("false")
  })
})

describe("starting a session", () => {
  it("counts the seconds while it starts, and a slow start is not called a failure", async () => {
    let finish!: (r: { ok: boolean; error?: { code: string; message: string } }) => void
    reply = (cmd) =>
      cmd.type === "create_session"
        ? new Promise((r) => (finish = r))
        : Promise.resolve({ ok: true })
    useStore.setState({ sessions: {} })
    render(<Sessions />)
    fireEvent.change(screen.getByRole("textbox", { name: /^Folder/ }), {
      target: { value: "C:\\dev\\Test" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    expect(await screen.findByText("Starting Claude Code and checking your account")).toBeTruthy()
    expect(screen.getByText("0 s")).toBeTruthy()
    finish({ ok: false, error: { code: "timeout", message: "The Host did not answer in time" } })
    expect(await screen.findByText(/taking longer than usual/)).toBeTruthy()
    expect(screen.queryByText("The Host did not answer in time")).toBeNull()
  })
})
