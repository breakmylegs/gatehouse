// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
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
    useStore.getState().handleEvent({ type: "hello", sessions: [], pending: [], health, usage: {} })
    render(<App />)
    expect(screen.getByRole("heading", { name: /All clear/ })).toBeInTheDocument()
  })
})

describe("Jean-Claude mode", () => {
  it("is always on, and the header switches only between its light and dark versions", async () => {
    useStore.setState({ theme: "light", route: "approvals" })
    useStore.getState().handleEvent({ type: "hello", sessions: [], pending: [], health, usage: {} })
    render(<App />)
    expect(document.documentElement.dataset.jcvc).toBe("on")
    expect(screen.queryByRole("button", { name: /jean-claude mode/i })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Jean-Claude dark" }))
    expect(useStore.getState().theme).toBe("dark")
    expect(document.documentElement.dataset.jcvc).toBe("on")
    expect(screen.getByRole("button", { name: "Jean-Claude light" })).toBeInTheDocument()
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
