// @vitest-environment jsdom
// Backlog G14: Merge back shows the commits and diff first, and merges exactly what was shown.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorktreesPanel } from "../src/components/WorktreesPanel"

const TIP = "a".repeat(40)
let dirty = 0
const calls: Array<{ method: string; url: string; body?: unknown }> = []
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url === "/api/worktrees")
      return {
        ok: true,
        status: 200,
        data: {
          worktrees: [
            {
              path: "C:\\w\\one",
              branch: "codehouse/one",
              repo: "C:\\shop",
              baseName: "HEAD",
              createdAt: "2026-11-08T10:00:00Z",
              exists: true,
              bytes: 1,
              changed: 0,
              commits: 1,
              open: false,
            },
          ],
        },
      }
    if (url.startsWith("/api/worktrees/merge-preview"))
      return {
        ok: true,
        status: 200,
        data: {
          into: "main",
          branch: "codehouse/one",
          tip: TIP,
          commits: [{ hash: "abc1234", subject: "Add the basket" }],
          stat: " basket.ts | 3 +++",
          diff: "+export const basket = []",
          truncated: false,
          uncommitted: 0,
          checkoutDirty: dirty,
        },
      }
    return { ok: true, status: 200, data: { into: "main", commits: 1 } }
  }),
}))

beforeEach(() => {
  calls.length = 0
  dirty = 0
})
afterEach(cleanup)

describe("merging a worktree back from the panel", () => {
  it("shows the commits first and merges exactly what was shown", async () => {
    render(<WorktreesPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "Merge codehouse/one back" }))
    expect(await screen.findByText("Add the basket")).toBeTruthy()
    expect(calls.some((c) => c.url === "/api/worktrees/merge")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Merge into main" }))
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/worktrees/merge")?.body).toEqual({
        path: "C:\\w\\one",
        into: "main",
        tip: TIP,
      }),
    )
  })

  it("will not merge over changes not committed in your checkout", async () => {
    dirty = 2
    render(<WorktreesPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "Merge codehouse/one back" }))
    expect(await screen.findByText(/Your checkout has 2 changes not committed/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Merge into main" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
