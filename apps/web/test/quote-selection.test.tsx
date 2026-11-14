// @vitest-environment jsdom
// T-040 (t3code review): part of one of Claude's replies, selected in this pane, is quoted into the prompt box by a
// button or Ctrl+Shift+Q; a selection outside a reply, or in another pane, offers nothing.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { QuoteSelection } from "../src/components/QuoteSelection"
import { quoteBlock, withQuote } from "../src/lib/quote"

afterEach(() => {
  cleanup()
  document.getSelection()?.removeAllRanges()
})

describe("quoting a reply (T-040)", () => {
  it("quotes each line, keeps what you wrote, and leaves room for your comment", () => {
    expect(quoteBlock("  The total is wrong.\r\nIt adds VAT twice.\n\nSee line 4. ")).toBe("> The total is wrong.\n> It adds VAT twice.\n>\n> See line 4.")
    expect(withQuote("", "Use the cache")).toBe("> Use the cache\n\n")
    expect(withQuote("Two things:  ", "Use the cache")).toBe("Two things:\n\n> Use the cache\n\n")
    expect(withQuote("kept", "   ")).toBe("kept")
    expect(quoteBlock("x".repeat(5000))).toHaveLength(4002)
  })

  function setup() {
    document.body.innerHTML = ""
    const holder = document.createElement("div")
    holder.innerHTML = `<div class="pane" id="mine"><div class="reply"><p id="said">Use the cache for totals.</p></div><p id="mine-plain">Your own message</p></div>
      <div class="pane" id="other"><div class="reply"><p id="theirs">Another session's reply.</p></div></div>`
    document.body.appendChild(holder)
    const quoted: string[] = []
    const onQuote = vi.fn((t: string) => void quoted.push(t))
    const pane = () => document.getElementById("mine")
    const host = document.createElement("div")
    document.body.appendChild(host)
    render(<QuoteSelection pane={pane} onQuote={onQuote} />, { container: host })
    const select = (id: string) =>
      act(() => {
        const r = document.createRange()
        r.selectNodeContents(document.getElementById(id)!)
        const s = document.getSelection()!
        s.removeAllRanges()
        s.addRange(r)
        document.dispatchEvent(new Event("selectionchange"))
      })
    return { quoted, select }
  }

  it("offers to quote a selection in one of this pane's replies, by button or by keys", () => {
    const t = setup()
    t.select("said")
    fireEvent.click(screen.getByRole("button", { name: /Quote in prompt/ }))
    expect(t.quoted).toEqual(["Use the cache for totals."])
    t.select("said")
    fireEvent.keyDown(window, { key: "Q", ctrlKey: true, shiftKey: true })
    expect(t.quoted).toHaveLength(2)
  })

  it("offers nothing for a selection outside a reply, or in another pane", () => {
    const t = setup()
    t.select("mine-plain")
    expect(screen.queryByRole("button", { name: /Quote in prompt/ })).toBeNull()
    t.select("theirs")
    expect(screen.queryByRole("button", { name: /Quote in prompt/ })).toBeNull()
    fireEvent.keyDown(window, { key: "Q", ctrlKey: true, shiftKey: true })
    expect(t.quoted).toEqual([])
  })
})
