// @vitest-environment jsdom
// D-089: every pending change shows about how long it takes to review; the meter warns above your capacity.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

let load: unknown
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: true, status: 200, data: load })) }))

import { ReviewLoadMeter, reviewEstimate } from "../src/components/ReviewLoad"

afterEach(cleanup)

describe("the review load", () => {
  it("estimates every change from its lines, files and risk, and nothing for a call that changes no file", () => {
    const fifty = Array.from({ length: 50 }, () => "x").join("\n")
    expect(reviewEstimate("Write", { file_path: "a.ts", content: fifty }, 10)).toBe(11)
    expect(reviewEstimate("Write", { file_path: "a.ts", content: fifty }, 75)).toBe(17)
    expect(reviewEstimate("Write", { file_path: "a.ts", content: fifty }, 90)).toBe(22)
    expect(reviewEstimate("Edit", { file_path: "a.ts", old_string: "a", new_string: "b" }, 0)).toBe(2)
    expect(reviewEstimate("MultiEdit", { file_path: "a.ts", edits: [{ old_string: "a", new_string: fifty }, { old_string: "b", new_string: "c" }] }, 0)).toBe(12)
    expect(reviewEstimate("Bash", { command: "npm test" }, 50)).toBeUndefined()
  })

  it("warns when the last hour's changes need more review than your capacity, and only says so otherwise", async () => {
    load = { lastHour: { minutes: 40, changes: 6 }, capacity: 30, over: true }
    render(<ReviewLoadMeter />)
    expect((await screen.findByRole("alert")).textContent).toMatch(/6 changes in the last hour need about 40 minutes of review, more than the 30 minutes/)
    cleanup()
    load = { lastHour: { minutes: 12, changes: 2 }, capacity: 30, over: false }
    render(<ReviewLoadMeter />)
    expect((await screen.findByRole("status")).textContent).toMatch(/about 12 minutes of review \(your capacity: 30 an hour\)/)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says nothing, and does not break the page, when the Host answers something else (an older Host)", async () => {
    load = { error: "no route" }
    const { container } = render(<ReviewLoadMeter />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toBe("")
  })
})
