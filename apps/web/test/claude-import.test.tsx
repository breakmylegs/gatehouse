// @vitest-environment jsdom
// CH-04 (owner's Chat build): importing a claude.ai export from Settings, and accepting what came with it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClaudeImport } from "../src/components/ClaudeImport"

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
const pending = {
  projects: [{ id: "p1", name: "Design notes", instructions: "Use UK English." }],
  memories: [{ id: "m1", scope: "global", projectId: null, text: "Prefers metric." }],
}
let answer: { ok: boolean; status: number; data?: unknown; error?: string } = {
  ok: true,
  status: 200,
}
const api = vi.fn(async (method: string, url: string) => {
  if (url === "/api/chat/import/pending") return { ok: true, status: 200, data: pending }
  if (url === "/api/chat/import") return answer
  return { ok: true, status: 200, data: { ok: true } }
})
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...(a as [string, string])) }))
afterEach(() => {
  cleanup()
  api.mockClear()
})

describe("Chats from claude.ai in Settings", () => {
  it("says how to get the export, imports it and says what came in", async () => {
    answer = {
      ok: true,
      status: 200,
      data: {
        ok: true,
        layout: "single",
        counts: { imported: 3, updated: 0, skipped: 1, redacted: 2, projects: 1, memories: 0 },
        skipped: [],
      },
    }
    const told = vi.fn()
    window.addEventListener("codeh:imported", told)
    render(<ClaudeImport />)
    expect(screen.getByText(/choose Export data/)).toBeTruthy()
    expect(screen.getByText(/Allow members to export their own data/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Import an export…" }))
    expect(
      await screen.findByText(/Imported 3, updated 0 and left 1 as they were; 2 private words/),
    ).toBeTruthy()
    expect(told).toHaveBeenCalled()
    window.removeEventListener("codeh:imported", told)
  })

  it("says why nothing was imported, with what the zip holds", async () => {
    answer = {
      ok: false,
      status: 422,
      error: "This does not look like a claude.ai export.",
      data: { files: ["photos/cat.jpg"] },
    }
    render(<ClaudeImport />)
    fireEvent.click(screen.getByRole("button", { name: "Import an export…" }))
    expect(await screen.findByText("This does not look like a claude.ai export.")).toBeTruthy()
    expect(screen.getByText(/photos\/cat.jpg/)).toBeTruthy()
  })

  it("lists instructions and memory to accept or turn down, one at a time", async () => {
    render(<ClaudeImport />)
    expect(await screen.findByText("Use UK English.")).toBeTruthy()
    expect(screen.getByText("Prefers metric.")).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]!)
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("POST", "/api/chat/import/accept", {
        kind: "project",
        id: "p1",
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Turn down" }))
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("POST", "/api/chat/import/dismiss", { id: "m1" }),
    )
  })
})
