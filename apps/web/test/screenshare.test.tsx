// @vitest-environment jsdom
// E-091: in screen-share safe mode a redaction term is masked in the transcript view (and put back after); what you
// type is left alone; non-urgent notices wait and urgent ones do not; chosen sessions are hidden.
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { holdNotice, isHidden, MASK, releaseHeld, setHidden, setScreenShare, watchAndMask } from "../src/lib/screenshare"

afterEach(() => {
  cleanup()
  setScreenShare(false)
  localStorage.clear()
  releaseHeld()
})

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("screen-share safe mode", () => {
  it("masks a redaction term in the transcript view, including text that arrives later, and puts it back", async () => {
    const { container } = render(
      <div>
        <ol aria-label="Conversation">
          <li>Deploying the ACME-Corp billing service to Project Falcon now.</li>
        </ol>
      </div>,
    )
    // A text area as the prompt box has one: its words in a text node of its own.
    const box = document.createElement("textarea")
    box.textContent = "draft about ACME-Corp"
    container.firstElementChild!.appendChild(box)
    const stop = watchAndMask(container, ["acme-corp", "Project Falcon"])
    const log = container.querySelector("ol")!
    expect(log.textContent).toBe(`Deploying the ${MASK} billing service to ${MASK} now.`)
    // What you type is yours, and is not changed.
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("draft about ACME-Corp")
    // A message that arrives while sharing is masked too.
    const li = document.createElement("li")
    li.textContent = "ACME-CORP replied."
    log.appendChild(li)
    await tick()
    expect(li.textContent).toBe(`${MASK} replied.`)
    stop()
    expect(log.textContent).toContain("ACME-Corp billing service to Project Falcon")
  })

  it("holds notices that are not urgent while it is on, and lets requests through", () => {
    expect(holdNotice("a session finished")).toBe(false)
    setScreenShare(true)
    expect(holdNotice("a session finished")).toBe(true)
    expect(holdNotice("a decision is waiting", true)).toBe(false)
    expect(releaseHeld()).toEqual(["a session finished"])
    expect(releaseHeld()).toEqual([])
  })

  it("hides the sessions you chose, only while it is on, and remembers both", () => {
    setHidden("s1", true)
    expect(isHidden("s1")).toBe(false)
    setScreenShare(true)
    expect(isHidden("s1")).toBe(true)
    expect(isHidden("s2")).toBe(false)
    expect(localStorage.getItem("codeh:screenshare")).toBe("1")
    setHidden("s1", false)
    expect(isHidden("s1")).toBe(false)
  })
})
