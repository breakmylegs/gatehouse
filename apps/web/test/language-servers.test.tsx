// @vitest-environment jsdom
// G34: a language server you name answers under a file of its kind, in the same panel as TypeScript's; a file with no
// server named shows nothing; and Settings keeps each server as one line, name | endings | command.
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const asked: string[] = []
let named = true
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) => {
    asked.push(url)
    if (!named) return { ok: false, status: 404, error: "No language server is named for this kind of file." }
    const op = new URL(url, "http://x").searchParams.get("op")
    return {
      ok: true,
      status: 200,
      data: op === "diagnostics" ? { results: [{ file: "app.py", line: 6, column: 1, text: "", message: "greet is called with a str", severity: "warning" }] } : { result: { text: "def greet(name) -> str" } },
    }
  }),
}))
const { TypeScriptHelp } = await import("../src/components/TypeScriptHelp")
const { lspLine, parseLspLines } = await import("../src/surfaces/Settings")
afterEach(() => {
  cleanup()
  asked.length = 0
  named = true
})

describe("a language server you named, under a file (G34)", () => {
  it("shows its problems and what is at the cursor, asked of the language server route", async () => {
    render(<TypeScriptHelp sessionId="s1" rel="app.py" pos={3} ask={0} onGo={() => undefined} endpoint="/api/files/lsp" label="Language server" />)
    expect(await screen.findByRole("region", { name: "Language server" })).toBeTruthy()
    expect(await screen.findByText("Problems: 0 errors, 1 other")).toBeTruthy()
    expect(await screen.findByText("def greet(name) -> str")).toBeTruthy()
    expect(asked[0]).toMatch(/^\/api\/files\/lsp\?session=s1&path=app\.py&op=diagnostics/)
  })

  it("shows nothing for a file no server is named for", async () => {
    named = false
    const { container } = render(<TypeScriptHelp sessionId="s1" rel="notes.txt" pos={0} ask={0} onGo={() => undefined} endpoint="/api/files/lsp" label="Language server" />)
    await waitFor(() => expect(asked.length).toBeGreaterThan(0))
    await waitFor(() => expect(container.innerHTML).toBe(""))
  })
})

describe("language servers in Settings (G34)", () => {
  it("reads each line as name | endings | command, quoted arguments too, and leaves out a line without all three", () => {
    expect(parseLspLines('Python | py, .pyi | pyright-langserver --stdio\nGo | go | "C:\\Program Files\\Go\\bin\\gopls.exe"\nbroken line\nNo command | rs |')).toEqual([
      { name: "Python", command: "pyright-langserver", args: ["--stdio"], extensions: ["py", "pyi"] },
      { name: "Go", command: "C:\\Program Files\\Go\\bin\\gopls.exe", extensions: ["go"] },
    ])
    const s = { name: "Go", command: "C:\\Program Files\\Go\\bin\\gopls.exe", args: ["serve"], extensions: ["go"] }
    expect(lspLine(s)).toBe('Go | go | "C:\\Program Files\\Go\\bin\\gopls.exe" serve')
    expect(parseLspLines(lspLine(s))).toEqual([s])
  })
})
