// @vitest-environment jsdom
// T-136: recognised words go where the caret is, as typing would, so the box's own state follows.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { insertAtCaret, setVoiceMode, voiceMode } from "../src/lib/voice-server"

afterEach(cleanup)

function Box() {
  const [v, setV] = useState("Fix the")
  return (
    <>
      <textarea aria-label="Prompt" value={v} onChange={(e) => setV(e.target.value)} />
      <output>{v}</output>
    </>
  )
}

describe("speech into the prompt box (T-136)", () => {
  it("puts the words at the caret with a space, and the box's state has them", () => {
    render(<Box />)
    const box = screen.getByLabelText("Prompt") as HTMLTextAreaElement
    fireEvent.focus(box)
    box.selectionStart = box.selectionEnd = box.value.length
    insertAtCaret(box, "login bug")
    expect(screen.getByRole("status").textContent).toBe("Fix the login bug")
    expect(box.selectionStart).toBe("Fix the login bug".length)
  })

  it("is Windows voice typing unless you choose the server", () => {
    expect(voiceMode()).toBe("windows")
    setVoiceMode("server")
    expect(voiceMode()).toBe("server")
    setVoiceMode("windows")
    expect(voiceMode()).toBe("windows")
  })
})
