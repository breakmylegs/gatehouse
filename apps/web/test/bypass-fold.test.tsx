// @vitest-environment jsdom
// Owner, 20 Nov: once a bypass is in place its warning bar folds to one line, kept for that bypass; a new bypass shows
// in full again, and ending it is there either way.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { BypassLine } from "../src/surfaces/Workspace"

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const session = (since: string) =>
  ({ id: "s1", bypass: { since, maxUsd: 100, spentUsd: 0 } }) as unknown as Parameters<typeof BypassLine>[0]["session"]

describe("the bypass bar folds (owner, 20 Nov)", () => {
  it("folds to one line with what matters, stays folded for that bypass, and unfolds again", () => {
    const { unmount } = render(<BypassLine session={session("2026-11-20T16:00:00Z")} />)
    expect(screen.getByRole("status").textContent).toMatch(/whichever comes first/)
    fireEvent.click(screen.getByRole("button", { name: "Fold it away" }))
    expect(screen.getByRole("status").textContent).toBe("Limits bypassed: $0.00 of $100.00ShowEnd the bypass")
    expect(screen.getByRole("button", { name: "End the bypass" })).toBeTruthy()
    unmount()
    // Back again (a new pane, a reload): still folded for the same bypass.
    render(<BypassLine session={session("2026-11-20T16:00:00Z")} />)
    expect(screen.getByRole("button", { name: "Show" }).getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(screen.getByRole("button", { name: "Show" }))
    expect(screen.getByRole("status").textContent).toMatch(/whichever comes first/)
  })

  it("shows a new bypass in full, whatever was folded before", () => {
    const first = render(<BypassLine session={session("2026-11-20T16:00:00Z")} />)
    fireEvent.click(screen.getByRole("button", { name: "Fold it away" }))
    first.unmount()
    render(<BypassLine session={session("2026-11-20T17:30:00Z")} />)
    expect(screen.getByRole("status").textContent).toMatch(/whichever comes first/)
  })
})
