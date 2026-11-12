// @vitest-environment jsdom
// Mac fork: a trackpad scrolls a few pixels at a time. Within the 80 px the conversation counts as "at the end", output
// arriving pulled you back down as you started to scroll up to read; now scrolling up stops following at once.
import { act, cleanup, render } from "@testing-library/react"
import { forwardRef, useImperativeHandle } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

type ListProps = {
  onWheel: (e: { deltaY: number }) => void
  totalListHeightChanged: () => void
  followOutput: (atBottom: boolean) => unknown
}
let list: ListProps
const scrollToIndex = vi.fn()

vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
// The list as Workspace drives it: the props it is given, and the scroll it asks for.
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef((props: ListProps, ref) => {
    list = props
    useImperativeHandle(ref, () => ({ scrollToIndex }))
    return <div />
  }),
}))

beforeEach(() => {
  scrollToIndex.mockClear()
  useStore.setState({
    conn: "open",
    sessions: {
      s1: {
        id: "s1",
        cwd: "/Users/you/dev/test",
        project: "Test",
        mode: "default" as const,
        state: "running" as const,
        pendingApprovals: 0,
        createdAt: "2026-11-12T09:00:00Z",
      },
    },
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

describe("the conversation following its latest output", () => {
  it("stops following as soon as you scroll up, and follows again when you scroll down at the end", () => {
    render(<Workspace />)
    act(() => list.totalListHeightChanged())
    expect(scrollToIndex).toHaveBeenCalledTimes(1)

    act(() => list.onWheel({ deltaY: -4 }))
    act(() => list.totalListHeightChanged())
    expect(scrollToIndex).toHaveBeenCalledTimes(1)
    expect(list.followOutput(true)).toBe(false)

    act(() => list.onWheel({ deltaY: 4 }))
    act(() => list.totalListHeightChanged())
    expect(scrollToIndex).toHaveBeenCalledTimes(2)
    expect(list.followOutput(true)).toBe("smooth")
  })
})
