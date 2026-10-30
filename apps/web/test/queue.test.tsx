// @vitest-environment jsdom
// A message sent while Claude works waits for Claude's next step, says so until Claude has it, and can be made to
// interrupt instead (owner, 30 Oct).
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
vi.mock("../src/lib/connection", () => ({
  takeToken: () => "token",
  Connection: class {
    start() {}
    send(cmd: Record<string, unknown>) {
      sent.push(cmd)
      return Promise.resolve({ ok: true })
    }
  },
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[]
    itemContent: (i: number, d: unknown) => React.ReactNode
  }) => (
    <div>
      {data.map((d, i) => (
        <div key={i}>{itemContent(i, d)}</div>
      ))}
    </div>
  ),
}))

const { startConnection, useStore } = await import("../src/store")
const { Workspace } = await import("../src/surfaces/Workspace")
const { addUser, emptyTranscript, reduce } = await import("../src/lib/transcript")
startConnection()

const ID = "019a0000-0000-7000-8000-00000000000a"
const tool = (id: string) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name: "Read", input: {} }] },
})
const result = (id: string) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
})
const says = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
})
const queued = (t: { items: Array<{ kind: string; queued?: boolean }> }) =>
  t.items.filter((i) => i.kind === "user" && i.queued).length

beforeEach(() => {
  sent.length = 0
})
afterEach(cleanup)

describe("a message sent while Claude works", () => {
  it("is queued until a tool result has come back after it and Claude has answered again", () => {
    let t = reduce(emptyTranscript(), tool("t1"))
    t = addUser(t, "also count the words", undefined, true)
    expect(queued(t)).toBe(1)
    // Claude's next step was already on its way: it has not seen the message yet.
    t = reduce(t, says("Reading the next file."))
    expect(queued(t)).toBe(1)
    t = reduce(t, result("t1"))
    expect(queued(t)).toBe(1)
    t = reduce(t, tool("t2"))
    expect(queued(t)).toBe(0)
  })

  it("is taken in by the end of the turn at the latest, and a subagent's steps do not count", () => {
    let t = addUser(reduce(emptyTranscript(), tool("t1")), "and then stop", undefined, true)
    t = reduce(t, { ...result("t1"), parent_tool_use_id: "agent-1" })
    t = reduce(t, { ...tool("t2"), parent_tool_use_id: "agent-1" })
    expect(queued(t)).toBe(1)
    // No result of Claude's own has come back since, so its next words have not seen the message.
    t = reduce(t, says("Still waiting for the subagent."))
    expect(queued(t)).toBe(1)
    t = reduce(t, { type: "result", subtype: "success", result: "Done" })
    expect(queued(t)).toBe(0)
  })

  it("shows as queued in the pane, with Interrupt now", () => {
    useStore.setState({
      conn: "open",
      sessions: {
        [ID]: {
          id: ID,
          cwd: "C:\\dev\\shop",
          project: "shop",
          mode: "default",
          state: "running",
          pendingApprovals: 0,
          createdAt: "2026-10-30T09:00:00Z",
        },
      },
      transcripts: {},
      route: "workspace",
      selectedSession: ID,
      panes: [ID],
    })
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: "Prompt" })
    fireEvent.change(box, { target: { value: "also count the words" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(screen.getByText("Queued: Claude reads it at its next step.")).toBeTruthy()
    expect(sent.find((c) => c.type === "prompt")).toEqual({
      type: "prompt",
      sessionId: ID,
      text: "also count the words",
    })
    fireEvent.click(screen.getByRole("button", { name: "Interrupt now" }))
    expect(sent.at(-1)).toEqual({ type: "stop_session", sessionId: ID })
  })
})
