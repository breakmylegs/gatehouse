// @vitest-environment jsdom
// Home is the owner's start picture, with no buttons on it; the window opens on the main screen instead (owner, 17 Nov).
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandDeck } from "../src/components/CommandDeck"
import { Home } from "../src/surfaces/Home"
import { useStore } from "../src/store"

describe("Home, the start picture", () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({ route: "home" })
  })
  afterEach(cleanup)

  it("shows the owner's start picture, described for a screen reader, with no buttons on it", () => {
    render(<Home />)
    const img = screen.getByRole("img")
    expect(img.getAttribute("src")).toBe("./codehouse/start-screen.png")
    expect(img.getAttribute("alt")).toMatch(/roadhouse/i)
    expect(screen.queryAllByRole("button")).toEqual([])
  })

  it("is where the Codehouse name in the command deck goes", () => {
    useStore.setState({ route: "approvals" })
    render(<CommandDeck />)
    fireEvent.click(screen.getByRole("button", { name: /go to home/i }))
    expect(useStore.getState().route).toBe("home")
  })
})

describe("where the window opens", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it("is the main screen, not the start picture, on first use and after an older version saved Home", async () => {
    localStorage.clear()
    vi.resetModules()
    expect((await import("../src/store")).START_ROUTE).toBe("workspace")
    localStorage.setItem("gatehouse.setup", "done")
    localStorage.setItem("gatehouse.view", JSON.stringify({ route: "home", panes: [] }))
    vi.resetModules()
    expect((await import("../src/store")).useStore.getState().route).toBe("workspace")
  })

  it("in Neighbourhood Watch, is the computer's main screen, with no setup on the way", async () => {
    localStorage.clear()
    vi.stubEnv("VITE_CODEHOUSE_REMOTE", "cnw")
    vi.resetModules()
    const s = await import("../src/store")
    expect(s.useStore.getState()).toMatchObject({ route: "workspace", setupDone: true })
  })
})
