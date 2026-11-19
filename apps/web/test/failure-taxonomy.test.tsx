// @vitest-environment jsdom
// D-072: Insights says what went wrong in words with every number, and by project and by model.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FailureTaxonomy } from "../src/components/FailureTaxonomy"

const zero = { loop: 0, "tool-error": 0, "failing-test": 0, undo: 0, "contradicted-claim": 0, denial: 0 }
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({
    ok: true,
    status: 200,
    data: {
      total: 3,
      byKind: { ...zero, "failing-test": 2, denial: 1 },
      byProject: [{ project: "billing", total: 3, byKind: { ...zero, "failing-test": 2, denial: 1 } }],
      byModel: [{ model: "claude-opus-5-5", total: 3, byKind: { ...zero, "failing-test": 2, denial: 1 } }],
    },
  })),
}))
afterEach(cleanup)

describe("What went wrong, on Insights (D-072)", () => {
  it("says each kind in words with its number, and shows them by project and by model", async () => {
    render(<FailureTaxonomy days={30} />)
    expect(await screen.findByText("What went wrong")).toBeTruthy()
    expect(screen.getByText(/tests failed/).textContent).toBe("2 tests failed")
    expect(screen.getByRole("table", { name: "By project" }).textContent).toContain("billing")
    expect(screen.getByRole("table", { name: "By model" }).textContent).toContain("claude-opus-5-5")
  })
})
