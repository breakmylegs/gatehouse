// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Setup } from "../src/surfaces/Setup"
import { useStore } from "../src/store"

const health = (signedIn: boolean, orgOk: boolean) =>
  ({
    approver: { state: "up", errors: [] },
    relay: { state: "off" },
    signin: { signedIn, orgOk, managedPolicy: "unknown", ...(signedIn ? { email: "a@b.c" } : {}) },
    killSwitch: { engaged: false, approverConfirmed: true },
    pwsh: { running: true },
  }) as never

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ health: health(false, false), setupDone: false, route: "setup" })
})
afterEach(cleanup)

describe("the setup wizard", () => {
  it("opens on the welcome step and holds you at sign-in until you are signed in", async () => {
    const user = userEvent.setup()
    render(<Setup />)
    expect(screen.getByRole("heading", { name: /welcome to jean-claude van code/i })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Get started" }))
    expect(screen.getByRole("heading", { name: "Sign in to Claude" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /sign in with my claude account/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /company single sign-on/i })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("moves on once signed in, and holds at the organisation until it matches", async () => {
    const user = userEvent.setup()
    useStore.setState({ health: health(true, false) })
    render(<Setup />)
    await user.click(screen.getByRole("button", { name: "Get started" }))
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByRole("heading", { name: "Check your organisation" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("finishes: remembers it is done and opens Sessions", async () => {
    const user = userEvent.setup()
    useStore.setState({ health: health(true, true) })
    render(<Setup />)
    await user.click(screen.getByRole("button", { name: "Get started" }))
    await user.click(screen.getByRole("button", { name: "Next" }))
    await user.click(screen.getByRole("button", { name: "Next" }))
    await user.click(screen.getByRole("button", { name: "Next" }))
    await user.click(screen.getByRole("button", { name: "Start my first session" }))
    expect(localStorage.getItem("gatehouse.setup")).toBe("done")
    expect(useStore.getState().route).toBe("sessions")
  })

  it("can be skipped, and the choices step sets the theme and Jean-Claude mode", async () => {
    const user = userEvent.setup()
    useStore.setState({ health: health(true, true) })
    render(<Setup />)
    for (let i = 0; i < 3; i++)
      await user.click(screen.getByRole("button", { name: i === 0 ? "Get started" : "Next" }))
    await user.click(screen.getByRole("radio", { name: "Dark" }))
    await user.click(screen.getByRole("checkbox", { name: /jean-claude mode/i }))
    expect(useStore.getState().theme).toBe("dark")
    expect(useStore.getState().jcMode).toBe(true)
    await user.click(screen.getByRole("button", { name: "Skip setup" }))
    expect(useStore.getState().setupDone).toBe(true)
    expect(useStore.getState().route).toBe("approvals")
  })
})
