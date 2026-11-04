// @vitest-environment jsdom
// Settings, General, Appearance (owner, 4 Nov): how the window looks, kept in the window and put on the page.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppearancePanel } from "../src/components/SettingsPanels"
import {
  applyAppearance,
  cleanFont,
  DEFAULT_APPEARANCE,
  readAppearance,
} from "../src/lib/appearance"
import { readPaneView, savePaneView } from "../src/lib/paneView"
import { useStore } from "../src/store"

vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404 })) }))

const root = () => document.documentElement
beforeEach(() => {
  localStorage.clear()
  applyAppearance(DEFAULT_APPEARANCE)
})
afterEach(cleanup)

describe("the appearance", () => {
  it("reads tolerantly: anything unknown or damaged is the usual look", () => {
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    localStorage.setItem("gatehouse.appearance", "{not json")
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    localStorage.setItem(
      "gatehouse.appearance",
      JSON.stringify({ width: "huge", codeSize: 99, textSize: 7, detail: "x", newer: 1 }),
    )
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it("keeps a font name that cannot break out of the page's style", () => {
    expect(cleanFont("JetBrains Mono")).toBe("JetBrains Mono")
    expect(cleanFont('x"; } body { display:none')).toBe("x body displaynone")
  })

  it("puts the width, code font and size and reduced motion on the page, and takes them off again", async () => {
    render(<AppearancePanel />)
    fireEvent.change(screen.getByLabelText("Transcript width"), { target: { value: "wide" } })
    expect(root().style.getPropertyValue("--transcript-width")).toBe("1200px")
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "reduced" } })
    expect(root().dataset.motion).toBe("reduced")
    fireEvent.change(screen.getByLabelText("Code font size"), { target: { value: "15" } })
    expect(root().style.getPropertyValue("--code-size")).toBe("15px")
    const font = screen.getByLabelText("Code font")
    fireEvent.change(font, { target: { value: "JetBrains Mono" } })
    fireEvent.blur(font)
    expect(root().style.getPropertyValue("--font-code")).toContain('"JetBrains Mono"')
    expect(JSON.parse(localStorage.getItem("gatehouse.appearance") ?? "{}")).toMatchObject({
      width: "wide",
      motion: "reduced",
      codeSize: 15,
      codeFont: "JetBrains Mono",
    })
    applyAppearance(DEFAULT_APPEARANCE)
    expect(root().dataset.motion).toBeUndefined()
    expect(root().style.getPropertyValue("--font-code")).toBe("")
  })

  it("opens a pane you never changed at the text size and detail you chose, and keeps a pane you did", () => {
    render(<AppearancePanel />)
    fireEvent.change(screen.getByLabelText("Transcript text size"), { target: { value: "115" } })
    fireEvent.change(screen.getByLabelText("Default transcript view"), {
      target: { value: "verbose" },
    })
    expect(readPaneView("never-changed")).toMatchObject({ size: 115, detail: "verbose" })
    savePaneView("mine", { size: 90, density: "compact", detail: "normal" })
    expect(readPaneView("mine")).toMatchObject({ size: 90, detail: "normal" })
  })

  it("chooses the theme here as in the profile menu, including following Windows", () => {
    render(<AppearancePanel />)
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } })
    expect(useStore.getState()).toMatchObject({ theme: "dark", themeFollows: false })
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "system" } })
    expect(useStore.getState().themeFollows).toBe(true)
  })
})
