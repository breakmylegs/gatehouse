// @vitest-environment jsdom
// Copying (owner, 1 Nov: "I cant easily copy messages, or bits of separate text"): Copy on each message, code block,
// command and output, Copy conversation, Edit on your own messages, and keys for the last reply and code block.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { copyText } from "../src/lib/copy"
import { copyConversation, copyLatest, lastCodeBlock } from "../src/lib/sessionActions"
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
  }) {
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

/** What reached the clipboard, by type. */
let copied: Array<Record<string, string>> = []
class FakeItem {
  constructor(readonly parts: Record<string, Blob>) {}
}
beforeEach(() => {
  copied = []
  vi.stubGlobal("ClipboardItem", FakeItem)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (t: string) => void copied.push({ "text/plain": t })),
      write: vi.fn(async (items: FakeItem[]) => {
        const out: Record<string, string> = {}
        for (const [type, blob] of Object.entries(items[0]!.parts)) out[type] = await blob.text()
        copied.push(out)
      }),
    },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
const REPLY = "Run this:\n\n```powershell\nnpm run gate\n```\n\nThen **push**."

function show() {
  let t = emptyTranscript()
  t = reduceHistory(t, { type: "user", message: { content: "How do I check it?" } })
  t = reduceHistory(t, {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: REPLY },
        { type: "tool_use", id: "tu1", name: "Bash", input: { command: "git status --short" } },
      ],
    },
  })
  t = reduceHistory(t, {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: " M sessions.ts" }] },
  })
  useStore.setState({
    sessions: { s1: session },
    transcripts: { s1: t },
    pending: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
  })
  return render(<Workspace />)
}

describe("copying", () => {
  it("copies Claude's reply as Markdown for a plain editor and formatted for Word, without the code bar", async () => {
    show()
    fireEvent.click(screen.getByRole("button", { name: "Copy Claude's reply" }))
    await waitFor(() => expect(copied).toHaveLength(1))
    expect(copied[0]?.["text/plain"]).toBe(REPLY)
    expect(copied[0]?.["text/html"]).toContain("<strong>push</strong>")
    expect(copied[0]?.["text/html"]).not.toContain("Copy")
    // It says so on the button, and to a screen reader.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy Claude's reply" }).textContent).toContain(
        "Copied",
      ),
    )
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Copied")).toBe(true)
  })

  it("gives each code block its language and a Copy that takes only the code", async () => {
    show()
    expect(screen.getByText("powershell")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Copy the code" }))
    await waitFor(() => expect(copied.at(-1)?.["text/plain"]).toBe("npm run gate\n"))
  })

  it("copies your own message, and Edit opens it in place to change and send again", async () => {
    show()
    fireEvent.click(screen.getByRole("button", { name: "Copy your message" }))
    await waitFor(() => expect(copied.at(-1)?.["text/plain"]).toBe("How do I check it?"))
    fireEvent.click(screen.getByRole("button", { name: /^Edit your message/ }))
    const form = screen.getByRole("form", { name: "Edit your message" })
    const box = form.querySelector("textarea") as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe("How do I check it?"))
  })

  it("copies a command and what it printed", async () => {
    const { container } = show()
    fireEvent.click(container.querySelector(".tool-group-line") as HTMLElement)
    fireEvent.click(screen.getByRole("button", { name: "Copy the command" }))
    await waitFor(() => expect(copied.at(-1)?.["text/plain"]).toBe("git status --short"))
    fireEvent.click(screen.getByRole("button", { name: "Copy the output" }))
    await waitFor(() => expect(copied.at(-1)?.["text/plain"]).toBe(" M sessions.ts"))
  })

  it("copies the whole conversation as Markdown", async () => {
    show()
    await copyConversation(session)
    expect(copied.at(-1)?.["text/plain"]).toContain("How do I check it?")
    expect(copied.at(-1)?.["text/plain"]).toContain("npm run gate")
  })

  it("copies the last reply and the last code block from the keys' actions", async () => {
    show()
    await copyLatest("reply")
    expect(copied.at(-1)?.["text/plain"]).toBe(REPLY)
    await copyLatest("code")
    expect(copied.at(-1)?.["text/plain"]).toBe("npm run gate")
  })

  it("finds the last fenced block, newest message first", () => {
    expect(lastCodeBlock(["```js\na()\n```", "no code here"])).toBe("a()")
    expect(lastCodeBlock(["```\nold\n```", "~~~\nfirst\n~~~\n\n```py\nnew\n```"])).toBe("new")
    expect(lastCodeBlock(["plain words"])).toBeUndefined()
  })

  it("still copies when the window's clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("not focused"))) },
    })
    const exec = vi.fn(() => true)
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec })
    expect(await copyText("hello")).toBe(true)
    expect(exec).toHaveBeenCalledWith("copy")
  })
})
