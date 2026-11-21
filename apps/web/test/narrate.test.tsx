// @vitest-environment jsdom
// D-091: each change in a file is read as one sentence in a fixed order (file, which change, kind, where and how many
// lines, risk), and the arrow keys move between the changes.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { moveBetweenHunks, narrate } from "../src/lib/narrate"

afterEach(cleanup)

const hunks = [
  { beforeStart: 3, beforeLines: 0, afterStart: 3, afterLines: 4 },
  { beforeStart: 10, beforeLines: 2, afterStart: 14, afterLines: 1 },
  { beforeStart: 20, beforeLines: 3, afterStart: 22, afterLines: 0 },
]

describe("narrated changes", () => {
  it("says the file, which change, its kind, where, how many lines and its risk, in that order", () => {
    expect(hunks.map((h, i) => narrate("src/cart.ts", h, i, hunks.length, [10, 75, undefined][i]))).toEqual([
      "src/cart.ts, change 1 of 3: added, lines 3 to 6, 4 lines added, Low risk.",
      "src/cart.ts, change 2 of 3: changed, line 14, 1 line now, 2 lines before, High risk.",
      "src/cart.ts, change 3 of 3: removed, before line 22, 3 lines removed, risk not known.",
    ])
  })

  it("moves between the changes with the arrow keys, Home and End, and not from a button inside one", () => {
    render(
      <ol>
        {hunks.map((h, i) => (
          <li key={i} data-hunk={i} tabIndex={0} aria-label={narrate("a.ts", h, i, hunks.length, 10)} onKeyDown={moveBetweenHunks}>
            <button type="button">Comment</button>
          </li>
        ))}
      </ol>,
    )
    const items = screen.getAllByRole("listitem")
    items[0]!.focus()
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1]!, { key: "End" })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2]!, { key: "ArrowDown" })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2]!, { key: "Home" })
    expect(document.activeElement).toBe(items[0])
    const button = screen.getAllByRole("button")[0]!
    button.focus()
    fireEvent.keyDown(button, { key: "ArrowDown" })
    expect(document.activeElement).toBe(button)
    expect(items.map((li) => li.getAttribute("aria-label"))).toEqual([
      "a.ts, change 1 of 3: added, lines 3 to 6, 4 lines added, Low risk.",
      "a.ts, change 2 of 3: changed, line 14, 1 line now, 2 lines before, Low risk.",
      "a.ts, change 3 of 3: removed, before line 22, 3 lines removed, Low risk.",
    ])
  })
})
