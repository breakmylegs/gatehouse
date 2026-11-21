// @vitest-environment jsdom
// D-088: the depth of an explanation (short, normal, full) is kept per area; a floor decision is always shown in full.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Explanation } from "../src/components/Explanation"
import { depthFor } from "../src/lib/explain-depth"

const asked = {
  trace: [
    { stage: "Floor", result: "passed" },
    { stage: "Deny rules", result: "none matched" },
    { stage: "Ask rules", result: "matched ask-deploy", rules: ["ask-deploy"] },
    { stage: "Allow rules", result: "none matched" },
  ],
  fixed: false,
  change: "remove ask-deploy",
}
const floor = { trace: [{ stage: "Floor", result: "denied by secrets-files", rules: ["secrets-files"] }, { stage: "Outcome", result: "deny by secrets-files" }], fixed: true }
const stages = () => screen.queryAllByRole("listitem").map((li) => li.textContent)

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("explanation depth", () => {
  it("shows Normal by default, and keeps a chosen depth for its area only", () => {
    render(<Explanation area="approvals" x={asked} />)
    expect(stages()).toEqual(["Floor: passed", "Ask rules: matched ask-deploy"])
    fireEvent.change(screen.getByRole("combobox", { name: "Detail" }), { target: { value: "full" } })
    expect(stages()).toHaveLength(4)
    fireEvent.change(screen.getByRole("combobox", { name: "Detail" }), { target: { value: "short" } })
    expect(stages()).toEqual([])
    expect(screen.getByText(/What would change it: remove ask-deploy/)).toBeTruthy()
    expect(depthFor("approvals")).toBe("short")
    expect(depthFor("policy")).toBe("normal")
    cleanup()
    render(<Explanation area="approvals" x={asked} />)
    expect(stages()).toEqual([])
  })

  it("always shows a floor decision in full, with no depth to choose and no change offered", () => {
    localStorage.setItem("gatehouse.explainDepth", JSON.stringify({ approvals: "short" }))
    render(<Explanation area="approvals" x={floor} />)
    expect(stages()).toEqual(["Floor: denied by secrets-files", "Outcome: deny by secrets-files"])
    expect(screen.queryByRole("combobox", { name: "Detail" })).toBeNull()
    expect(screen.getByText(/^Cannot be changed/)).toBeTruthy()
    expect(screen.queryByText(/What would change it/)).toBeNull()
  })
})
