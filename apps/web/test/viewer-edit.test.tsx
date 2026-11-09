// @vitest-environment jsdom
// Backlog G33: edit a file in the viewer and save it, over the version you opened only.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The layout calls CodeMirror makes, which jsdom does not have.
const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} }
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let saveReply: { ok: boolean; status: number; data?: unknown; error?: string } = {
  ok: true,
  status: 200,
  data: { saved: true, hash: "h2" },
}
const errors: string[] = []
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn((m: string) => errors.push(m)) }),
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url.startsWith("/api/files/read"))
      return {
        ok: true,
        status: 200,
        data: { kind: "text", text: "const a = 1\n", size: 12, truncated: false, hash: "h1" },
      }
    if (url === "/api/files/save") return saveReply
    return { ok: true, status: 200, data: { base: "/preview/t/" } }
  }),
}))
const { Viewer } = await import("../src/components/FilesPanel")
const { EditorView } = await import("@codemirror/view")

beforeEach(() => {
  calls.length = 0
  errors.length = 0
  saveReply = { ok: true, status: 200, data: { saved: true, hash: "h2" } }
})
afterEach(cleanup)

const typeInto = (text: string) => {
  const content = screen.getByTestId("code-editor").querySelector(".cm-content") as HTMLElement
  const view = EditorView.findFromDOM(content)!
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }))
}

describe("editing a file in the viewer", () => {
  it("saves what you typed, with the version you opened", async () => {
    render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "file", rel: "src/a.ts" }}
        onClose={() => undefined}
        onNavigate={() => undefined}
      />,
    )
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
    const save = screen.getByRole("button", { name: "Save" })
    expect(save).toBeDisabled()
    typeInto("const a = 2\n")
    fireEvent.click(save)
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/files/save")?.body).toEqual({
        session: "s1",
        path: "src/a.ts",
        text: "const a = 2\n",
        hash: "h1",
      }),
    )
    await waitFor(() => expect(screen.queryByTestId("code-editor")).toBeNull())
  })

  it("keeps your text when the file changed outside, and says so", async () => {
    saveReply = { ok: false, status: 409, error: "The file changed outside since you opened it." }
    render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "file", rel: "src/a.ts" }}
        onClose={() => undefined}
        onNavigate={() => undefined}
      />,
    )
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
    typeInto("mine\n")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(errors).toEqual(["The file changed outside since you opened it."]))
    expect(screen.getByTestId("code-editor")).toBeTruthy()
  })

  it("offers no Edit for a file outside the session's folder", async () => {
    render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "file", rel: "C:\\elsewhere\\plan.md" }}
        onClose={() => undefined}
        onNavigate={() => undefined}
      />,
    )
    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/api/files/read"))).toBe(true))
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull()
  })
})
