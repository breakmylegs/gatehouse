// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

const all: Array<Record<string, unknown>> = []
/** What was sent as prompts: the context meter's requests are not the point here. */
const sent = {
  get length() {
    return all.filter((c) => c.type === "prompt").length
  },
  at: (i: number) => all.filter((c) => c.type === "prompt").at(i),
}
const attached: Array<Record<string, unknown>> = []
let n = 0

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      all.push(cmd)
      return { ok: true }
    }),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string, body?: Record<string, unknown>) => {
    if (url === "/api/files/attach-data") {
      attached.push(body ?? {})
      return { ok: true, status: 200, data: { rel: `.jcvc/attachments/${++n}-shot.png` } }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
// The transcript list is virtual and draws nothing in jsdom, which has no layout; here it draws every item.
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[]
    itemContent: (i: number, d: unknown) => React.ReactNode
  }) => (
    <div>
      {data.map((d, i) => (
        <div key={i}>{itemContent(i, d)}</div>
      ))}
    </div>
  ),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never
URL.createObjectURL = (() => `blob:picture-${n}`) as typeof URL.createObjectURL
URL.revokeObjectURL = () => undefined

beforeEach(() => {
  all.length = 0
  attached.length = 0
  useStore.setState({
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-10-30T10:00:00Z",
      },
    },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
  })
})
afterEach(cleanup)

const picture = () =>
  new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" })
const prompt = () => screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
function paste(file: File) {
  fireEvent.paste(prompt(), { clipboardData: { files: [file] } })
}

describe("pictures in the prompt box", () => {
  it("shows a pasted picture as a thumbnail, not a path, and sends a reference to it", async () => {
    render(<Workspace />)
    paste(picture())
    const list = await screen.findByRole("list", { name: "Pictures to send" })
    await waitFor(() => expect(within(list).queryByText("Attaching")).toBeNull())
    expect(prompt().value).toBe("")
    expect(attached).toHaveLength(1)
    fireEvent.change(prompt(), { target: { value: "What is wrong here?" } })
    fireEvent.keyDown(prompt(), { key: "Enter" })
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent.at(0)).toEqual({
      type: "prompt",
      sessionId: "s1",
      text: "What is wrong here?\n\n@.jcvc/attachments/1-shot.png",
    })
    // Your message shows the words and the picture, and the box is empty again.
    const item = useStore.getState().transcripts.s1?.items[0]
    expect(item).toMatchObject({
      kind: "user",
      text: "What is wrong here?",
      images: [{ name: "Pasted picture" }],
    })
    expect(screen.queryByRole("list", { name: "Pictures to send" })).toBeNull()
  })

  it("sends a picture on its own, with no words", async () => {
    render(<Workspace />)
    paste(picture())
    const list = await screen.findByRole("list", { name: "Pictures to send" })
    await waitFor(() => expect(within(list).queryByText("Attaching")).toBeNull())
    fireEvent.keyDown(prompt(), { key: "Enter" })
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(String(sent.at(0)?.text)).toMatch(/^@\.jcvc\/attachments\/\d+-shot\.png$/)
  })

  it("leaves out a picture you removed", async () => {
    render(<Workspace />)
    paste(picture())
    fireEvent.click(await screen.findByRole("button", { name: "Remove Pasted picture" }))
    fireEvent.change(prompt(), { target: { value: "never mind" } })
    fireEvent.keyDown(prompt(), { key: "Enter" })
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent.at(0)?.text).toBe("never mind")
  })

  it("shows the pictures of your message, and opens one large", () => {
    useStore.getState().addUserText("s1", "look", [{ url: "blob:x", name: "Pasted picture" }])
    render(<Workspace />)
    fireEvent.click(screen.getByRole("button", { name: "Show Pasted picture" }))
    const dialog = screen.getByRole("dialog", { name: "Pasted picture" })
    expect(within(dialog).getByRole("img")).toBeTruthy()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("the time beside each message", () => {
  it("shows when your message and Claude's reply arrived", () => {
    useStore.getState().addUserText("s1", "hello")
    useStore.getState().handleEvent({
      type: "sdk_message",
      sessionId: "s1",
      message: { type: "assistant", message: { content: [{ type: "text", text: "Hi there" }] } },
    })
    render(<Workspace />)
    const times = document.querySelectorAll("time.msg-time")
    expect(times).toHaveLength(2)
    expect(times[0]?.textContent).toMatch(/^\d\d:\d\d$/)
    expect(times[0]?.getAttribute("aria-label")).toMatch(/\d{4}/)
  })
})
