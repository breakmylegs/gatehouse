// @vitest-environment jsdom
// Owner, 3 Nov: a file Claude made opens in the right-hand pane, where its text can be copied or a copy saved.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Viewer } from "../src/components/FilesPanel"
import { relInside } from "../src/lib/attachments"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url.startsWith("/api/files/read"))
      return {
        ok: true,
        status: 200,
        data: { kind: "text", text: "# Brief\n", size: 8, truncated: false },
      }
    if (url === "/api/files/preview")
      return { ok: true, status: 200, data: { base: "/preview/t/" } }
    if (url === "/api/files/save-copy")
      return { ok: true, status: 200, data: { saved: "D:\\brief.md" } }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function V() {
    return <div />
  }),
}))

beforeEach(() => {
  calls.length = 0
})
afterEach(cleanup)

describe("a file Claude made", () => {
  it("is found inside the session's folder, by its path in any case, and not outside it", () => {
    expect(relInside("C:\\dev\\Proscenia", "C:\\dev\\Proscenia\\docs\\brief.md")).toBe(
      "docs/brief.md",
    )
    expect(relInside("C:\\dev\\Proscenia", "c:/DEV/proscenia/docs/brief.md")).toBe("docs/brief.md")
    expect(relInside("C:\\dev\\Proscenia", "C:\\dev\\Other\\brief.md")).toBeUndefined()
    expect(relInside("C:\\dev\\Proscenia", "C:\\dev\\Proscenia\\..\\Other\\a.md")).toBeUndefined()
    expect(relInside("C:\\dev\\Proscenia", "docs/brief.md")).toBe("docs/brief.md")
  })

  it("opens beside the chat with Copy and Save a copy", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
    render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "file", rel: "docs/brief.md" }}
        onClose={() => undefined}
        onNavigate={() => undefined}
      />,
    )
    fireEvent.click(await screen.findByRole("button", { name: /^Copy/ }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("# Brief\n"))
    fireEvent.click(screen.getByRole("button", { name: "Save a copy…" }))
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        method: "POST",
        url: "/api/files/save-copy",
        body: { session: "s1", path: "docs/brief.md" },
      }),
    )
  })
})
