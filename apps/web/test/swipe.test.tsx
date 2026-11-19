// @vitest-environment jsdom
// T-111: a two-finger trackpad swipe goes back or forward once it adds up, not for a scroll down the page, not twice
// for one swipe, and not over something that scrolls sideways itself.
import { describe, expect, it } from "vitest"
import { SWIPE_PX, SwipeDetector } from "../src/lib/navHistory"

const run = (d: SwipeDetector, deltas: Array<[number, number]>, start = 0, sideways = false) => deltas.map(([x, y], i) => d.wheel({ deltaX: x, deltaY: y }, start + i * 16, sideways)).filter(Boolean)

describe("trackpad swipes (T-111)", () => {
  it("goes back on a swipe right and forward on a swipe left, once each", () => {
    expect(run(new SwipeDetector(), Array.from({ length: 10 }, () => [-30, 2] as [number, number]))).toEqual(["back"])
    expect(run(new SwipeDetector(), Array.from({ length: 10 }, () => [30, 0] as [number, number]))).toEqual(["forward"])
  })

  it("ignores scrolling down the page, a small nudge, pinch zoom, and sideways scrolling of a wide thing", () => {
    expect(run(new SwipeDetector(), Array.from({ length: 10 }, () => [-20, 60] as [number, number]))).toEqual([])
    expect(run(new SwipeDetector(), [[-SWIPE_PX / 2, 0]])).toEqual([])
    expect(new SwipeDetector().wheel({ deltaX: -400, deltaY: 0, ctrlKey: true }, 0, false)).toBeUndefined()
    expect(run(new SwipeDetector(), Array.from({ length: 10 }, () => [-30, 0] as [number, number]), 0, true)).toEqual([])
  })

  it("starts again after a pause, and rests after a swipe", () => {
    const d = new SwipeDetector()
    expect(d.wheel({ deltaX: -100, deltaY: 0 }, 0, false)).toBeUndefined()
    expect(d.wheel({ deltaX: -100, deltaY: 0 }, 1000, false)).toBeUndefined()
    expect(d.wheel({ deltaX: -100, deltaY: 0 }, 1016, false)).toBe("back")
    expect(d.wheel({ deltaX: -400, deltaY: 0 }, 1100, false)).toBeUndefined()
    expect(d.wheel({ deltaX: -400, deltaY: 0 }, 2000, false)).toBe("back")
  })
})
