// @vitest-environment jsdom
// Drag and drop any file into the prompt box (owner, 1 Nov: "it only allows me to add files via the + button").
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { send, useStore } from "../src/store"
import { ItemView, Workspace } from "../src/surfaces/Workspace"

const posted: Array<Record<string, unknown>> = []
const toasts: string[] = []
vi.mock("sonner", () => ({
  toast: Object.assign((t: string) => toasts.push(t), { error: (t: string) => toasts.push(t) }),
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
      if (body?.name === ".env")
        return {
          ok: false,
          status: 403,
          error: "That file is blocked by the policy and was not attached.",
        }
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
URL.createObjectURL ??= () => "blob:x"

beforeEach(() => {
  posted.length = 0
  toasts.length = 0
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
        createdAt: "2026-11-01T09:00:00Z",
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

const drop = (target: Element, files: File[]) =>
  fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } })

describe("dropping files on the prompt box", () => {
  it("attaches any file by its name as an icon, not as its path in the text, and names it to Claude when sent", async () => {
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: /prompt|message/i }) as HTMLTextAreaElement
    drop(box, [new File(["hello"], "notes.txt", { type: "text/plain" })])
    expect(await screen.findByRole("img", { name: "File notes.txt" })).toBeTruthy()
    expect(box.value).toBe("")
    expect(posted[0]).toMatchObject({ session: "s1", kind: "file", name: "notes.txt" })
    expect(posted[0]?.data).toBe(btoa("hello"))
    fireEvent.change(box, { target: { value: "Read this" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "prompt",
        sessionId: "s1",
        text: "Read this\n\n@.codehouse/attachments/abc123-notes.txt",
      }),
    )
  })

  it("shows the files in what you sent as icons, and your words without their paths, live or read back", () => {
    render(
      <ItemView
        item={{
          id: "u1",
          kind: "user",
          text: "Read this\n\n@.codehouse/attachments/abc123-notes.txt",
        }}
      />,
    )
    const sent = screen.getByRole("group", { name: "Files you sent" })
    expect(within(sent).getByRole("img", { name: "File notes.txt" })).toBeTruthy()
    expect(screen.getByText("Read this")).toBeTruthy()
    expect(screen.queryByText(/@\.codehouse/)).toBeNull()
  })

  it("says why a file was refused, and attaches nothing for it", async () => {
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: /prompt|message/i }) as HTMLTextAreaElement
    drop(box, [new File(["SECRET=1"], ".env", { type: "" })])
    await waitFor(() => expect(toasts.at(-1)).toContain(".env: That file is blocked"))
    expect(box.value).not.toContain("@")
  })

  it("still takes a dropped picture as a thumbnail, not a mention", async () => {
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: /prompt|message/i }) as HTMLTextAreaElement
    drop(box, [new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" })])
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ type: "image/png" })
    expect(posted[0]).not.toHaveProperty("kind")
    expect(box.value).not.toContain("@")
    expect(await screen.findByRole("button", { name: "Show shot.png" })).toBeTruthy()
  })
})
