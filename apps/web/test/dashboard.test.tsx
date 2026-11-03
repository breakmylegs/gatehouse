// @vitest-environment jsdom
// The Dashboard at the top of the sidebar: what needs you, what is not right, each session, today and lately (owner,
// 31 Oct).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
vi.mock("../src/lib/connection", () => ({
  takeToken: () => "token",
  Connection: class {
    start() {}
    send(cmd: Record<string, unknown>) {
      sent.push(cmd)
      return Promise.resolve({ ok: true })
    }
  },
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) =>
    url === "/api/digest"
      ? {
          ok: true,
          status: 200,
          data: { text: "In the last 24 hours: 12 calls went through.", askedYou: 3 },
        }
      : { ok: false, status: 404, error: "no route" },
  ),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const { startConnection, useStore } = await import("../src/store")
const { Dashboard } = await import("../src/surfaces/Dashboard")
const { Rail } = await import("../src/components/Rail")
const { dayOf } = await import("../src/lib/usage")
startConnection()

const health = {
  approver: { state: "up" as const, errors: [] },
  relay: { state: "not-configured" as const, devices: 0 },
  push: [{ channel: "ntfy" as const, ok: true }],
  signin: { signedIn: true, managedPolicy: "detected" as const, orgOk: true, checked: true },
  killSwitch: { engaged: false, approverConfirmed: true },
  pwsh: { running: true },
}
const session = (
  id: string,
  project: string,
  state: "running" | "idle" | "ended",
  extra: Record<string, unknown> = {},
) => ({
  id,
  cwd: `C:\\dev\\${project}`,
  project,
  mode: "default" as const,
  state,
  pendingApprovals: 0,
  createdAt: `2026-10-31T09:0${id.slice(-1)}:00Z`,
  ...extra,
})
const t = (costUsd: number) => ({
  costUsd,
  inputTokens: 10,
  outputTokens: 2500,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  turns: 1,
})

beforeEach(() => {
  sent.length = 0
  useStore.setState({
    conn: "open",
    health,
    pending: {},
    notices: [],
    sessions: {
      s1: session("s1", "shop", "running"),
      s2: session("s2", "blog", "idle", { background: ["Sweep billing"] }),
      s3: session("s3", "old", "ended"),
    },
    usage: {
      total: t(9),
      byDay: { [dayOf(new Date())]: t(4.5) },
      bySession: { s1: t(4) },
    },
    route: "dashboard",
  })
})
afterEach(cleanup)

describe("the Dashboard", () => {
  it("is the first link in the sidebar", () => {
    render(<Rail onHide={() => undefined} />)
    const links = screen.getAllByRole("button").map((b) => b.textContent ?? "")
    const dash = links.findIndex((l) => l.includes("Dashboard"))
    expect(dash).toBeGreaterThan(-1)
    expect(dash).toBeLessThan(links.findIndex((l) => l.includes("New session")))
    useStore.setState({ route: "approvals" })
    fireEvent.click(screen.getByRole("button", { name: /^.?\s*Dashboard$/ }))
    expect(useStore.getState().route).toBe("dashboard")
  })

  it("lists the open sessions and what each is doing, and opens one", () => {
    render(<Dashboard />)
    const sessions = screen.getByRole("region", { name: "Sessions" })
    expect(within(sessions).queryByText("old")).toBeNull()
    expect(within(sessions).getByText("1 working in the background")).toBeTruthy()
    expect(within(sessions).getByText("$4.00")).toBeTruthy()
    fireEvent.click(within(sessions).getAllByRole("button", { name: "Open" })[0] as HTMLElement)
    expect(useStore.getState().route).toBe("workspace")
  })

  it("shows the oldest request as a full card, and its risk on the session's tile", () => {
    const request = (id: string, risk: number, createdAt: string) => ({
      request: {
        id,
        nonce: "n",
        kind: "permission" as const,
        sessionId: "s1",
        toolUseId: `t-${id}`,
        toolName: "Bash",
        input: { command: "git push" },
        cwd: "C:\\dev\\shop",
        project: "shop",
        verdict: {
          outcome: "escalate" as const,
          ruleId: "git-push",
          reason: "Pushing shares your work.",
          risk,
          decidedBy: "rules" as const,
          policyHash: "h",
        },
        createdAt,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        payloadHash: "p",
      },
      rawInput: { command: "git push" },
      defaultToNo: risk >= 70,
      phone: "none" as const,
      hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
    })
    useStore.setState({
      pending: {
        r1: request("r1", 78, "2026-11-01T09:00:00Z"),
        r2: request("r2", 40, "2026-11-01T09:05:00Z"),
      },
    })
    render(<Dashboard />)
    const needs = screen.getByRole("region", { name: "Needs you" })
    // One full card, with every action and the deliberate Allow; the other on one line.
    expect(within(needs).getAllByRole("article")).toHaveLength(1)
    expect(within(needs).getByRole("button", { name: "Edit then allow…" })).toBeTruthy()
    expect(within(needs).getByText(/Deny is the safe choice/)).toBeTruthy()
    const tiles = screen.getByRole("region", { name: "Sessions" })
    expect(within(tiles).getByText(/High risk 78/)).toBeTruthy()
  })

  it("is the agents board: what waits first, with its model, how long it has waited, and Decide (B08)", () => {
    const createdAt = new Date(Date.now() - 3 * 60_000).toISOString()
    useStore.setState({
      sessions: {
        s1: session("s1", "shop", "running", { model: "claude-sonnet-5-5" }),
        // Older than s1, so only waiting puts it first.
        s2: {
          ...session("s2", "blog", "idle"),
          state: "waiting",
          model: "claude-opus-5-5",
          createdAt: "2026-10-31T08:00:00Z",
        },
      },
      pending: {
        r9: {
          request: {
            id: "r9",
            nonce: "n",
            kind: "permission",
            sessionId: "s2",
            toolUseId: "t9",
            toolName: "Bash",
            input: { command: "git push" },
            cwd: "C:\\dev\\blog",
            project: "blog",
            verdict: {
              outcome: "escalate",
              ruleId: "git-push",
              reason: "Pushing shares your work.",
              risk: 40,
              decidedBy: "rules",
              policyHash: "h",
            },
            createdAt,
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            payloadHash: "p",
          },
          rawInput: { command: "git push" },
          defaultToNo: false,
          phone: "none",
          hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
        },
      } as never,
    })
    render(<Dashboard />)
    const tiles = within(screen.getByRole("region", { name: "Sessions" })).getAllByRole("listitem")
    expect(tiles[0]!.textContent).toContain("blog")
    expect(tiles[0]!.textContent).toContain("Opus 5.5")
    expect(tiles[0]!.textContent).toMatch(/Waiting for you for 3/)
    expect(tiles[1]!.textContent).toContain("Sonnet 5.5")
    fireEvent.click(within(tiles[0]!).getByRole("button", { name: /^Decide what blog asks/ }))
    expect(useStore.getState()).toMatchObject({ route: "approvals", selectedRequest: "r9" })
  })

  it("shows today's numbers, with the way to Usage", async () => {
    render(<Dashboard />)
    const today = screen.getByRole("region", { name: "Today" })
    expect(today.textContent).toContain("$4.50")
    expect(today.textContent).toContain("Sessions working2")
    expect(await within(today).findByText("3")).toBeTruthy()
    fireEvent.click(within(today).getByRole("button", { name: "Usage" }))
    expect(useStore.getState().route).toBe("usage")
  })

  it("says what is not right, with the place to put it right, and only then", () => {
    const { unmount } = render(<Dashboard />)
    expect(screen.queryByRole("region", { name: "Alerts" })).toBeNull()
    unmount()
    useStore.setState({
      health: {
        ...health,
        approver: { state: "down", errors: [] },
        killSwitch: { engaged: true, approverConfirmed: true },
        push: [{ channel: "ntfy", ok: false }],
      },
    })
    render(<Dashboard />)
    const alerts = screen.getByRole("region", { name: "Alerts" })
    expect(alerts.textContent).toContain("The Approver is down")
    expect(alerts.textContent).toContain("not reaching your phone: ntfy (not connected)")
    fireEvent.click(within(alerts).getByRole("button", { name: "Re-arm" }))
    expect(sent.at(-1)).toEqual({ type: "rearm" })
  })

  it("keeps what happened lately, newest first", () => {
    const h = useStore.getState().handleEvent
    h({
      type: "session_event",
      sessionId: "s1",
      event: "notify_user",
      data: { text: "Tests pass" },
    })
    h({ type: "sdk_message", sessionId: "s1", message: { type: "result", subtype: "success" } })
    render(<Dashboard />)
    const lately = screen.getByRole("region", { name: "Lately" })
    const items = within(lately)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "")
    expect(items[0]).toContain("shop: A turn finished.")
    expect(items[1]).toContain("shop: Claude told you: Tests pass")
  })
})
