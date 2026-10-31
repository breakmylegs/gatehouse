// @vitest-environment jsdom
// Several Claude accounts at once (owner, 30 Oct): switch which one the window shows without stopping anything, start
// new sessions on it, and add, sign in, confirm and remove accounts.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
let signInReply: Record<string, unknown> = { state: "waiting", message: "Finish in your browser." }
vi.mock("../src/lib/connection", () => ({
  takeToken: () => "token",
  Connection: class {
    start() {}
    send(cmd: Record<string, unknown>) {
      sent.push(cmd)
      if (cmd.type === "account_add")
        return Promise.resolve({ ok: true, data: { id: "0a1b2c3d", label: cmd.label } })
      if (cmd.type === "signin_start" || cmd.type === "signin_status")
        return Promise.resolve({ ok: true, data: signInReply })
      return Promise.resolve({ ok: true })
    }
  },
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const { accountForNew, startConnection, useStore } = await import("../src/store")
const { Rail } = await import("../src/components/Rail")
const { AccountsDialog } = await import("../src/components/AccountsDialog")
startConnection()

const health = {
  approver: { state: "up" as const, errors: [] },
  relay: { state: "not-configured" as const, devices: 0 },
  signin: {
    signedIn: true,
    email: "peter@work.example",
    organization: "ACN - Premium",
    managedPolicy: "detected" as const,
    orgOk: true,
    checked: true,
  },
  accounts: [
    {
      id: "main",
      label: "Main account",
      signedIn: true,
      email: "peter@work.example",
      organization: "ACN - Premium",
      expectedOrg: "ACN - Premium",
      orgOk: true,
    },
    {
      id: "0a1b2c3d",
      label: "Personal",
      signedIn: true,
      email: "peter@home.example",
      organization: "Peter's Individual Org",
      orgOk: false,
    },
  ],
  killSwitch: { engaged: false, approverConfirmed: true },
  pwsh: { running: true },
}
const session = (id: string, project: string, account?: string) => ({
  id,
  cwd: `C:\\dev\\${project}`,
  project,
  mode: "default" as const,
  state: "running" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-31T09:00:00Z",
  ...(account ? { account } : {}),
})

beforeEach(() => {
  sent.length = 0
  signInReply = { state: "waiting", message: "Finish in your browser." }
  localStorage.clear()
  useStore.setState({
    conn: "open",
    health,
    pending: {},
    activeAccount: "main",
    sessions: { w1: session("w1", "atlas"), p1: session("p1", "hobby", "0a1b2c3d") },
    panes: ["w1"],
    selectedSession: "w1",
    route: "workspace",
    setupDone: true,
  })
})
afterEach(cleanup)

describe("switching accounts", () => {
  it("shows the account's sessions only, and stops nothing on the other", () => {
    render(<Rail onHide={() => undefined} />)
    const rail = screen.getByRole("navigation", { name: "Sidebar" })
    expect(within(rail).queryByText("hobby")).toBeNull()
    expect(within(rail).getByText("atlas")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Your profile and settings/ }))
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Personal, peter@home\.example/ }))
    expect(useStore.getState().activeAccount).toBe("0a1b2c3d")
    expect(within(rail).getByText("hobby")).toBeTruthy()
    expect(within(rail).queryByText("atlas")).toBeNull()
    // The work session's pane leaves the screen; nothing was sent to stop it.
    expect(useStore.getState().panes).toEqual([])
    expect(sent.filter((c) => /stop|interrupt|close/.test(String(c.type)))).toEqual([])
    expect(localStorage.getItem("gatehouse.account")).toBe("0a1b2c3d")
  })

  it("starts new sessions on the account shown", () => {
    expect(accountForNew()).toEqual({})
    useStore.getState().setActiveAccount("0a1b2c3d")
    expect(accountForNew()).toEqual({ account: "0a1b2c3d" })
  })
})

describe("the Accounts panel", () => {
  it("adds an account and starts its sign-in, with a private window on offer", async () => {
    signInReply = {
      state: "waiting",
      message: "Finish in your browser.",
      url: "https://claude.ai/oauth/authorize?x=1",
    }
    render(<AccountsDialog onClose={() => undefined} />)
    fireEvent.change(screen.getByRole("textbox", { name: /Add an account/ }), {
      target: { value: "Side project" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add and sign in" }))
    await waitFor(() =>
      expect(sent.filter((c) => c.type !== "signin_status")).toEqual([
        { type: "account_add", label: "Side project" },
        { type: "signin_start", account: "0a1b2c3d", method: "claudeai" },
      ]),
    )
    fireEvent.click(await screen.findByRole("button", { name: "Open in a private window" }))
    await waitFor(() =>
      expect(sent.at(-1)).toEqual({ type: "account_private_window", account: "0a1b2c3d" }),
    )
  })

  it("confirms the organisation an account reports, and removes only added accounts", async () => {
    render(<AccountsDialog onClose={() => undefined} />)
    const items = screen.getAllByRole("listitem")
    const main = items[0] as HTMLElement
    const personal = items[1] as HTMLElement
    expect(within(main).queryByRole("button", { name: "Remove" })).toBeNull()
    expect(within(personal).getByText(/Confirm it, and its sessions can start/)).toBeTruthy()
    fireEvent.click(
      within(personal).getByRole("button", { name: "Confirm Peter's Individual Org" }),
    )
    await waitFor(() =>
      expect(sent.at(-1)).toEqual({ type: "account_confirm_org", account: "0a1b2c3d" }),
    )
    fireEvent.click(within(personal).getByRole("button", { name: "Remove" }))
    await waitFor(() =>
      expect(sent.at(-1)).toEqual({ type: "account_remove", account: "0a1b2c3d" }),
    )
  })
})
