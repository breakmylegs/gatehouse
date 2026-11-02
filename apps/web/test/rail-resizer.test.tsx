// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RAIL_START, RailResizer, savedRailWidth } from "../src/components/RailResizer"

function Shell() {
  const [w, setW] = useState(savedRailWidth)
  return <RailResizer width={w} onChange={setW} />
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe("dragging the sidebar wider or narrower", () => {
  it("follows the pointer, stays within its limits, and is kept for next time", () => {
    render(<Shell />)
    const edge = screen.getByRole("separator", { name: "Sidebar width" })
    expect(edge.getAttribute("aria-valuenow")).toBe(String(RAIL_START))
    fireEvent.pointerDown(edge, { clientX: 272, pointerId: 1 })
    fireEvent.pointerMove(edge, { clientX: 372, pointerId: 1 })
    expect(edge.getAttribute("aria-valuenow")).toBe("372")
    fireEvent.pointerUp(edge, { clientX: 900, pointerId: 1 })
    expect(edge.getAttribute("aria-valuenow")).toBe("480")
    expect(savedRailWidth()).toBe(480)
  })

  it("moves with the arrow keys and goes back with a double click", () => {
    render(<Shell />)
    const edge = screen.getByRole("separator", { name: "Sidebar width" })
    fireEvent.keyDown(edge, { key: "ArrowLeft" })
    expect(edge.getAttribute("aria-valuenow")).toBe(String(RAIL_START - 16))
    fireEvent.keyDown(edge, { key: "Home" })
    expect(edge.getAttribute("aria-valuenow")).toBe("200")
    fireEvent.doubleClick(edge)
    expect(edge.getAttribute("aria-valuenow")).toBe(String(RAIL_START))
  })

  it("ignores a saved width it cannot use", () => {
    localStorage.setItem("gatehouse.rail.width", "9000")
    expect(savedRailWidth()).toBe(RAIL_START)
  })
})
