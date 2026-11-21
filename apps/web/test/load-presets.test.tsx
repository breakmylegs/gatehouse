// @vitest-environment jsdom
// D-093: the lighter-load presets: plans in steps, Calm as reduced motion, and the presets kept and put on the page.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ChunkedPlan, planSteps } from "../src/components/ChunkedPlan"
import { applyAppearance, DEFAULT_APPEARANCE, readAppearance, saveAppearance } from "../src/lib/appearance"

afterEach(() => {
  cleanup()
  localStorage.clear()
  saveAppearance(DEFAULT_APPEARANCE)
})

describe("lighter-load presets", () => {
  it("splits a plan into its numbered or bulleted items, or its paragraphs, and shows one at a time", () => {
    expect(planSteps("Intro line\n1. First\n   more of it\n2. Second\n- Third")).toEqual(["Intro line", "1. First\n   more of it", "2. Second", "- Third"])
    expect(planSteps("One idea.\n\nAnother idea.")).toEqual(["One idea.", "Another idea."])
    render(<ChunkedPlan plan={"1. First\n2. Second"} />)
    expect(screen.getByText("Step 1 of 2")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Next step" }))
    expect(screen.getByLabelText("Step 2 of 2").textContent).toBe("2. Second")
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled()
  })

  it("keeps the presets it knows, and puts them on the page, Calm turning movement off", () => {
    localStorage.setItem("gatehouse.appearance", JSON.stringify({ load: ["focus", "nonsense", "calm"] }))
    expect(readAppearance().load).toEqual(["calm", "focus"])
    const root = document.createElement("div")
    applyAppearance({ ...DEFAULT_APPEARANCE, load: ["calm", "fewer"] }, root)
    expect(root.dataset.load).toBe("calm fewer")
    expect(root.dataset.motion).toBe("reduced")
    applyAppearance(DEFAULT_APPEARANCE, root)
    expect(root.dataset.load).toBeUndefined()
    expect(root.dataset.motion).toBeUndefined()
    saveAppearance({ ...DEFAULT_APPEARANCE, load: [] })
    expect(localStorage.getItem("gatehouse.appearance")).toBeNull()
  })
})
