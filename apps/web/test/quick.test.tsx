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

const attached: Array<Record<string, unknown>> = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string, body: Record<string, unknown>) => {
    if (url === "/api/files/attach-data") {
      attached.push(body)
      return { ok: true, status: 200, data: { rel: ".codehouse/attachments/ab12cd-screen.png" } }
    }
    return { ok: false, status: 404 }
  }),
}))

const posted: string[] = []
let listeners: Array<(e: { data: unknown }) => void> = []
beforeEach(() => {
  sent.length = 0
  posted.length = 0
  attached.length = 0
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

  it("carries on in the chat you used last, instead of starting one (CH-08)", async () => {
    render(<Quick />)
    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(3)
    fireEvent.click(radios[1]!)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "And one more thing" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(sent).toEqual([{ type: "prompt", sessionId: "talk", text: "And one more thing" }])
  })

  it("attaches a picture of the screen, says pictures are not redacted, and tells the Host what it is (CH-08)", async () => {
    render(<Quick />)
    fireEvent.click(screen.getByRole("button", { name: "Part of the screen" }))
    expect(posted).toEqual(["capture:region"])
    act(() => listeners.forEach((l) => l({ data: "captured:AQID" })))
    expect(screen.getByRole("img", { name: "The picture to attach" })).toBeTruthy()
    expect(screen.getByText(/Pictures are not redacted/)).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "What is this error?" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(sent.some((c) => c.type === "prompt")).toBe(true))
    expect(attached).toEqual([
      expect.objectContaining({
        session: "chat-9",
        type: "image/png",
        data: "AQID",
        source: "screen-capture",
      }),
    ])
    expect(sent.at(-1)).toEqual({
      type: "prompt",
      sessionId: "chat-9",
      text: "@.codehouse/attachments/ab12cd-screen.png\n\nWhat is this error?",
    })
    // The window may also say nothing was taken (Esc while dragging): the buttons work again.
    fireEvent.click(screen.getByRole("button", { name: "The window you were in" }))
    act(() => listeners.forEach((l) => l({ data: "capture-none" })))
    expect(
      (screen.getByRole("button", { name: "The window you were in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
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
