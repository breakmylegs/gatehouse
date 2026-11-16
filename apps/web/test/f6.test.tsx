// @vitest-environment jsdom
// T-108 (t3code review): F6 moves the keyboard to the next area of the window (deck, sidebar, page, prompt box),
// Shift+F6 back; from the prompt box it goes round to the deck.
import { afterEach, describe, expect, it } from "vitest"
import { areas, cycle } from "../src/lib/f6"

afterEach(() => void (document.body.innerHTML = ""))

describe("F6 between areas (T-108)", () => {
  it("goes round the areas there are, forwards and back", () => {
    document.body.innerHTML = `
      <header aria-label="Command deck"><button id="deck">Home</button></header>
      <nav aria-label="Sidebar"><button id="side">New session</button></nav>
      <main><h1>Page</h1><textarea aria-label="Prompt" id="prompt"></textarea></main>`
    expect(areas().length).toBe(4)
    expect(cycle(false)?.id).toBe("deck")
    expect(cycle(false)?.id).toBe("side")
    // The page's first control here is the prompt box itself; from it, F6 goes round to the deck.
    expect(cycle(false)?.id).toBe("prompt")
    expect(cycle(false)?.id).toBe("deck")
    expect(cycle(true)?.id).toBe("prompt")
  })

  it("skips an area that is not there", () => {
    document.body.innerHTML = `<header aria-label="Command deck"><button id="deck">Home</button></header><main><p>x</p></main>`
    expect(cycle(false)?.id).toBe("deck")
    const t = cycle(false)!
    expect(t.tagName).toBe("MAIN")
    expect(document.activeElement).toBe(t)
  })
})
