// @vitest-environment jsdom
// A large paste becomes a card above the prompt box, as in Claude's desktop app (owner, 4 Nov, screenshot 7f97b6).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isLargePaste, PASTE_CARD_CHARS, PASTE_CARD_LINES, textToBase64 } from "../src/lib/paste"
import { send, useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

const posted: Array<Record<string, unknown>> = []
let refuse = false
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string, body?: Record<string, unknown>) => {
    if (url === "/api/files/attach-data") {
      posted.push(body ?? {})
      if (refuse) return { ok: false, status: 403, error: "That file is blocked by the policy." }
      return {
        ok: true,
        status: 200,
        data: { rel: `.codehouse/attachments/abc123-${String(body?.name)}` },
      }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function V() {
    return <div />
  }),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

beforeEach(() => {
  posted.length = 0
  refuse = false
  vi.mocked(send).mockClear()
  localStorage.clear()
  useStore.setState({
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-11-04T09:00:00Z",
        sdkSessionId: "sdk-1",
      },
    },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
  })
})
afterEach(cleanup)

const paste = (box: Element, text: string) =>
  fireEvent.paste(box, { clipboardData: { files: [], getData: () => text } })
const big = "# How Chat works\n" + "A line of the report that goes on for a while.\n".repeat(60)

describe("a large paste", () => {
  it("counts as large past the character or line limit, and is sent as its UTF-8 bytes", () => {
    expect(isLargePaste("short")).toBe(false)
    expect(isLargePaste("x".repeat(PASTE_CARD_CHARS + 1))).toBe(true)
    expect(isLargePaste("a\n".repeat(PASTE_CARD_LINES))).toBe(true)
    expect(isLargePaste("a\n".repeat(PASTE_CARD_LINES - 2))).toBe(false)
    expect(atob(textToBase64("café"))).toBe("caf\u00c3\u00a9")
  })

  it("shows a PASTED card instead of filling the box, and a small paste goes in the box as usual", () => {
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: /prompt/i }) as HTMLTextAreaElement
    paste(box, big)
    expect(box.value).toBe("")
    const card = screen.getByRole("list", { name: "Pasted text to send" })
    expect(card.textContent).toContain("PASTED")
    expect(card.textContent).toContain("# How Chat works")
    expect(
      screen.getByRole("img", { name: /Pasted text, [\d,]+ characters, \d+ lines/ }),
    ).toBeTruthy()
    paste(box, "hello")
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
  })

  it("is saved as a text file and named to Claude when sent, and the box keeps only what you typed", async () => {
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: /prompt/i }) as HTMLTextAreaElement
    paste(box, big)
    fireEvent.change(box, { target: { value: "Summarise this" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "prompt",
        sessionId: "s1",
        text: "Summarise this\n\n@.codehouse/attachments/abc123-pasted-text.txt",
      }),
    )
    expect(posted[0]).toMatchObject({
      session: "s1",
      kind: "file",
      name: "pasted-text.txt",
      type: "text/plain",
    })
    expect(posted[0]?.data).toBe(textToBase64(big))
    expect(screen.queryByRole("list", { name: "Pasted text to send" })).toBeNull()
  })

  it("can be read and changed with the pencil, or taken out", async () => {
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: /prompt/i }) as HTMLTextAreaElement
    paste(box, big)
    fireEvent.click(screen.getByRole("button", { name: "Read or change the pasted text" }))
    const editor = screen.getByRole("textbox", { name: "The pasted text" }) as HTMLTextAreaElement
    expect(editor.value).toBe(big)
    fireEvent.change(editor, { target: { value: "Just this part" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(screen.getByRole("list", { name: "Pasted text to send" }).textContent).toContain(
      "Just this part",
    )
    fireEvent.click(screen.getByRole("button", { name: "Remove the pasted text" }))
    expect(screen.queryByRole("list", { name: "Pasted text to send" })).toBeNull()
  })

  it("sends nothing when the pasted text cannot be attached, and keeps it", async () => {
    refuse = true
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: /prompt/i }) as HTMLTextAreaElement
    paste(box, big)
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "prompt" }))
    expect(screen.getByRole("list", { name: "Pasted text to send" })).toBeTruthy()
  })
})
