// @vitest-environment jsdom
// T-076 (t3code review): a review guide, read only as data: its stops in order, Look closely, Ask about this stop (a
// question in the prompt box) and Finish review; anything that is not a guide stays plain code.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
const { GuideCard, parseGuide, GUIDE_PROMPT, GUIDE_FENCE } = await import("../src/components/ReviewGuide")
const { ReviewSession } = await import("../src/components/ReviewCard")
const { COMPOSE_EVENT } = await import("../src/lib/compose")

afterEach(cleanup)

const block = JSON.stringify([
  { file: "src/cache.ts", lines: "10-40", title: "What it is for", why: "The new cache." },
  { file: "src/write.ts", lines: "3; rm -rf", title: "Invalidation", why: "<b>Cleared</b> on write.", close: true },
  { file: "", title: "x", why: "y" },
])

describe("review guides (T-076)", () => {
  it("reads only well-formed stops, and leaves anything else as code", () => {
    const stops = parseGuide(block)!
    expect(stops.map((s) => [s.file, s.lines, s.close])).toEqual([
      ["src/cache.ts", "10-40", undefined],
      ["src/write.ts", undefined, true],
    ])
    expect(parseGuide("not json")).toBeUndefined()
    expect(parseGuide("[]")).toBeUndefined()
    expect(GUIDE_PROMPT).toContain(GUIDE_FENCE)
    expect(GUIDE_PROMPT).toContain("Change nothing")
  })

  it("walks the stops, asks about one in the prompt box, and finishes", () => {
    const composed: unknown[] = []
    const on = (e: Event) => composed.push((e as CustomEvent).detail)
    window.addEventListener(COMPOSE_EVENT, on)
    const { container } = render(
      <ReviewSession.Provider value="side1">
        <GuideCard stops={parseGuide(block)!} />
      </ReviewSession.Provider>,
    )
    expect(screen.getByText("Review guide: stop 1 of 2")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Next stop" }))
    expect(screen.getByText("Look closely")).toBeTruthy()
    expect(container.querySelector("b")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ask about this stop" }))
    window.removeEventListener(COMPOSE_EVENT, on)
    expect(composed).toEqual([{ sessionId: "side1", text: "About src/write.ts (Invalidation): " }])
    fireEvent.click(screen.getByRole("button", { name: "Finish review" }))
    expect(screen.getByRole("status").textContent).toBe("Review finished: 2 stops read.")
  })
})
