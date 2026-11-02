// @vitest-environment jsdom
// The progress card (owner, 2 Nov): Claude's plan as steps marked done, in progress or not started, with how far it is,
// above the prompt box; a long plan shows the steps around the current one until opened; each plan update in the
// transcript says how far it was.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ProgressCard } from "../src/components/ProgressCard"
import { summarise } from "../src/lib/groups"
import type { Item, Todo } from "../src/lib/transcript"

afterEach(cleanup)

const plan = (statuses: Todo["status"][]): Todo[] =>
  statuses.map((status, i) => ({
    content: `Step ${i + 1}`,
    status,
    ...(status === "in_progress" ? { activeForm: `Doing step ${i + 1}` } : {}),
  }))

describe("the progress card", () => {
  it("says how far the plan is and marks each step done, in progress or not started", () => {
    render(<ProgressCard todos={plan(["completed", "completed", "in_progress", "pending"])} />)
    const card = screen.getByRole("region", { name: "Progress" })
    expect(within(card).getByText("2 of 4 done")).toBeTruthy()
    expect(within(card).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2")
    const steps = within(card)
      .getAllByRole("listitem")
      .map((li) => li.textContent)
    expect(steps).toEqual([
      "Step 1, done",
      "Step 2, done",
      "Doing step 3, in progress",
      "Step 4, not started",
    ])
  })

  it("shows the steps around the current one in a long plan, and all of them when opened", () => {
    render(
      <ProgressCard
        todos={plan([
          "completed",
          "completed",
          "completed",
          "completed",
          "in_progress",
          "pending",
          "pending",
          "pending",
        ])}
      />,
    )
    const card = screen.getByRole("region", { name: "Progress" })
    expect(within(card).getAllByRole("listitem")).toHaveLength(5)
    expect(within(card).getByText(/Doing step 5/)).toBeTruthy()
    fireEvent.click(within(card).getByRole("button", { name: "Show all 8" }))
    expect(within(card).getAllByRole("listitem")).toHaveLength(8)
  })

  it("is not shown before Claude makes a plan", () => {
    const { container } = render(<ProgressCard todos={[]} />)
    expect(container.textContent).toBe("")
  })
})

describe("plan updates in the transcript", () => {
  it("say how far the plan was", () => {
    const update: Extract<Item, { kind: "tool" }> = {
      id: "t1",
      kind: "tool",
      toolUseId: "u1",
      name: "TodoWrite",
      input: { todos: plan(["completed", "in_progress", "pending"]) },
    }
    expect(summarise([update])).toBe("Updated the plan (1 of 3 done)")
  })
})
