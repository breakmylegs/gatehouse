// @vitest-environment jsdom
// G37: the Debug panel in a session: the adapters named in Settings, a start with the program, its arguments and
// breakpoints, the stack and variables at a stop, and the step buttons only when they can act; Settings keeps each
// adapter as one line, name | kind | command.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let named = true
let running: unknown = null
const stopped = {
  adapter: "Python",
  program: "app.py",
  state: "stopped",
  reason: "breakpoint",
  frames: [{ name: "<module>", file: "app.py", line: 3 }, { name: "runner", line: 40 }],
  variables: [{ name: "y", value: "2", type: "int" }, { name: "token", value: "[redacted]" }],
  breakpoints: { "app.py": [3] },
  output: "",
}
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (method === "GET") return { ok: true, status: 200, data: { adapters: named ? [{ name: "Python", kind: "python" }] : [], state: running } }
    if (url.endsWith("/stop")) return { ok: true, status: 200, data: { state: null } }
    return { ok: true, status: 200, data: { state: url.endsWith("/continue") ? { ...stopped, state: "ended", reason: "the program exited with 0", frames: undefined, variables: undefined } : stopped } }
  }),
}))
const { DebugPanel, parseBreakpoints } = await import("../src/components/DebugPanel")
const { parseDapLines } = await import("../src/surfaces/Settings")
afterEach(() => {
  cleanup()
  calls.length = 0
  named = true
  running = null
})

describe("the Debug panel (G37)", () => {
  it("starts a program with its arguments and breakpoints, shows the stop, and steps only when stopped", async () => {
    const onOpen = vi.fn()
    render(<DebugPanel sessionId="s1" onClose={() => undefined} onOpen={onOpen} />)
    fireEvent.change(await screen.findByLabelText(/Program, from the folder/), { target: { value: "app.py" } })
    fireEvent.change(screen.getByLabelText("Arguments"), { target: { value: "--fast  data.csv" } })
    fireEvent.change(screen.getByLabelText(/Breakpoints/), { target: { value: "app.py:3\nlib/util.py:12\nnot a breakpoint" } })
    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    await waitFor(() => expect(calls.at(-1)).toEqual({ method: "POST", url: "/api/debug/start", body: { session: "s1", adapter: "Python", program: "app.py", args: ["--fast", "data.csv"], breakpoints: { "app.py": [3], "lib/util.py": [12] } } }))
    const where = await screen.findByRole("region", { name: "Where the program is" })
    expect(within(where).getByText("Stopped")).toBeTruthy()
    expect(within(where).getByText("[redacted]")).toBeTruthy()
    expect(within(where).getByText("outside the folder, line 40")).toBeTruthy()
    fireEvent.click(within(where).getByRole("button", { name: /<module>/ }))
    expect(onOpen).toHaveBeenCalledWith("app.py", 3)
    expect((screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Step over" }))
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ url: "/api/debug/next", body: { session: "s1" } }))
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(await screen.findByText("Ended")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Step over" })).toBeNull()
  })

  it("does not step a program that is running, and pauses it", async () => {
    running = { ...stopped, state: "running", reason: undefined, frames: undefined, variables: undefined }
    render(<DebugPanel sessionId="s1" onClose={() => undefined} />)
    expect(await screen.findByText("Running")).toBeTruthy()
    for (const name of ["Continue", "Step over", "Step into", "Step out"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled, name).toBe(true)
    expect((screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("says to name an adapter when none is named", async () => {
    named = false
    render(<DebugPanel sessionId="s1" onClose={() => undefined} />)
    expect(await screen.findByText(/No debug adapter is named/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull()
  })

  it("reads breakpoints and Settings lines, leaving out what does not fit", () => {
    expect(parseBreakpoints("a.py:1\n a.py:7 \nb\\c.cs:20\nx")).toEqual({ "a.py": [1, 7], "b\\c.cs": [20] })
    expect(parseDapLines("Python | python | python -m debugpy.adapter\n.NET | dotnet | netcoredbg --interpreter=vscode\nBad | ruby | rdbg\nHalf | node |")).toEqual([
      { name: "Python", kind: "python", command: "python", args: ["-m", "debugpy.adapter"] },
      { name: ".NET", kind: "dotnet", command: "netcoredbg", args: ["--interpreter=vscode"] },
    ])
  })
})
