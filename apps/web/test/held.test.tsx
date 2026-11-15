// @vitest-environment jsdom
// T-039 (t3code review): messages held until the turn ends: listed, edited, removed or sent now; the first goes when
// a turn ends, and a turn you stopped or one that failed leaves them waiting for Resume.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (cmd: Record<string, unknown>) => (sent.push(cmd), { ok: true })) }
})
const { useStore } = await import("../src/store")
const { useHeld } = await import("../src/lib/held")
const { HeldList } = await import("../src/components/HeldList")

const session = (state: string) => ({
  s1: { id: "s1", cwd: "C:\\x", project: "x", mode: "default", state, pendingApprovals: 0, createdAt: "2026-11-14T08:00:00Z" },
})
const turnEnded = (result: Record<string, unknown>) =>
  act(() =>
    useStore.setState({
      sessions: session("idle"),
      transcripts: { s1: { items: [{ kind: "result", id: "r", isError: false, ...result }], todos: [], seq: 2 } },
    } as never),
  )

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  useHeld.setState({ held: {}, paused: {} })
  useStore.setState({ sessions: session("running"), transcripts: { s1: { items: [], todos: [], seq: 1 } } } as never)
})
afterEach(cleanup)

describe("held until the turn ends (T-039)", () => {
  it("sends the first when the turn ends, one at a time, as an ordinary prompt", async () => {
    useHeld.getState().hold("s1", "first")
    useHeld.getState().hold("s1", "second")
    render(<HeldList sessionId="s1" onEdit={() => undefined} />)
    expect(screen.getByText("2 messages go one at a time as each turn ends.")).toBeTruthy()
    turnEnded({})
    await vi.waitFor(() => expect(sent).toEqual([{ type: "prompt", sessionId: "s1", text: "first" }]))
    expect(useHeld.getState().held.s1!.map((h) => h.text)).toEqual(["second"])
    expect(JSON.parse(localStorage.getItem("gatehouse.held")!).s1).toHaveLength(1)
  })

  it("waits for Resume after a turn you stopped", async () => {
    useHeld.getState().hold("s1", "first")
    render(<HeldList sessionId="s1" onEdit={() => undefined} />)
    turnEnded({ stopped: true })
    expect(await screen.findByText("The turn was stopped or failed, so these wait for you.")).toBeTruthy()
    expect(sent).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))
    await vi.waitFor(() => expect(sent).toEqual([{ type: "prompt", sessionId: "s1", text: "first" }]))
  })

  it("edits one back into the prompt box, removes one, or sends one now", async () => {
    for (const t of ["a", "b", "c"]) useHeld.getState().hold("s1", t)
    const edited: string[] = []
    render(<HeldList sessionId="s1" onEdit={(t) => edited.push(t)} />)
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!)
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!)
    fireEvent.click(screen.getAllByRole("button", { name: "Send now" })[0]!)
    expect(edited).toEqual(["a"])
    await vi.waitFor(() => expect(sent).toEqual([{ type: "prompt", sessionId: "s1", text: "c" }]))
    expect(useHeld.getState().held.s1).toEqual([])
  })
})
