// @vitest-environment jsdom
// Backlog F22: the terminal's output, quoted into the session's prompt box for a question. Nothing is sent by itself.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TerminalPane } from "../src/components/TerminalPane"
import { COMPOSE_EVENT, quoteOutput } from "../src/lib/compose"
import { useStore } from "../src/store"

const sent: unknown[] = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (c: unknown) => (sent.push(c), { ok: true })) }
})
afterEach(cleanup)

describe("Ask Claude about this, in the terminal", () => {
  it("puts the last command and what it printed in the prompt box, and sends nothing", () => {
    useStore.setState({
      term: {
        s1: {
          chunks: [
            { stream: "cmd", text: "PS C:\\x> npm run build\n" },
            { stream: "out", text: "old output\n" },
            { stream: "cmd", text: "PS C:\\x> npm test\n" },
            { stream: "err", text: "1 failed: parser.test.ts\n" },
          ],
        },
      } as never,
    })
    const given: Array<{ sessionId: string; text: string }> = []
    const listen = (e: Event) => given.push((e as CustomEvent).detail)
    window.addEventListener(COMPOSE_EVENT, listen)
    try {
      render(<TerminalPane sessionId="s1" cwd="C:\\x" />)
      fireEvent.click(screen.getByRole("button", { name: "Ask Claude about this" }))
    } finally {
      window.removeEventListener(COMPOSE_EVENT, listen)
    }
    expect(given).toHaveLength(1)
    expect(given[0]!.sessionId).toBe("s1")
    expect(given[0]!.text).toContain("npm test")
    expect(given[0]!.text).toContain("1 failed: parser.test.ts")
    expect(given[0]!.text).not.toContain("old output")
    expect(sent).toEqual([])
  })

  it("quotes safely: a fence inside the output, and long output keeps its end", () => {
    expect(quoteOutput("has ``` inside")).toContain("````text")
    const long = quoteOutput(`${"a".repeat(9000)}END`, 100)
    expect(long).toContain("[the start was left out]")
    expect(long).toContain("END")
  })
})
