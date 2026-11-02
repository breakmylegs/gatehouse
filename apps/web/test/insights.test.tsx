// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Call = { method: string; url: string; body?: unknown }
const calls: Call[] = []
let routes: Record<string, (c: Call) => { ok: boolean; data?: unknown; error?: string }> = {}
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    const c = { method, url, body }
    calls.push(c)
    const key = Object.keys(routes).find((k) => `${method} ${url}`.startsWith(k))
    return key ? { status: 200, ...routes[key]!(c) } : { ok: false, status: 404, error: "no route" }
  }),
}))
// ResponsiveContainer needs a measured box, which jsdom does not have.
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }
})

import { Insights, percent, seconds } from "../src/surfaces/Insights"

const analytics = {
  evaluations: 200,
  byOutcome: { allow: 180, deny: 4, escalate: 16 },
  escalationRate: 0.08,
  judgeAllowed: 2,
  byRule: [
    {
      ruleId: "package-install",
      evaluated: 10,
      escalated: 10,
      approved: 7,
      denied: 2,
      timedOut: 1,
      approvalRate: 7 / 9,
      medianWaitMs: 8000,
    },
    {
      ruleId: "git-remote",
      evaluated: 6,
      escalated: 6,
      approved: 0,
      denied: 6,
      timedOut: 0,
      approvalRate: 0,
      medianWaitMs: 2000,
    },
    { ruleId: "safe-shell", evaluated: 150, escalated: 0, approved: 0, denied: 0, timedOut: 0 },
  ],
  human: { answered: 15, approved: 7, denied: 8, timedOut: 1 },
  byChannel: { desktop: 12, phone: 3 },
  timeToDecideMs: { count: 15, p50: 8000, p90: 40000, max: 90000 },
  perDay: [
    { day: "2026-10-26", allow: 100, deny: 2, escalate: 8 },
    { day: "2026-10-27", allow: 80, deny: 2, escalate: 8 },
  ],
}

beforeEach(() => {
  calls.length = 0
  routes = {}
})
afterEach(cleanup)

describe("formatting", () => {
  it("says times and rates in words", () => {
    expect(seconds(undefined)).toBe("none yet")
    expect(seconds(400)).toBe("under a second")
    expect(seconds(8000)).toBe("8 s")
    expect(seconds(120_000)).toBe("2 min")
    expect(percent(undefined)).toBe("no answers")
    expect(percent(0.777)).toBe("78%")
  })
})

describe("Insights", () => {
  it("summarises in a sentence, tabulates the rules that asked, and leaves out rules that never did", async () => {
    routes["GET /api/analytics"] = () => ({ ok: true, data: analytics })
    routes["GET /api/suggestions"] = () => ({ ok: true, data: [] })
    render(<Insights />)
    expect((await screen.findByRole("status")).textContent).toMatch(
      /200 calls were decided\. 16 \(8%\) asked you\. You took a median of 8 s.*within 40 s\. The judge allowed 2\./,
    )
    const table = screen.getByRole("table", { name: "Requests that asked you, by rule" })
    expect(within(table).getByText("package-install")).toBeInTheDocument()
    expect(within(table).getByText("78%")).toBeInTheDocument()
    expect(within(table).queryByText("safe-shell")).toBeNull()
    expect(screen.getByText("No suggestions yet.")).toBeInTheDocument()
  })

  it("asks for the chosen period", async () => {
    routes["GET /api/analytics"] = () => ({ ok: true, data: analytics })
    routes["GET /api/suggestions"] = () => ({ ok: true, data: [] })
    render(<Insights />)
    await userEvent.selectOptions(await screen.findByLabelText("Period"), "7")
    await waitFor(() => expect(calls.some((c) => c.url === "/api/analytics?days=7")).toBe(true))
  })

  it("shows each suggestion as the exact rule and adds it only on a click", async () => {
    routes["GET /api/analytics"] = () => ({ ok: true, data: analytics })
    routes["GET /api/suggestions"] = () => ({
      ok: true,
      data: [
        {
          candidate: { tool: "Bash", command: "npm install left-pad" },
          preview: "Allow Bash to run exactly: npm install left-pad",
          approvals: 4,
          lastSeen: "2026-10-27T10:00:00Z",
          ruleIds: ["package-install"],
        },
      ],
    })
    routes["POST /api/suggestions/accept"] = () => ({ ok: true, data: { ok: true } })
    render(<Insights />)
    expect(
      await screen.findByText("Allow Bash to run exactly: npm install left-pad"),
    ).toBeInTheDocument()
    expect(screen.getByText(/Approved 4 times/)).toBeInTheDocument()
    expect(calls.some((c) => c.method === "POST")).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Add this rule" }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        candidate: { tool: "Bash", command: "npm install left-pad" },
      }),
    )
  })

  it("says what went wrong when a rule cannot be added", async () => {
    routes["GET /api/analytics"] = () => ({ ok: true, data: analytics })
    routes["GET /api/suggestions"] = () => ({
      ok: true,
      data: [
        {
          candidate: { tool: "Bash", command: "x" },
          preview: "p",
          approvals: 3,
          lastSeen: "2026-10-27T10:00:00Z",
          ruleIds: [],
        },
      ],
    })
    routes["POST /api/suggestions/accept"] = () => ({
      ok: false,
      error: "This is already allowed, so there is nothing to remember.",
    })
    render(<Insights />)
    await userEvent.click(await screen.findByRole("button", { name: "Add this rule" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/already allowed/)
  })

  it("handles an empty log without saying anything untrue", async () => {
    routes["GET /api/analytics"] = () => ({
      ok: true,
      data: {
        ...analytics,
        evaluations: 0,
        byOutcome: { allow: 0, deny: 0, escalate: 0 },
        byRule: [],
        perDay: [],
        judgeAllowed: 0,
      },
    })
    routes["GET /api/suggestions"] = () => ({ ok: true, data: [] })
    render(<Insights />)
    expect((await screen.findByRole("status")).textContent).toBe(
      "Nothing was decided in this period.",
    )
    expect(screen.getByText("No rule asked you in this period.")).toBeInTheDocument()
    expect(screen.getByText("No days to show.")).toBeInTheDocument()
  })
})
