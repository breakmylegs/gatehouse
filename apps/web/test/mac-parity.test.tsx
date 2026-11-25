// @vitest-environment jsdom
// Owner, 25 Nov: "I want as little drift between the mac and windows version as possible. Mac features will always
// take the priority when it comes to menu layout, themes and style." What the Mac drew differently, Windows draws the
// same way now: the disclosure chevron, and Settings on Ctrl+comma as Command-comma on a Mac. What is the system's own
// stays each system's (key names, the Keychain, the shell, the menu bar).
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Disclosure } from "../src/components/DisclosureMac"

vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404 })) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("the Mac's look and keys on Windows (owner, 25 Nov)", () => {
  it("draws the disclosure chevron as the Mac does, on every platform", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })
    const { container, rerender } = render(<Disclosure open={false} />)
    expect(container.querySelector("svg path")).not.toBeNull()
    expect(container.textContent).toBe("")
    rerender(<Disclosure open />)
    expect((container.querySelector("svg") as SVGElement).style.transform).toBe("rotate(90deg)")
  })

  it("opens Settings with Ctrl+comma on Windows, as Command-comma does on a Mac, and lists it", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", clipboard: undefined })
    const { App } = await import("../src/App")
    const { useStore } = await import("../src/store")
    useStore.setState({ route: "dashboard" })
    render(<App />)
    fireEvent.keyDown(window, { key: ",", ctrlKey: true })
    expect(useStore.getState().route).toBe("settings")
    const { MAC_BINDINGS } = await import("../src/components/ShortcutSheet")
    expect(MAC_BINDINGS.some((b) => b.keys === "Ctrl ," && b.label === "Settings")).toBe(true)
  })
})
