// @vitest-environment jsdom
// B24: each memory says how old it is; over 90 days it is flagged, and Still true starts its age again.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { memoryAge } from "../src/lib/memoryAge"
import { MemoryPage } from "../src/surfaces/Memory"

const NOW = Date.parse("2026-11-03T12:00:00Z")
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
const calls: Array<{ method: string; url: string; body?: unknown }> = []
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url === "/api/memory" && method === "GET")
      return {
        ok: true,
        status: 200,
        data: {
          everyone: [
            { id: "m1", topic: "Units", text: "Prefers metric", at: daysAgo(120), by: "claude" },
            { id: "m2", topic: "Name", text: "Peter", at: daysAgo(3), by: "you" },
          ],
          projects: {},
        },
      }
    return { ok: true, status: 200, data: {} }
  }),
}))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("how old a memory is", () => {
  it("is said in words, and flagged past 90 days or when its date cannot be read", () => {
    expect(memoryAge(daysAgo(0), NOW)).toEqual({ words: "today", stale: false })
    expect(memoryAge(daysAgo(1), NOW).words).toBe("yesterday")
    expect(memoryAge(daysAgo(12), NOW).words).toBe("12 days ago")
    expect(memoryAge(daysAgo(90), NOW)).toEqual({ words: "2 months ago", stale: false })
    expect(memoryAge(daysAgo(91), NOW).stale).toBe(true)
    expect(memoryAge(daysAgo(400), NOW).words).toBe("a year ago")
    expect(memoryAge("1970-01-01T00:00:00.000Z", NOW)).toEqual({
      words: "date not known",
      stale: true,
    })
  })

  it("shows on the Memory page, and Still true saves an old one again so its age restarts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
    render(<MemoryPage />)
    expect(await screen.findByText(/Kept by Claude, 3 months ago/)).toBeTruthy()
    expect(screen.getByText(/Added by you, 3 days ago/)).toBeTruthy()
    expect(screen.getAllByRole("note")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Name is still true" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Units is still true" }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        url: "/api/memory/m1",
        body: { topic: "Units", text: "Prefers metric" },
      }),
    )
  })
})
