// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { changedFiles, FilesPanel, relativeTo, Viewer } from "../src/components/FilesPanel"
import type { Item } from "../src/lib/transcript"

const calls: Array<{ method: string; url: string }> = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string) => {
    calls.push({ method, url })
    if (
      url.startsWith("/api/files/list") &&
      url.includes("dir=&") === false &&
      url.endsWith("dir=")
    )
      return {
        ok: true,
        status: 200,
        data: {
          entries: [
            { name: "src", rel: "src", kind: "dir", size: 0, mtime: "" },
            { name: "README.md", rel: "README.md", kind: "file", size: 20, mtime: "" },
          ],
          more: 0,
        },
      }
    if (url.startsWith("/api/files/list"))
      return {
        ok: true,
        status: 200,
        data: {
          entries: [{ name: "a.ts", rel: "src/a.ts", kind: "file", size: 9, mtime: "" }],
          more: 0,
        },
      }
    if (url === "/api/files/preview")
      return { ok: true, status: 200, data: { base: "/preview/tok/" } }
    if (url.includes("path=README.md"))
      return {
        ok: true,
        status: 200,
        data: { kind: "text", text: "# Hello\n\nWorld", size: 14, truncated: false },
      }
    if (url.includes("path=.env"))
      return {
        ok: true,
        status: 200,
        data: { kind: "blocked", reason: "Secrets files are blocked by policy.", size: 9 },
      }
    if (url.includes("path=src%2Fa.ts"))
      return {
        ok: true,
        status: 200,
        data: { kind: "text", text: "line one\nline two", size: 17, truncated: false },
      }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

beforeEach(() => {
  calls.length = 0
})
afterEach(cleanup)

const tool = (id: string, name: string, file_path: string): Item => ({
  id,
  kind: "tool",
  toolUseId: id,
  name,
  input: { file_path },
})

describe("files a session made or changed", () => {
  it("lists edits inside the folder once each, newest last, and leaves outside files out", () => {
    const items = [
      tool("1", "Write", "C:\\dev\\JCTest\\JCApp\\index.html"),
      tool("2", "Edit", "C:/dev/JCTest/src/a.ts"),
      tool("3", "Read", "C:/dev/JCTest/README.md"),
      tool("4", "Edit", "C:/dev/JCTest/JCApp/index.html"),
      tool("5", "Write", "C:/Users/me/elsewhere.txt"),
    ]
    expect(changedFiles(items, "C:\\dev\\JCTest")).toEqual([
      { rel: "src/a.ts", tool: "Edit" },
      { rel: "JCApp/index.html", tool: "Edit" },
    ])
    expect(relativeTo("C:/dev/JCTest", "c:/DEV/jctest/x.md")).toBe("x.md")
    expect(relativeTo("C:/dev/JCTest", "C:/dev/JCTestOther/x.md")).toBeUndefined()
  })

  it("shows the folder and opens a file from it", async () => {
    const onOpen = vi.fn()
    render(<FilesPanel sessionId="s1" cwd="C:/dev/JCTest" items={[]} onOpen={onOpen} />)
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }))
    expect(onOpen).toHaveBeenCalledWith({ kind: "file", rel: "README.md" })
    fireEvent.click(screen.getByRole("button", { name: "src" }))
    expect(await screen.findByRole("button", { name: /a\.ts/ })).toBeTruthy()
  })
})

describe("the viewer", () => {
  it("renders markdown, shows code with line numbers, and never shows a blocked file", async () => {
    const { unmount } = render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "file", rel: "README.md" }}
        onClose={() => undefined}
        onNavigate={() => undefined}
      />,
    )
    expect(await screen.findByRole("heading", { name: "Hello" })).toBeTruthy()
    unmount()
    render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "file", rel: "src/a.ts" }}
        onClose={() => undefined}
        onNavigate={() => undefined}
      />,
    )
    expect(await screen.findByText(/line two/)).toBeTruthy()
    cleanup()
    render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "file", rel: ".env" }}
        onClose={() => undefined}
        onNavigate={() => undefined}
      />,
    )
    expect(await screen.findByText(/Secrets files are blocked/)).toBeTruthy()
  })

  it("previews a page in a sandboxed frame from the preview address", async () => {
    render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "file", rel: "src/a.ts" }}
        onClose={() => undefined}
        onNavigate={() => undefined}
      />,
    )
    await waitFor(() => expect(calls.some((c) => c.url === "/api/files/preview")).toBe(true))
    cleanup()
    render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "file", rel: "site/index.html" }}
        onClose={() => undefined}
        onNavigate={() => undefined}
      />,
    )
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("path=site%2Findex.html"))).toBe(true),
    )
  })

  it("only opens pages on this computer in the browser", async () => {
    const onNavigate = vi.fn()
    render(
      <Viewer
        sessionId="s1"
        opened={{ kind: "browser", url: "http://localhost:5173/" }}
        onClose={() => undefined}
        onNavigate={onNavigate}
      />,
    )
    const frame = screen.getByTitle("Local page") as HTMLIFrameElement
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts")
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "https://example.com/" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Go" }))
    expect(screen.getByRole("alert").textContent).toMatch(/Only pages on this computer/)
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "http://127.0.0.1:3000/app" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Go" }))
    expect(onNavigate).toHaveBeenCalledWith({ kind: "browser", url: "http://127.0.0.1:3000/app" })
  })
})
