// @vitest-environment jsdom
// Mac fork (owner, 12 Nov): the phone's Liquid Glass tab bar says which screen you are on, how many requests wait on
// you, and takes you to the others.
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TabBar } from "../src/TabBar"

afterEach(cleanup)

describe("the tab bar", () => {
  it("marks the screen you are on, counts what waits on you, and goes where you tap", async () => {
    const go = vi.fn()
    render(<TabBar active="sessions" waiting={3} go={go} />)
    const nav = screen.getByRole("navigation", { name: "Codehouse" })
    expect(nav.style.getPropertyValue("--tab")).toBe("1")
    expect(screen.getByRole("button", { name: "Sessions" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "Settings" })).not.toHaveAttribute("aria-current")
    await userEvent.click(screen.getByRole("button", { name: "Waiting, 3" }))
    expect(go).toHaveBeenCalledWith("home")
  })

  it("shows no count when nothing waits, and caps a large one", () => {
    const { rerender } = render(<TabBar active="home" waiting={0} go={() => undefined} />)
    expect(screen.getByRole("button", { name: "Waiting" })).toHaveAttribute("aria-current", "page")
    rerender(<TabBar active="home" waiting={140} go={() => undefined} />)
    expect(screen.getByRole("button", { name: "Waiting, 140" }).textContent).toContain("99+")
  })
})
