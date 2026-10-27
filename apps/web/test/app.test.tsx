// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { App } from "../src/App"
import { useStore } from "../src/store"

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
