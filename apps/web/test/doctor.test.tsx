// @vitest-environment jsdom
// B07: the Doctor page shows each check with what it found and what to do, in words as well as marks, and copies a
// report.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Doctor, summary } from "../src/surfaces/Doctor"

let calls = 0
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => {
    calls++
    return {
      ok: true,
      status: 200,
      data: {
        version: "2.1.20",
        at: "2026-11-02T22:00:00Z",
        report: "Codehouse 2.1.20, checked 2026-11-02T22:00:00Z",
        checks: [
          { id: "claude-code", label: "Claude Code", state: "ok", detail: "Claude Code 2.1.310." },
          {
            id: "approver",
            label: "Approver",
            state: "fail",
            detail: "The Approver is down, so every request waits for you.",
            fix: "Approver: Restart.",
          },
          {
            id: "disk",
            label: "Disk space",
            state: "warn",
            detail: "3.0 GB free.",
            fix: "Free some space soon.",
          },
        ],
      },
    }
  }),
}))
afterEach(cleanup)

describe("the Doctor page", () => {
  it("says how many checks need something, and shows each with what to do", async () => {
    render(<Doctor />)
    expect(
      await screen.findByText("1 problem and 1 thing to look at. What to do is under each one."),
    ).toBeTruthy()
    const approver = screen.getByText("Approver").closest("li")!
    expect(approver.textContent).toContain(", a problem")
    expect(within(approver).getByText("Approver: Restart.")).toBeTruthy()
    expect(screen.getByText("Claude Code").closest("li")!.textContent).toContain(", fine")
    expect(screen.getByRole("button", { name: /Copy the report/ })).toBeTruthy()
  })

  it("runs the checks again on request", async () => {
    calls = 0
    render(<Doctor />)
    await screen.findByText(/1 problem/)
    fireEvent.click(screen.getByRole("button", { name: "Run the checks again" }))
    await waitFor(() => expect(calls).toBe(2))
  })

  it("says all is well when it is", () => {
    expect(summary([{ id: "a", label: "A", state: "ok", detail: "" }])).toBe("The check is fine.")
  })
})
