// @vitest-environment jsdom
// W1-12: Summary, Normal and Verbose per session, and the tool rows as a tree for the keyboard.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { summaryItems } from "../src/lib/groups"
import { readPaneView } from "../src/lib/paneView"
import { emptyTranscript, reduceHistory } from "../src/lib/transcript"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
// A stand-in list that draws every item.
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function V(props: {
    data: unknown[]
    itemContent: (i: number, d: unknown) => React.ReactNode
    computeItemKey?: (i: number, d: unknown) => string
  }) {
    return (
      <div>
        {props.data.map((d, i) => (
          <div key={props.computeItemKey?.(i, d) ?? i}>{props.itemContent(i, d)}</div>
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

function transcript() {
  let t = emptyTranscript()
  const add = (m: unknown) => (t = reduceHistory(t, m))
  add({ type: "user", message: { content: "Tidy the build" } })
  add({
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "First look at the scripts." },
        { type: "tool_use", id: "ok1", name: "Read", input: { file_path: "C:/dev/shop/a.ts" } },
        { type: "tool_use", id: "no1", name: "Bash", input: { command: "git push --force" } },
      ],
    },
  })
  add({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "ok1", content: "x" },
        { type: "tool_result", tool_use_id: "no1", content: "Denied", is_error: false },
      ],
    },
  })
  add({ type: "assistant", message: { content: [{ type: "text", text: "Done the tidy." }] } })
  return t
}

const ID = "s1"
beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    sessions: {
      [ID]: {
        id: ID,
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-11-01T09:00:00Z",
      },
    },
    transcripts: { [ID]: transcript() },
    decisions: {
      no1: {
        outcome: "deny",
        decidedBy: "rules",
        ruleId: "destructive-shell",
        reason: "x",
        risk: 100,
        at: 1,
      },
    },
    pending: {},
    panes: [],
    selectedSession: ID,
    route: "workspace",
  })
})
afterEach(cleanup)

const choose = (label: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: /shop: switch, open beside/ }))
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: label }))
}

describe("the transcript views", () => {
  it("keeps what was said, errors and anything refused in Summary, and hides the rest", () => {
    const items = transcript().items
    const kept = summaryItems(items, new Set(["no1"]))
    expect(kept.map((i) => i.kind)).toEqual(["user", "tool", "text"])
    expect(kept.find((i) => i.kind === "tool")).toMatchObject({ toolUseId: "no1" })
  })

  it("is chosen in the title menu and kept for that session", () => {
    render(<Workspace />)
    expect(screen.getByText("Thinking")).toBeTruthy()
    choose(/^Summary/)
    expect(screen.queryByText("Thinking")).toBeNull()
    expect(screen.getByText("Done the tidy.")).toBeTruthy()
    expect(readPaneView(ID).detail).toBe("summary")
    // Another session keeps its own.
    expect(readPaneView("other").detail).toBe("normal")
  })

  it("opens every tool call and the thinking in Verbose", () => {
    const { container } = render(<Workspace />)
    choose(/^Verbose/)
    expect(container.querySelector("details[open]")).toBeTruthy()
    const row = container.querySelector(".tool-group-line") as HTMLElement
    expect(row.getAttribute("aria-expanded")).toBe("true")
  })
})

describe("the tool rows as a tree", () => {
  it("opens with Right, closes with Left, and moves between rows with Up and Down", () => {
    useStore.setState({
      transcripts: {
        [ID]: (() => {
          let t = transcript()
          t = reduceHistory(t, {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", id: "g2", name: "Glob", input: { pattern: "*.ts" } }],
            },
          })
          return t
        })(),
      },
    })
    const { container } = render(<Workspace />)
    const rows = [...container.querySelectorAll<HTMLElement>(".tool-group-line")]
    expect(rows.length).toBeGreaterThanOrEqual(2)
    rows[0]!.focus()
    fireEvent.keyDown(rows[0]!, { key: "ArrowRight" })
    expect(rows[0]!.getAttribute("aria-expanded")).toBe("true")
    fireEvent.keyDown(rows[0]!, { key: "ArrowLeft" })
    expect(rows[0]!.getAttribute("aria-expanded")).toBe("false")
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" })
    expect(document.activeElement).toBe(container.querySelectorAll(".tool-group-line")[1])
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" })
    expect(document.activeElement).toBe(container.querySelectorAll(".tool-group-line")[0])
    expect(within(container).getAllByRole("button").length).toBeGreaterThan(0)
  })
})
