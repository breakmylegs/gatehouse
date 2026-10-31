// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { forgetPlan, PlanMeter } from "../src/components/PlanMeter"

const asked: string[] = []
let usage: unknown = null
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) => {
    asked.push(url)
    return url.startsWith("/api/plan-usage")
      ? { ok: true, status: 200, data: { usage } }
      : { ok: false, status: 404, error: "no route" }
  }),
}))

const today = new Date()
const at = (h: number, m: number, days = 0) => {
  const d = new Date(today)
  d.setDate(d.getDate() + days)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

beforeEach(() => {
  asked.length = 0
  forgetPlan()
  usage = {
    plan: "enterprise",
    limits: [
      { label: "5-hour limit", percent: 22, resetsAt: at(14, 20), group: "session" },
      { label: "Weekly, Fable", percent: 0, resetsAt: at(8, 0, 3), group: "weekly" },
    ],
    extra: { used: 109.35, limit: 4000, currency: "USD", percent: 2.73 },
    at: new Date().toISOString(),
  }
})
afterEach(cleanup)

describe("the plan meter beside the prompt box", () => {
  it("shows the 5-hour window and opens to every limit and extra usage", async () => {
    render(<PlanMeter account="main" idle />)
    const meter = await screen.findByRole("button", { name: /Plan usage: 5-hour limit 22% used/ })
    expect(meter.textContent).toContain("22%")
    fireEvent.click(meter)
    const panel = screen.getByRole("group", { name: "Your plan limits" })
    expect(within(panel).getByText("Enterprise")).toBeTruthy()
    expect(within(panel).getByText("5-hour limit")).toBeTruthy()
    expect(within(panel).getByText(/Resets at 14:20/)).toBeTruthy()
    expect(within(panel).getByText("Weekly, Fable")).toBeTruthy()
    expect(within(panel).getByText("$109.35 of $4,000.00")).toBeTruthy()
    expect(asked).toEqual(["/api/plan-usage?account=main"])
    fireEvent.click(within(panel).getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(asked).toHaveLength(2))
    expect(asked[1]).toBe("/api/plan-usage?account=main&fresh=1")
  })

  it("asks once for several panes, and shows nothing where the plan has no limits", async () => {
    render(
      <>
        <PlanMeter account="main" idle />
        <PlanMeter account="main" idle />
      </>,
    )
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Plan usage/ })).toHaveLength(2))
    expect(asked).toHaveLength(1)
    // A pane opened a little later is shown what was just read, without asking again.
    render(<PlanMeter account="main" idle={false} />)
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Plan usage/ })).toHaveLength(3))
    expect(asked).toHaveLength(1)
    cleanup()
    forgetPlan()
    usage = null
    const { container } = render(<PlanMeter account="personal" idle />)
    await waitFor(() => expect(asked).toHaveLength(2))
    expect(container.textContent).toBe("")
  })
})
