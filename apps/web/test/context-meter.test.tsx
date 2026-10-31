// @vitest-environment jsdom
// The context meter always shows, and offers Compact now from the point where it is worth it (owner, 30 Oct).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
let percentage = 65
vi.mock("../src/lib/connection", () => ({
  takeToken: () => "token",
  Connection: class {
    start() {}
    send(cmd: Record<string, unknown>) {
      sent.push(cmd)
      if (cmd.type === "context_usage")
        return Promise.resolve({
          ok: true,
          data: {
            percentage,
            totalTokens: percentage * 2000,
            maxTokens: 200_000,
            categories: [{ name: "Messages", tokens: percentage * 2000, kind: "used" }],
          },
        })
      return Promise.resolve({ ok: true })
    }
  },
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: () => <div />,
}))

const { startConnection, useStore } = await import("../src/store")
const { Workspace } = await import("../src/surfaces/Workspace")
const { reduce, emptyTranscript } = await import("../src/lib/transcript")
startConnection()

const ID = "019a0000-0000-7000-8000-00000000000a"
const session = (state: "idle" | "running") => ({
  id: ID,
  cwd: "C:\\dev\\shop",
  project: "shop",
  mode: "default" as const,
  state,
  pendingApprovals: 0,
  createdAt: "2026-10-30T09:00:00Z",
})
const open = (state: "idle" | "running") => {
  useStore.setState({
    conn: "open",
    sessions: { [ID]: session(state) },
    transcripts: {},
    route: "workspace",
    selectedSession: ID,
    panes: [ID],
  })
  render(<Workspace />)
}

beforeEach(() => {
  sent.length = 0
  percentage = 65
})
afterEach(cleanup)

describe("the context meter", () => {
  it("shows in a pane opened while Claude is working, not only after a turn", async () => {
    open("running")
    expect(await screen.findByRole("button", { name: /Context 65% used/ })).toBeTruthy()
    expect(sent.filter((c) => c.type === "context_usage")).toHaveLength(1)
  })

  it("says compacting is worth it from 60%, and compacts between turns", async () => {
    open("idle")
    const meter = await screen.findByRole("button", { name: /Context 65% used.*worth compacting/ })
    expect(meter.textContent).toContain("Compact")
    fireEvent.click(meter)
    const panel = screen.getByRole("group", { name: "What fills the context" })
    expect(panel.textContent).toContain("Worth compacting now")
    fireEvent.click(within(panel).getByRole("button", { name: "Compact now" }))
    await waitFor(() =>
      expect(sent.at(-1)).toEqual({ type: "compact", sessionId: ID }),
    )
    // The transcript says so, rather than showing a typed command.
    expect(useStore.getState().transcripts[ID]?.items.at(-1)).toMatchObject({
      kind: "system",
      text: "You asked Claude Code to compact the conversation.",
    })
  })

  it("does not push compacting when there is room, and compacts after the turn when asked mid-turn", async () => {
    percentage = 30
    open("running")
    const meter = await screen.findByRole("button", { name: /Context 30% used/ })
    expect(meter.textContent).not.toContain("Compact")
    fireEvent.click(meter)
    const panel = screen.getByRole("group", { name: "What fills the context" })
    expect(panel.textContent).toContain("Not needed yet")
    fireEvent.click(within(panel).getByRole("button", { name: "Compact after this turn" }))
    await waitFor(() => expect(sent.at(-1)).toEqual({ type: "compact", sessionId: ID }))
    expect(useStore.getState().transcripts[ID]?.items.at(-1)).toMatchObject({
      text: "You asked Claude Code to compact the conversation when this turn ends.",
    })
    // Once asked, it says so and cannot be asked twice.
    useStore.setState((st) => ({
      sessions: { [ID]: { ...st.sessions[ID]!, compactPending: true } },
    }))
    fireEvent.click(await screen.findByRole("button", { name: /Context 30% used/ }))
    const again = screen.getByRole("group", { name: "What fills the context" })
    expect(
      (within(again).getByRole("button", { name: "Compacts after this turn" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it("says when Claude Code summarised the conversation", () => {
    const t = reduce(emptyTranscript(), { type: "system", subtype: "compact_boundary" })
    expect(t.items[0]).toMatchObject({
      kind: "system",
      text: "Claude Code summarised the earlier conversation to make room.",
    })
  })
})
