// @vitest-environment jsdom
// The little fighter (owner, 16 Nov): he moves through his frames while he waits or works, and stands still with Reduce
// motion, whether it comes from the Mac or from Settings, Appearance.
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Fighter } from "../src/components/Fighter"

const position = (c: HTMLElement) => (c.querySelector(".fighter") as HTMLElement).style.backgroundPosition

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete document.documentElement.dataset.motion
})

describe("the little fighter", () => {
  it("steps through his stance while he waits, and through a bout while he works", () => {
    const { container } = render(<Fighter mode="waiting" />)
    expect(position(container)).toBe("0px 0px")
    act(() => void vi.advanceTimersByTime(180))
    expect(position(container)).toBe("-48px 0px")
    act(() => void vi.advanceTimersByTime(180 * 3))
    expect(position(container)).toBe("0px 0px")
    cleanup()
    const work = render(<Fighter mode="working" />).container
    act(() => void vi.advanceTimersByTime(180 * 4))
    expect(position(work)).toBe("0px -96px")
  })

  it("stands still with Reduce motion", () => {
    document.documentElement.dataset.motion = "reduced"
    const { container } = render(<Fighter mode="working" />)
    act(() => void vi.advanceTimersByTime(5000))
    expect(position(container)).toBe("0px 0px")
    expect(container.querySelector(".fighter")?.getAttribute("aria-hidden")).toBe("true")
  })
})
