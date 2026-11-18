// @vitest-environment jsdom
// E-096: safe mode is said across the top with why and what it leaves out; leaving it is the desktop's button, which
// Neighbourhood Watch does not show.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const calls: Array<[string, string, unknown]> = []
vi.mock("../src/lib/api", () => ({ api: vi.fn(async (m: string, p: string, b: unknown) => (calls.push([m, p, b]), { ok: true })) }))

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  calls.length = 0
})

describe("the safe mode banner", () => {
  it("says why and what is left out, and leaves safe mode from the desktop", async () => {
    const { SafeModeBanner } = await import("../src/components/SafeModeBanner")
    render(<SafeModeBanner reason="crash-restarts" />)
    expect(screen.getByRole("alert").textContent).toMatch(/three times in ten minutes.*No session was brought back/)
    fireEvent.click(screen.getByRole("button", { name: "Leave safe mode" }))
    await vi.waitFor(() => expect(calls).toEqual([["POST", "/api/safe-mode", { on: false }]]))
  })

  it("has no way to leave it in Neighbourhood Watch", async () => {
    vi.stubEnv("VITE_CODEHOUSE_REMOTE", "cnw")
    vi.resetModules()
    const { SafeModeBanner } = await import("../src/components/SafeModeBanner")
    render(<SafeModeBanner reason="canary" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
