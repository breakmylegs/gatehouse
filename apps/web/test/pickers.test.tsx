// @vitest-environment jsdom
// T-107: the session in front's pickers from the keyboard, and its effort a step up or down within the cap.
import { describe, expect, it } from "vitest"
import { openPicker, stepEffort } from "../src/lib/pickers"
import { effective } from "../src/lib/shortcuts"

describe("keyboard pickers (T-107)", () => {
  it("moves the effort one step, from Medium when it is the model's default, never past either end or the cap", () => {
    expect(stepEffort(undefined, 1)).toBe("high")
    expect(stepEffort("high", -1)).toBe("medium")
    expect(stepEffort("max", 1)).toBeUndefined()
    expect(stepEffort("low", -1)).toBeUndefined()
    expect(stepEffort("high", 1, "high")).toBeUndefined()
    expect(stepEffort("xhigh", -1, "high")).toBe("high")
  })

  it("opens the picker of the session asked for, and not a disabled one or another session's", () => {
    document.body.innerHTML = `
      <select data-picker="model" data-session="s2"><option>a</option></select>
      <select data-picker="model" data-session="s1"><option>a</option></select>
      <select data-picker="mode" data-session="s1" disabled><option>a</option></select>`
    expect(openPicker("s1", "model")).toBe(true)
    expect(document.activeElement).toBe(document.querySelectorAll("select")[1])
    expect(openPicker("s1", "mode")).toBe(false)
    expect(openPicker("s9", "effort")).toBe(false)
  })

  it("has its keys in the registry, so they can be changed like any other", () => {
    const { keys } = effective(undefined)
    expect([keys["pick-model"], keys["pick-effort"], keys["pick-mode"], keys["effort-up"], keys["effort-down"]]).toEqual(["Alt+M", "Alt+E", "Alt+O", "Ctrl+Alt+ArrowUp", "Ctrl+Alt+ArrowDown"])
    expect(effective({ "pick-model": "Ctrl+Alt+M" }).keys["pick-model"]).toBe("Ctrl+Alt+M")
  })
})
