// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandDeck } from "../src/components/CommandDeck"
import { Home } from "../src/surfaces/Home"
import { useStore } from "../src/store"

describe("Home, the start screen", () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({ route: "home" })
  })
  afterEach(cleanup)

  it("shows the owner's start screen, described for a screen reader", () => {
    render(<Home />)
    const img = screen.getByRole("img")
    expect(img.getAttribute("src")).toBe("./codehouse/start-screen.png")
    expect(img.getAttribute("alt")).toMatch(/roadhouse/i)
  })

  it("makes each button drawn in the picture go where it says, in the sidebar's matching mode", () => {
    render(<Home />)
    fireEvent.click(screen.getByRole("button", { name: "Chat" }))
    expect(useStore.getState().route).toBe("chat")
    expect(localStorage.getItem("gatehouse.railMode")).toBe("chat")
    fireEvent.click(screen.getByRole("button", { name: "Code" }))
    expect(useStore.getState().route).toBe("sessions")
    expect(localStorage.getItem("gatehouse.railMode")).toBe("code")
    fireEvent.click(screen.getByRole("button", { name: "Projects" }))
    expect(useStore.getState().route).toBe("projects")
  })

  it("is where the Codehouse name in the command deck goes", () => {
    useStore.setState({ route: "approvals" })
    render(<CommandDeck />)
    fireEvent.click(screen.getByRole("button", { name: /go to home/i }))
    expect(useStore.getState().route).toBe("home")
  })
})
