// @vitest-environment jsdom
// Owner, 31 Oct: a quick way to the latest, a resumed session opening at its latest, and why a session stopped.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef, useEffect, useImperativeHandle } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { emptyTranscript, reduceHistory } from "../src/lib/transcript"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

const sent: Array<Record<string, unknown>> = []
const scrolled: unknown[] = []
let atBottom = true

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return { ok: true }
    }),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
// A stand-in list that draws every item, says whether it is at the bottom, and records where it was sent.
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function V(
    props: {
      data: unknown[]
      itemContent: (i: number, d: unknown) => React.ReactNode
      atBottomStateChange?: (b: boolean) => void
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ scrollToIndex: (o: unknown) => scrolled.push(o) }))
    useEffect(() => props.atBottomStateChange?.(atBottom), [props])
    return (
      <div>
        {props.data.map((d, i) => (
          <div key={i}>{props.itemContent(i, d)}</div>
        ))}
      </div>
    )
  }),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const session = {
  id: "s1",
  cwd: "C:/dev/shop",
  project: "shop",
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-31T10:00:00Z",
  sdkSessionId: "sdk-1",
}

beforeEach(() => {
  sent.length = 0
  scrolled.length = 0
  atBottom = true
  useStore.setState({
    sessions: { s1: session },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
  })
})
afterEach(cleanup)

describe("the latest in the conversation", () => {
  it("offers Jump to latest once you have scrolled up, and goes there", () => {
    atBottom = false
    useStore.getState().addUserText("s1", "hello")
    render(<Workspace />)
    fireEvent.click(screen.getByRole("button", { name: /Jump to latest/ }))
    expect(scrolled.at(-1)).toEqual({ index: "LAST", align: "end", behavior: "smooth" })
  })

  it("does not offer it at the bottom", () => {
    useStore.getState().addUserText("s1", "hello")
    render(<Workspace />)
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull()
  })

  it("opens a resumed or restarted conversation at its end once it is read back", async () => {
    let past = emptyTranscript()
    past = reduceHistory(past, { type: "user", message: { content: "build the shop" } })
    useStore.setState({ transcripts: { s1: { ...past, items: past.items.map((i) => ({ ...i, id: "h" + i.id })) } } })
    render(<Workspace />)
    await waitFor(() => expect(scrolled).toContainEqual({ index: "LAST", align: "end" }))
  })
})

describe("a session that stopped with an error", () => {
  it("says why, and starts again on the same conversation", async () => {
    useStore.setState({
      sessions: { s1: { ...session, state: "error", error: "Claude Code exited with code 1" } },
    })
    render(<Workspace />)
    expect(screen.getByRole("alert").textContent).toContain("Claude Code exited with code 1")
    fireEvent.click(screen.getByRole("button", { name: "Start again" }))
    await waitFor(() => expect(sent).toContainEqual({ type: "force_stop", sessionId: "s1" }))
  })
})

describe("Claude Code's summary after compacting", () => {
  it("reads as a quiet line, not as a message from you", () => {
    const t = reduceHistory(emptyTranscript(), {
      type: "user",
      message: { content: "This session is being continued from a previous conversation that ran out of context." },
    })
    expect(t.items).toEqual([
      expect.objectContaining({
        kind: "system",
        text: "Claude Code summarised the earlier conversation to make room.",
      }),
    ])
  })
})
