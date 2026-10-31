// @vitest-environment jsdom
// The Usage page: cost and tokens with filters for dates, project, session and model, charts and tables (owner,
// 31 Oct: its own menu item).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RAIL_PAGES } from "../src/lib/rail"
import { dayOf } from "../src/lib/usage"
import { useStore } from "../src/store"
import { Usage } from "../src/surfaces/Usage"

const asked: string[] = []
const today = dayOf(new Date())
const t = (costUsd: number, outputTokens = 100) => ({
  costUsd,
  inputTokens: 10,
  outputTokens,
  turns: 1,
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) => {
    asked.push(url)
    if (url === "/api/digest")
      return {
        ok: true,
        status: 200,
        data: { text: "In the last 24 hours: 5 calls went through." },
      }
    if (url.startsWith("/api/usage/report?"))
      return {
        ok: true,
        status: 200,
        data: {
          from: url.match(/from=([\d-]+)/)?.[1],
          to: today,
          days: {
            [today]: {
              "019a3b2c-1d00-7abc-8000-000000000001": {
                project: "shop",
                total: t(3, 1500),
                models: { "claude-opus-5-5": t(3, 1500) },
              },
              "019a3b2c-1d00-7abc-8000-000000000002": {
                project: "blog",
                total: t(1),
                models: { "claude-haiku-5-5": t(1) },
              },
            },
          },
          daysWithoutCells: {},
        },
      }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

beforeEach(() => {
  asked.length = 0
  useStore.setState({ sessions: {}, usage: { total: t(47.58) } })
})
afterEach(cleanup)

describe("the Usage page", () => {
  it("has its own menu item", () => {
    expect(RAIL_PAGES.map((p) => p.route)).toContain("usage")
  })

  it("shows what was spent in the range, and the last 24 hours", async () => {
    render(<Usage />)
    const totals = await screen.findByRole("region", { name: "Totals" })
    expect(totals.textContent).toContain("$4.00")
    expect(screen.getByText("In the last 24 hours: 5 calls went through.")).toBeTruthy()
    expect(screen.getByText(/All time: \$47\.58/)).toBeTruthy()
    expect(asked.some((u) => u.startsWith("/api/usage/report?") && u.includes(`to=${today}`))).toBe(
      true,
    )
  })

  it("cuts everything by the filters above it", async () => {
    render(<Usage />)
    await screen.findByRole("region", { name: "Totals" })
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: "shop" },
    })
    expect(screen.getByRole("region", { name: "Totals" }).textContent).toContain("$3.00")
    const byModel = screen.getByRole("region", { name: "By model" })
    expect(within(byModel).queryByText("claude-haiku-5-5")).toBeNull()
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "claude-opus-5-5" },
    })
    expect(screen.getByRole("region", { name: "Totals" }).textContent).toContain(
      "Not kept by model",
    )
    fireEvent.change(screen.getByRole("combobox", { name: "Dates" }), { target: { value: "30" } })
    await waitFor(() =>
      expect(asked.filter((u) => u.startsWith("/api/usage/report?"))).toHaveLength(2),
    )
  })

  it("gives each chart as a table, and a day's figures on focus", async () => {
    render(<Usage />)
    const byDay = await screen.findByRole("region", { name: "Cost by day" })
    const column = within(byDay).getAllByRole("img").at(-1) as Element
    fireEvent.focus(column)
    expect(within(byDay).getByRole("status").textContent).toContain("$4.00")
    const byProject = screen.getByRole("region", { name: "By project" })
    fireEvent.click(within(byProject).getByRole("button", { name: "Show as a table" }))
    const rows = within(within(byProject).getByRole("table")).getAllByRole("row")
    expect(rows.map((r) => r.textContent)).toEqual([
      "NameCostInput tokensOutput tokens",
      "shop$3.00101,500",
      "blog$1.0010100",
    ])
    // And back to the chart.
    fireEvent.click(within(byProject).getByRole("button", { name: "Show the chart" }))
    expect(within(byProject).queryByRole("table")).toBeNull()
  })
})
