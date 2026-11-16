// @vitest-environment jsdom
// T-109 (t3code review): back and forward through the pages visited, with Alt+Left and Alt+Right; going somewhere new
// clears what was ahead; Alt and an arrow inside a text box stay the text's.
import { fireEvent, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { NavHistory, useNavHistory } from "../src/lib/navHistory"
import { useStore } from "../src/store"

describe("back and forward (T-109)", () => {
  it("goes back and forward, and a new page clears what was ahead", () => {
    const h = new NavHistory()
    let at = "home" as never as string
    const go = (r: string) => void (at = r)
    h.visited("home" as never, "sessions" as never)
    h.visited("sessions" as never, "settings" as never)
    expect(h.back("settings" as never, go as never)).toBe(true)
    expect(at).toBe("sessions")
    expect(h.forward("sessions" as never, go as never)).toBe(true)
    expect(at).toBe("settings")
    h.back("settings" as never, go as never)
    h.visited("sessions" as never, "audit" as never)
    expect(h.forward("audit" as never, go as never)).toBe(false)
  })

  it("answers Alt+Left in the window, not in a text box", () => {
    useStore.setState({ route: "home" } as never)
    renderHook(() => useNavHistory())
    useStore.getState().setRoute("settings")
    const box = document.createElement("textarea")
    document.body.append(box)
    fireEvent.keyDown(box, { key: "ArrowLeft", altKey: true })
    expect(useStore.getState().route).toBe("settings")
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true })
    expect(useStore.getState().route).toBe("home")
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true })
    expect(useStore.getState().route).toBe("settings")
    box.remove()
  })
})
