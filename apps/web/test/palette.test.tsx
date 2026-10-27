// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandPalette } from "../src/components/CommandPalette"
import { useStore } from "../src/store"

// cmdk measures the list with these, which jsdom does not provide.
beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never
  Element.prototype.scrollIntoView ??= () => {}
  useStore.setState({
    route: "approvals",
    selectedSession: undefined,
    selectedRequest: undefined,
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:\\dev\\atlas",
        project: "atlas",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
    pending: {},
  })
})
afterEach(cleanup)

const open = () => fireEvent.keyDown(window, { key: "k", ctrlKey: true })

describe("command palette", () => {
  it("opens with Ctrl+K, closes with Esc, and gives focus back", async () => {
    render(
      <>
        <button>Composer stand-in</button>
        <CommandPalette />
      </>,
    )
    screen.getByRole("button").focus()
    expect(screen.queryByRole("dialog")).toBeNull()
    open()
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("button")).toHaveFocus()
  })

  it("jumps to a page or a session, and filters as you type", async () => {
    render(<CommandPalette />)
    open()
    await userEvent.type(await screen.findByPlaceholderText(/Go to a page/), "audit")
    expect(screen.queryByText("Settings")).toBeNull()
    await userEvent.click(screen.getByText("Audit log"))
    expect(useStore.getState().route).toBe("audit")
    expect(screen.queryByRole("dialog")).toBeNull()
    open()
    await userEvent.click(await screen.findByText(/atlas \(idle\)/))
    expect(useStore.getState()).toMatchObject({ route: "workspace", selectedSession: "s1" })
  })

  it("offers waiting requests first, and only moves you to the card without deciding anything", async () => {
    useStore.getState().handleEvent({
      type: "approval_request",
      view: {
        request: {
          id: "r1",
          nonce: "n",
          kind: "permission",
          sessionId: "s1",
          toolUseId: "t",
          toolName: "Bash",
          input: {},
          cwd: "C:\\dev",
          project: "atlas",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-01T00:10:00Z",
          payloadHash: "h",
          verdict: {
            outcome: "escalate",
            ruleId: "r",
            reason: "why",
            risk: 82,
            decidedBy: "rules",
            policyHash: "h",
          },
        },
        rawInput: {},
        defaultToNo: true,
        phone: "none",
        hardDeadline: "2026-01-01T00:30:00Z",
      },
    })
    useStore.setState({ route: "sessions", selectedRequest: undefined })
    render(<CommandPalette />)
    open()
    await userEvent.click(await screen.findByText(/atlas: Bash \(risk 82\)/))
    expect(useStore.getState()).toMatchObject({ route: "approvals", selectedRequest: "r1" })
    expect(Object.keys(useStore.getState().pending)).toEqual(["r1"])
    open()
    expect(screen.queryByText(/Allow|Deny|Kill/)).toBeNull()
  })

  it("switches theme, and says when nothing matches", async () => {
    useStore.setState({ theme: "light" })
    render(<CommandPalette />)
    open()
    await userEvent.type(await screen.findByPlaceholderText(/Go to a page/), "zzzzqq")
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument()
    await userEvent.clear(screen.getByPlaceholderText(/Go to a page/))
    await userEvent.click(screen.getByText("Switch to dark theme"))
    expect(useStore.getState().theme).toBe("dark")
  })
})
