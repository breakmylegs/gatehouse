// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { HelpPane } from "../src/components/HelpPane"
import { GUIDE, PAGE_HELP } from "../src/help/content"
import { Guide } from "../src/surfaces/Guide"
import { useStore } from "../src/store"

beforeEach(() => useStore.setState({ helpOpen: false, route: "approvals" }))
afterEach(cleanup)

describe("help for the page you are on", () => {
  it("opens for the current page and closes with Esc", () => {
    render(<HelpPane />)
    expect(screen.queryByRole("complementary", { name: /help for this page/i })).toBeNull()
    act(() => useStore.getState().setHelpOpen(true))
    expect(screen.getByRole("heading", { name: "Help: Approvals" })).toBeTruthy()
    expect(screen.getAllByText(/Allow once/).length).toBeGreaterThan(0)
    act(() => useStore.setState({ route: "sessions" }))
    expect(screen.getByRole("heading", { name: "Help: Sessions" })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole("complementary", { name: /help for this page/i }), {
      key: "Escape",
    })
    expect(useStore.getState().helpOpen).toBe(false)
  })

  it("has help for every page, and never points at a document in a folder", () => {
    for (const a of Object.values(PAGE_HELP)) {
      expect(a.body.length, a.id).toBeGreaterThan(40)
      expect(a.body, a.id).not.toMatch(/docs\/|\.md\b/)
    }
    for (const a of GUIDE) expect(a.body, a.id).not.toMatch(/docs\/|\.md\b/)
  })

  it("opens the full guide from the pane", () => {
    useStore.setState({ helpOpen: true })
    render(<HelpPane />)
    fireEvent.click(screen.getByRole("button", { name: /open the full user guide/i }))
    expect(useStore.getState().route).toBe("guide")
  })
})

describe("the user guide", () => {
  it("lists every article and shows the one you pick", () => {
    render(<Guide />)
    const contents = screen.getByRole("navigation", { name: /guide contents/i })
    for (const a of GUIDE) expect(contents.textContent).toContain(a.title)
    fireEvent.click(screen.getByRole("button", { name: "Troubleshooting" }))
    expect(screen.getByRole("heading", { name: "Troubleshooting" })).toBeTruthy()
  })
})
