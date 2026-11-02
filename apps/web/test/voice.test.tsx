// @vitest-environment jsdom
// W1-16: the microphone is off until you switch it on, shows only in the Codehouse window, and asks the window to start
// Windows voice typing in the prompt box, which takes the focus first.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { setVoiceTyping, VoiceButton, VoiceSetting } from "../src/components/VoiceButton"

const posted: string[] = []
const inWindow = () =>
  ((globalThis as Record<string, unknown>).chrome = {
    webview: {
      postMessage: (m: string) => posted.push(m),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  })

function Box() {
  const area = useRef<HTMLTextAreaElement>(null)
  return (
    <>
      <textarea ref={area} aria-label="Prompt" />
      <VoiceButton target={area} />
    </>
  )
}

beforeEach(() => {
  posted.length = 0
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  delete (globalThis as Record<string, unknown>).chrome
})

describe("voice typing", () => {
  it("is off until switched on in Settings", () => {
    inWindow()
    render(
      <>
        <VoiceSetting />
        <Box />
      </>,
    )
    expect(screen.queryByRole("button", { name: /speak/i })).toBeNull()
    fireEvent.click(screen.getByRole("checkbox", { name: /microphone/i }))
    expect(screen.getByRole("button", { name: /speak/i })).toBeTruthy()
  })

  it("focuses the prompt box and asks the window to start voice typing", () => {
    inWindow()
    act(() => setVoiceTyping(true))
    render(<Box />)
    fireEvent.click(screen.getByRole("button", { name: /speak/i }))
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Prompt" }))
    expect(posted).toEqual(["voice"])
  })

  it("has no button in a browser, where there is no window to ask", () => {
    act(() => setVoiceTyping(true))
    render(
      <>
        <VoiceSetting />
        <Box />
      </>,
    )
    expect(screen.queryByRole("button", { name: /speak/i })).toBeNull()
    expect(screen.getByText(/part of the Codehouse window/)).toBeTruthy()
  })
})
