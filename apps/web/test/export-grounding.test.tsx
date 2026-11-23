// @vitest-environment jsdom
// E-083: an ungrounded sentence is highlighted in the export preview, on its own line, and nothing else is.
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Highlighted } from "../src/components/ExportDialog"

afterEach(cleanup)

describe("the export preview's highlighting", () => {
  it("marks each ungrounded sentence on its line and leaves the rest as it was", () => {
    const text = "Refunds always settle in three days.\nSourced in src/a.ts. Refunds always settle in three days.\nRefunds always settle in three days."
    const { container } = render(
      <pre>
        <Highlighted text={text} marks={[{ line: 2, sentence: "Refunds always settle in three days." }]} />
      </pre>,
    )
    const marks = container.querySelectorAll("mark")
    expect([...marks].map((m) => m.textContent)).toEqual(["Refunds always settle in three days."])
    // The same words on another line are not marked, and the text is unchanged.
    expect(container.querySelector("pre")!.textContent).toBe(text)
  })
})
