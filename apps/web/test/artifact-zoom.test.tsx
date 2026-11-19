// @vitest-environment jsdom
// T-058: a visual reply can be zoomed, in steps from half to twice its size, and an HTML one is shown in the theme.
import { describe, expect, it } from "vitest"
import { stepZoom, themedPath, ZOOMS } from "../src/components/ArtifactsPane"

describe("visual replies (T-058)", () => {
  it("zooms in and out in steps, and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.25)
    expect(stepZoom(1, -1)).toBe(0.8)
    expect(stepZoom(ZOOMS[0]!, -1)).toBe(0.5)
    expect(stepZoom(2, 1)).toBe(2)
    expect(stepZoom(0.9, 1)).toBe(1.25)
  })

  it("asks for the page in the theme it is shown in, and only light or dark", () => {
    expect(themedPath("/artifact/abc", "dark")).toBe("/artifact/abc?theme=dark")
    expect(themedPath("/artifact/abc?v=1", "light")).toBe("/artifact/abc?v=1&theme=light")
    expect(themedPath("/artifact/abc", "<x>")).toBe("/artifact/abc?theme=light")
  })
})
