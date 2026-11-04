// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { App } from "../src/App"
import { useStore } from "../src/store"

const sent: unknown[] = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (c: unknown) => (sent.push(c), { ok: true })) }
})

const health = {
  approver: { state: "up" as const, errors: [] },
  relay: { state: "not-configured" as const, devices: 0 },
  signin: {
    signedIn: true,
    email: "a@b.c",
    organization: "Org",
    managedPolicy: "detected" as const,
    orgOk: true,
  },
  killSwitch: { engaged: false, approverConfirmed: true },
  pwsh: { running: true },
}

afterEach(cleanup)

describe("App shell", () => {
  it("renders the queue page without looping", () => {
    useStore.setState({ route: "approvals" })
    useStore.getState().handleEvent({ type: "hello", sessions: [], pending: [], health, usage: {} })
    render(<App />)
    expect(screen.getByRole("heading", { name: /All clear/ })).toBeInTheDocument()
  })

  it("renders Home, the start screen, without looping", async () => {
    useStore.setState({ route: "home" })
    useStore.getState().handleEvent({ type: "hello", sessions: [], pending: [], health, usage: {} })
    render(<App />)
    expect(await screen.findByRole("button", { name: "Projects" })).toBeInTheDocument()
  })
})

describe("the command deck", () => {
  it("lists each live session with its state, opens one, and leaves ended ones out", async () => {
    const base = {
      cwd: "C:/dev/shop",
      mode: "default" as const,
      pendingApprovals: 0,
      createdAt: "2026-11-01T09:00:00Z",
    }
    useStore.setState({ route: "approvals" })
    useStore.getState().handleEvent({
      type: "hello",
      sessions: [
        { ...base, id: "s1", project: "shop", state: "running" },
        { ...base, id: "s2", project: "docs", state: "error" },
        { ...base, id: "s3", project: "old", state: "ended" },
      ],
      pending: [],
      health,
      usage: {},
    })
    render(<App />)
    const strip = screen.getByRole("group", { name: "Live sessions" })
    expect(screen.getByRole("button", { name: "Open shop, Working" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open docs, Stopped" })).toBeInTheDocument()
    expect(within(strip).queryByRole("button", { name: /Open old/ })).toBeNull()
    expect(within(strip).getAllByRole("button")).toHaveLength(2)
    await userEvent.click(screen.getByRole("button", { name: "Open shop, Working" }))
    expect(useStore.getState().route).toBe("workspace")
    expect(useStore.getState().selectedSession).toBe("s1")
  })
})

describe("the Codehouse look", () => {
  it("is always on, and the profile menu switches only between its light and dark versions", async () => {
    useStore.setState({ theme: "light", route: "approvals" })
    useStore.getState().handleEvent({ type: "hello", sessions: [], pending: [], health, usage: {} })
    render(<App />)
    // No faint picture behind the screens (owner, 4 Nov: it made the app look less clean).
    expect(document.documentElement.dataset.scene).toBeUndefined()
    expect(screen.queryByRole("button", { name: /codehouse look/i })).toBeNull()
    const profile = screen.getByRole("button", { name: /Your profile and settings/ })
    await userEvent.click(profile)
    await userEvent.click(screen.getByRole("menuitem", { name: "Codehouse dark" }))
    expect(useStore.getState().theme).toBe("dark")
    expect(document.documentElement.dataset.scene).toBeUndefined()
    await userEvent.click(profile)
    expect(screen.getByRole("menuitem", { name: "Codehouse light" })).toBeInTheDocument()
  })
})

describe("first run", () => {
  it("shows the checks when the account is not accepted, without looping", () => {
    useStore.setState({ route: "approvals" })
    useStore.getState().handleEvent({
      type: "hello",
      sessions: [],
      pending: [],
      health: {
        ...health,
        signin: { ...health.signin, orgOk: false, orgMessage: "Wrong organisation" },
      },
      usage: {},
    })
    render(<App />)
    expect(screen.getByRole("heading", { name: /Before you start/ })).toBeInTheDocument()
    expect(screen.getByText(/Wrong organisation/)).toBeInTheDocument()
  })
})

describe("kill switch", () => {
  it("asks first, defaults to Cancel, and only then sends kill", async () => {
    sent.length = 0
    useStore.setState({ route: "approvals" })
    useStore.getState().handleEvent({ type: "hello", sessions: [], pending: [], health, usage: {} })
    render(<App />)
    await userEvent.click(screen.getByRole("button", { name: "Kill switch" }))
    expect(sent).toEqual([])
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(sent).toEqual([])
    await userEvent.click(screen.getByRole("button", { name: "Kill switch" }))
    await userEvent.click(screen.getByRole("button", { name: "Yes, stop everything" }))
    expect(sent).toEqual([{ type: "kill" }])
  })

  it("opens the question from Ctrl+Shift+K and stops nothing by itself; Esc closes it", async () => {
    sent.length = 0
    useStore.setState({ route: "approvals" })
    useStore.getState().handleEvent({ type: "hello", sessions: [], pending: [], health, usage: {} })
    render(<App />)
    await userEvent.keyboard("{Control>}{Shift>}K{/Shift}{/Control}")
    expect(screen.getByRole("group", { name: "Confirm the kill switch" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    expect(sent).toEqual([])
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("group", { name: "Confirm the kill switch" })).toBeNull()
    expect(screen.getByRole("button", { name: "Kill switch" })).toHaveFocus()
    expect(sent).toEqual([])
  })

  it("names the sessions it would stop before you confirm (Stitch, R9)", async () => {
    sent.length = 0
    const base = {
      cwd: "C:/dev/shop",
      mode: "default" as const,
      pendingApprovals: 0,
      createdAt: "2026-11-01T09:00:00Z",
    }
    useStore.setState({ route: "approvals" })
    useStore.getState().handleEvent({
      type: "hello",
      sessions: [
        { ...base, id: "k1", project: "shop", state: "running" },
        { ...base, id: "k2", project: "old", state: "ended" },
      ],
      pending: [],
      health,
      usage: {},
    })
    render(<App />)
    await userEvent.click(screen.getByRole("button", { name: "Kill switch" }))
    const list = screen.getByRole("list", { name: "Sessions that stop" })
    expect(within(list).getByText("shop")).toBeTruthy()
    expect(within(list).queryByText("old")).toBeNull()
    expect(sent).toEqual([])
  })

  it("offers re-arm while engaged", async () => {
    sent.length = 0
    useStore.getState().handleEvent({
      type: "hello",
      sessions: [],
      pending: [],
      health: { ...health, killSwitch: { engaged: true, approverConfirmed: true } },
      usage: {},
    })
    render(<App />)
    await userEvent.click(screen.getByRole("button", { name: "Re-arm sessions" }))
    expect(sent).toEqual([{ type: "rearm" }])
  })
})

describe("the first sign-in check after a start", () => {
  it("is shown as checking, not as failures, and sends you nowhere until it answers", () => {
    useStore.setState({ route: "approvals", setupDone: true })
    const checking = {
      ...health,
      signin: { ...health.signin, signedIn: false, orgOk: false, checked: false },
    }
    useStore
      .getState()
      .handleEvent({ type: "hello", sessions: [], pending: [], health: checking, usage: {} })
    render(<App />)
    expect(useStore.getState().route).toBe("approvals")
    expect(screen.getAllByText("Checking sign-in").length).toBeGreaterThan(0)
    cleanup()
    useStore.setState({ route: "first-run" })
    render(<App />)
    expect(screen.getByText(/Signed in to Claude/).textContent).toContain("still being checked")
    expect(screen.getByText("Checking your sign-in")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Sign in with my Claude account/ })).toBeNull()
  })

  it("sends you to Before you start once it has answered that you are not signed in", () => {
    useStore.setState({ route: "approvals", setupDone: true })
    const failed = {
      ...health,
      signin: { ...health.signin, signedIn: false, orgOk: false, checked: true },
    }
    useStore
      .getState()
      .handleEvent({ type: "hello", sessions: [], pending: [], health: failed, usage: {} })
    render(<App />)
    expect(useStore.getState().route).toBe("first-run")
  })
})
