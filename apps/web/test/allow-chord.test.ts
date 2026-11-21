// D-092: the chord itself: two presses within two seconds allow High; one never does; plain Enter never arms it.
import { describe, expect, it } from "vitest"
import { chordStep, CHORD_MS } from "../src/lib/allow-chord"

describe("the allow chord", () => {
  it("arms on the first press and allows on a second within two seconds, and not after", () => {
    const armed = chordStep(undefined, "ctrl-enter", true, 1000)
    expect(armed).toEqual({ allow: false, armedAt: 1000 })
    expect(chordStep(armed.armedAt, "enter", true, 1000 + CHORD_MS).allow).toBe(true)
    expect(chordStep(armed.armedAt, "enter", true, 1001 + CHORD_MS)).toEqual({ allow: false })
    expect(chordStep(armed.armedAt, "button-key", true, 1001 + CHORD_MS)).toEqual({ allow: false, armedAt: 1001 + CHORD_MS })
  })

  it("never arms on plain Enter, and below High one Ctrl+Enter allows", () => {
    expect(chordStep(undefined, "enter", true, 0)).toEqual({ allow: false })
    expect(chordStep(undefined, "ctrl-enter", false, 0)).toEqual({ allow: true })
    expect(chordStep(undefined, "enter", false, 0)).toEqual({ allow: false })
  })
})
