// @vitest-environment jsdom
// Backlog G11: a diff of thousands of lines draws only the first LINE_LIMIT until asked, so the window stays quick.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { LINE_LIMIT, MoreLines, shownLines } from "../src/components/MoreLines"

function Lines({ lines }: { lines: string[] }) {
  const [all, setAll] = useState(false)
  return (
    <pre>
      {shownLines(lines, all).map((l) => (
        <div key={l} data-testid="line">
          {l}
        </div>
      ))}
      <MoreLines total={lines.length} all={all} onShow={() => setAll(true)} />
    </pre>
  )
}

afterEach(cleanup)

describe("long diffs", () => {
  it("draws the first lines of a 10,000-line diff and the rest only when asked", () => {
    render(<Lines lines={Array.from({ length: 10_000 }, (_, i) => `line ${i}`)} />)
    expect(screen.getAllByTestId("line")).toHaveLength(LINE_LIMIT)
    fireEvent.click(screen.getByRole("button", { name: "Show the other 9,600 lines" }))
    expect(screen.getAllByTestId("line")).toHaveLength(10_000)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("draws a short diff whole, with no button", () => {
    render(<Lines lines={["a", "b"]} />)
    expect(screen.getAllByTestId("line")).toHaveLength(2)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
