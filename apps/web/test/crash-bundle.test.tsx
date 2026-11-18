// @vitest-environment jsdom
// E-097: the crash bundle is shown file by file before it is saved, and saving sends the previewed bundle's id, so
// what is saved is what was shown.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const calls: Array<[string, string, unknown]> = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (m: string, p: string, b: unknown) => {
    calls.push([m, p, b])
    if (p === "/api/crash-bundle/preview") return { ok: true, data: { id: "b1", files: { "host.log": "started\n[REDACTED:anthropic-key]", "version.json": "{}" } } }
    return { ok: true, data: { file: "C:\\Users\\me\\Downloads\\codehouse-crash-bundle.zip" } }
  }),
}))

afterEach(() => {
  cleanup()
  calls.length = 0
})

describe("the crash bundle in Doctor", () => {
  it("shows each file first, then saves the very bundle shown", async () => {
    const { CrashBundle } = await import("../src/components/CrashBundle")
    render(<CrashBundle />)
    fireEvent.click(screen.getByRole("button", { name: "Make a crash bundle" }))
    expect(await screen.findByText(/host\.log/)).toBeInTheDocument()
    expect(screen.getByText(/\[REDACTED:anthropic-key\]/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Save to Downloads" }))
    await vi.waitFor(() => expect(calls.at(-1)).toEqual(["POST", "/api/crash-bundle", { id: "b1" }]))
  })
})
