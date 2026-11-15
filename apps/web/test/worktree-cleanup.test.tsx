// @vitest-environment jsdom
// T-089 (t3code review): clean up worktrees by the rules chosen, now or by themselves; saving keeps every other
// setting as it was.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url === "/api/settings" && method === "GET") return { ok: true, status: 200, data: { saved: { expectedOrg: "acme", keepAwake: false } } }
    if (url === "/api/worktrees/cleanup") return { ok: true, status: 200, data: { removed: [{ path: "a", branch: "fix/a", why: "it has no commits of its own" }], kept: [] } }
    return { ok: true, status: 200, data: {} }
  }),
}))
const { WorktreeCleanup } = await import("../src/components/WorktreeCleanup")

afterEach(cleanup)

describe("clean up worktrees (T-089)", () => {
  it("runs the chosen rules now and says what went, and keeps them in Settings without touching the rest", async () => {
    render(<WorktreeCleanup onDone={() => undefined} />)
    expect((screen.getByRole("button", { name: "Clean up now" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText("Unchanged: no commits of its own"))
    fireEvent.click(screen.getByRole("button", { name: "Clean up now" }))
    expect(await screen.findByText(/removed, because it has no commits of its own/)).toBeTruthy()
    expect(calls.find((c) => c.url === "/api/worktrees/cleanup")?.body).toEqual({ unchanged: true })
    fireEvent.click(screen.getByLabelText("Run these by themselves every six hours"))
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true))
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ expectedOrg: "acme", keepAwake: false, worktreeCleanup: { unchanged: true } })
  })
})
