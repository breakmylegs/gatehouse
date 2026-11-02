// @vitest-environment jsdom
// W1-15: the quick prompt sends a new chat or a message to the coding session started last, then tells the window
// what it sent; Esc asks the window to put it away. The main page shows what was sent and follows the shortcut.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readHotkeyReply, startShell } from "../src/lib/quickKey"
import { useStore } from "../src/store"
import { Quick } from "../src/surfaces/Quick"

const sent: Array<Record<string, unknown>> = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return cmd.type === "create_session"
        ? { ok: true, data: { sessionId: "chat-9" } }
        : { ok: true }
    }),
  }
})

const posted: string[] = []
let listeners: Array<(e: { data: unknown }) => void> = []
beforeEach(() => {
  sent.length = 0
  posted.length = 0
  listeners = []
  ;(globalThis as Record<string, unknown>).chrome = {
    webview: {
      postMessage: (m: string) => posted.push(m),
      addEventListener: (_t: string, f: (e: { data: unknown }) => void) => listeners.push(f),
      removeEventListener: (_t: string, f: (e: { data: unknown }) => void) =>
        (listeners = listeners.filter((x) => x !== f)),
    },
  }
  const base = { pendingApprovals: 0, mode: "default" as const, state: "idle" as const }
  useStore.setState({
    sessions: {
      old: { ...base, id: "old", cwd: "C:/a", project: "a", createdAt: "2026-11-01T08:00:00Z" },
      shop: {
        ...base,
        id: "shop",
        cwd: "C:/shop",
        project: "shop",
        createdAt: "2026-11-01T09:00:00Z",
      },
      talk: {
        ...base,
        id: "talk",
        kind: "chat",
        cwd: "chat",
        project: "chat",
        createdAt: "2026-11-01T10:00:00Z",
      },
    },
  })
})
afterEach(() => {
  cleanup()
  delete (globalThis as Record<string, unknown>).chrome
})

describe("the quick prompt", () => {
  it("starts a chat with what you typed, and tells the window what it sent", async () => {
    render(<Quick />)
    const box = screen.getByRole("textbox", { name: "Ask in a new chat" })
    fireEvent.change(box, { target: { value: "What is a job object?" } })
    fireEvent.keyDown(box, { key: "Enter" })
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(sent[0]).toMatchObject({ type: "create_session", kind: "chat", mode: "plan" })
    expect(sent[1]).toEqual({ type: "prompt", sessionId: "chat-9", text: "What is a job object?" })
    expect(JSON.parse(posted[0]!.replace(/^quick-open:/, ""))).toEqual({
      session: "chat-9",
      text: "What is a job object?",
    })
  })

  it("messages the coding session started last, not a chat", async () => {
    render(<Quick />)
    fireEvent.click(screen.getByRole("radio", { name: "shop" }))
    const box = screen.getByRole("textbox", { name: "Message shop" })
    fireEvent.change(box, { target: { value: "Run the tests" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(sent).toEqual([{ type: "prompt", sessionId: "shop", text: "Run the tests" }])
  })

  it("asks the window to put it away on Esc", () => {
    render(<Quick />)
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })
    expect(posted).toEqual(["quick-close"])
  })
})

describe("the main window and the quick prompt", () => {
  it("tells the window the shortcut, and shows what the quick prompt sent", () => {
    const stop = startShell()
    expect(posted).toEqual(["hotkey:Ctrl+Alt+Space"])
    act(() =>
      listeners.forEach((f) =>
        f({ data: 'open-session:{"session":"shop","text":"Run the tests"}' }),
      ),
    )
    const st = useStore.getState()
    expect(st.route).toBe("workspace")
    expect(st.selectedSession).toBe("shop")
    expect(JSON.stringify(st.transcripts.shop?.items)).toContain("Run the tests")
    stop()
  })

  it("reads the window's answers about a shortcut", () => {
    expect(readHotkeyReply("hotkey-ok:Ctrl+Alt+Space")).toEqual({
      kind: "ok",
      text: "Ctrl+Alt+Space",
    })
    expect(
      readHotkeyReply("hotkey-clash:Ctrl+Alt+Q|Ctrl+Alt+Shift+Q|Ctrl+Shift+Q|Alt+Shift+Q"),
    ).toEqual({
      kind: "clash",
      text: "Ctrl+Alt+Q",
      alternatives: ["Ctrl+Alt+Shift+Q", "Ctrl+Shift+Q", "Alt+Shift+Q"],
    })
    expect(readHotkeyReply("attention")).toBeUndefined()
  })
})
