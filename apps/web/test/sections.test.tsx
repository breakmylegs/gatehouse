// @vitest-environment jsdom
// O48 (owner, 25 Nov): main sections that open their section, and its pages as pills along the top. Every page has
// one section (but a session, Approvals, first run, setup, Home and an imported chat, which have their own ways in); a
// section opens on the page last used in it; the pills mark the page you are on and move with the arrow keys.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SectionPills } from "../src/components/SectionPills"
import { NAV_SECTIONS, openingPage, rememberPage, sectionOf } from "../src/lib/sections"
import { PAGES } from "../src/lib/commands"
import { useStore, type Route } from "../src/store"

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const OWN_WAY_IN: Route[] = ["workspace", "approvals", "first-run", "setup", "home", "imported"]

describe("the sections (O48)", () => {
  it("give every page that is a command exactly one section", () => {
    const all = NAV_SECTIONS.flatMap((s) => s.pages.map((p) => p.route))
    expect(new Set(all).size).toBe(all.length)
    for (const p of PAGES) {
      if (OWN_WAY_IN.includes(p.route)) continue
      expect(sectionOf(p.route), `${p.route} has no section`).toBeDefined()
    }
    for (const r of OWN_WAY_IN) expect(sectionOf(r)).toBeUndefined()
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(["Work", "Ask about code", "Build", "Safety", "Settings"])
    expect(sectionOf("mcp")?.label).toBe("Build")
    expect(sectionOf("audit")?.label).toBe("Safety")
  })

  it("open on the page last used in them, and on their first page otherwise or after a value they cannot read", () => {
    const safety = NAV_SECTIONS.find((s) => s.id === "safety")!
    expect(openingPage(safety)).toBe("policy")
    rememberPage("audit")
    expect(openingPage(safety)).toBe("audit")
    // Another section's page, a page no longer in the section, or a value an older version wrote: its first page.
    localStorage.setItem("codeh:section-last", JSON.stringify({ safety: "mcp" }))
    expect(openingPage(safety)).toBe("policy")
    localStorage.setItem("codeh:section-last", "not json")
    expect(openingPage(safety)).toBe("policy")
    rememberPage("workspace")
    expect(localStorage.getItem("codeh:section-last")).toBe("not json")
  })
})

describe("the pills along the top (O48)", () => {
  it("show the section's pages, mark the one you are on, and go to another", () => {
    useStore.setState({ route: "approver" })
    render(<SectionPills route="approver" />)
    const nav = screen.getByRole("navigation", { name: "Safety pages" })
    const pills = within(nav).getAllByRole("button")
    expect(pills.map((b) => b.textContent)).toEqual(["What Claude may do", "Approver", "Audit log"])
    expect(within(nav).getByRole("button", { name: "Approver" }).getAttribute("aria-current")).toBe("page")
    expect(pills.filter((b) => b.getAttribute("aria-current"))).toHaveLength(1)
    fireEvent.click(within(nav).getByRole("button", { name: "Audit log" }))
    expect(useStore.getState().route).toBe("audit")
    expect(JSON.parse(localStorage.getItem("codeh:section-last")!)).toMatchObject({ safety: "approver" })
  })

  it("are one tab stop moved with the arrow keys, Home and End, wrapping round", () => {
    useStore.setState({ route: "settings" })
    const { rerender } = render(<SectionPills route="settings" />)
    const bar = screen.getByRole("toolbar", { name: "Settings" })
    expect(within(bar).getAllByRole("button").filter((b) => b.tabIndex === 0).map((b) => b.textContent)).toEqual(["Settings"])
    fireEvent.keyDown(bar, { key: "ArrowRight" })
    expect(useStore.getState().route).toBe("devices")
    rerender(<SectionPills route="devices" />)
    fireEvent.keyDown(bar, { key: "End" })
    expect(useStore.getState().route).toBe("guide")
    rerender(<SectionPills route="guide" />)
    fireEvent.keyDown(bar, { key: "ArrowRight" })
    expect(useStore.getState().route).toBe("settings")
    rerender(<SectionPills route="settings" />)
    fireEvent.keyDown(bar, { key: "ArrowLeft" })
    expect(useStore.getState().route).toBe("guide")
  })

  it("are not shown in a session, nor on a page with its own way in", () => {
    for (const r of OWN_WAY_IN) {
      const { container, unmount } = render(<SectionPills route={r} />)
      expect(container.innerHTML, r).toBe("")
      unmount()
    }
  })
})
