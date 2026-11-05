// @vitest-environment jsdom
// CH-03 (owner's Chat build, 4 Nov): the "2 of 3" arrows on a chat message, made by Retry and Edit.
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BranchNav, BranchSteps, useBranchSteps } from "../src/components/BranchNav"

const switchBranch = vi.fn(async () => true)
vi.mock("../src/lib/redo", () => ({
  switchBranch: (...a: unknown[]) => switchBranch(...(a as [])),
}))
const api = vi.fn()
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const step = (index: number, siblings: string[]) => ({ id: siblings[index]!, index, siblings })
const show = (steps: Map<string, ReturnType<typeof step>>) =>
  render(
    <BranchSteps.Provider value={{ sessionId: "s1", steps }}>
      <BranchNav itemId="u1" />
    </BranchSteps.Provider>,
  )

describe("the versions of a chat message", () => {
  it("shows which version this is and moves to the one before or after", () => {
    show(new Map([["u1", step(1, ["a", "b", "c"])]]))
    expect(screen.getByRole("group", { name: "Version 2 of 3" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show the version after" }))
    expect(switchBranch).toHaveBeenCalledWith("s1", "c")
  })

  it("cannot go past the first or the last, and shows nothing for a message with one version", () => {
    show(new Map([["u1", step(0, ["a", "b"])]]))
    const before = screen.getByRole("button", {
      name: "Show the version before",
    }) as HTMLButtonElement
    expect(before.disabled).toBe(true)
    cleanup()
    const { container } = show(new Map([["u1", step(0, ["a"])]]))
    expect(container.textContent).toBe("")
  })

  it("matches your messages on screen to the stored branch in order, and gives none when they disagree", async () => {
    api.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        steps: [
          { id: "m1", role: "user", index: 0, siblings: ["m1"] },
          { id: "r1", role: "assistant", index: 0, siblings: ["r1"] },
          { id: "m2", role: "user", index: 1, siblings: ["x", "m2"] },
        ],
      },
    })
    const both = renderHook(() => useBranchSteps("s1", true, "idle", ["u1", "u2"]))
    await waitFor(() => expect(both.result.current.get("u2")?.siblings).toEqual(["x", "m2"]))
    expect(api).toHaveBeenCalledWith("GET", "/api/chat/branch?session=s1")
    const off = renderHook(() => useBranchSteps("s1", true, "idle", ["u1"]))
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2))
    expect(off.result.current.size).toBe(0)
    // A coding session, or a chat still working, asks for nothing.
    renderHook(() => useBranchSteps("s2", false, "idle", ["u1"]))
    renderHook(() => useBranchSteps("s3", true, "running", ["u1"]))
    expect(api).toHaveBeenCalledTimes(2)
  })
})
