// @vitest-environment jsdom
// Backlog G16: a review's findings as a card, grouped by file; Fix this one asks for that one only; a dismissal is
// recorded before the finding goes.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
let recordOk = true
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/store", () => ({
  send: vi.fn(async (cmd: Record<string, unknown>) => {
    sent.push(cmd)
    return recordOk ? { ok: true } : { ok: false, error: { message: "not recorded" } }
  }),
}))
const { ReviewCard, ReviewSession, parseFindings } = await import("../src/components/ReviewCard")

const block = JSON.stringify([
  {
    file: "src/pay.ts",
    line: 12,
    severity: "high",
    summary: "The amount is not checked.",
    detail: "Refuse below zero.",
  },
  { file: "src/basket.ts", line: 3, severity: "low", summary: "A name could be clearer." },
  { file: "src/pay.ts", severity: "weird", summary: "No test for refunds." },
  { file: "", summary: "no file, left out" },
])

const composed: string[] = []
const listen = (e: Event) => composed.push((e as CustomEvent<{ text: string }>).detail.text)
beforeEach(() => {
  sent.length = 0
  composed.length = 0
  recordOk = true
  localStorage.clear()
  window.addEventListener("codeh:compose", listen)
})
afterEach(() => {
  window.removeEventListener("codeh:compose", listen)
  cleanup()
})

const show = () =>
  render(
    <ReviewSession.Provider value="s1">
      <ReviewCard findings={parseFindings(block)!} />
    </ReviewSession.Provider>,
  )

describe("the review card", () => {
  it("reads only well-formed findings, and nothing from a block that is not a list", () => {
    const f = parseFindings(block)!
    expect(f.map((x) => [x.file, x.severity])).toEqual([
      ["src/pay.ts", "high"],
      ["src/basket.ts", "low"],
      ["src/pay.ts", "medium"],
    ])
    expect(parseFindings("not json")).toBeUndefined()
    expect(parseFindings('{"x":1}')).toBeUndefined()
  })

  it("groups findings by file, and Fix this one asks for that finding only", () => {
    show()
    expect(screen.getByText("3 findings in 2 files")).toBeTruthy()
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "src/pay.ts",
      "src/basket.ts",
    ])
    fireEvent.click(
      screen.getByRole("button", { name: "Fix this one: The amount is not checked." }),
    )
    expect(composed).toHaveLength(1)
    expect(composed[0]).toContain("Fix only this finding")
    expect(composed[0]).toContain(
      "src/pay.ts, line 12 (high): The amount is not checked.\nRefuse below zero.",
    )
    expect(composed[0]).not.toContain("refunds")
    fireEvent.click(screen.getByRole("button", { name: "Fix all 3" }))
    expect(composed[1]).toContain("3. src/pay.ts (medium): No test for refunds.")
  })

  it("records a dismissal before the finding goes, and keeps it dismissed", async () => {
    recordOk = false
    show()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: A name could be clearer." }))
    await waitFor(() => expect(sent).toHaveLength(1))
    const gone = () => screen.queryByRole("button", { name: "Dismiss: A name could be clearer." })
    expect(gone()).toBeTruthy()
    recordOk = true
    fireEvent.click(gone()!)
    await waitFor(() => expect(gone()).toBeNull())
    expect(sent[1]).toEqual({
      type: "review_dismiss",
      sessionId: "s1",
      file: "src/basket.ts",
      summary: "A name could be clearer.",
    })
    cleanup()
    show()
    expect(gone()).toBeNull()
    expect(screen.getByText("2 findings in 1 file, 1 dismissed")).toBeTruthy()
  })
})
