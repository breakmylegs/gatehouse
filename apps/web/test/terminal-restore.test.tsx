// @vitest-environment jsdom
// T-112: a terminal pane that opens with nothing shows what the Host kept; Clear clears the Host's copy too; Select all
// selects the output.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TerminalPane } from "../src/components/TerminalPane"
import { useStore } from "../src/store"

const sent: Array<Record<string, unknown>> = []
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })) }))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return cmd.type === "term_history" ? { ok: true, data: { chunks: [{ stream: "cmd", text: "> npm test\n" }, { stream: "out", text: "all 12 passed\n" }] } } : { ok: true, data: {} }
    }),
  }
})
afterEach(cleanup)

describe("the terminal after a reconnect (T-112)", () => {
  it("shows what the Host kept, and clears it there too", async () => {
    useStore.setState({ term: {} })
    render(<TerminalPane sessionId="s1" cwd="C:/dev/shop" />)
    expect(await screen.findByText("all 12 passed", { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Select all" }))
    expect(window.getSelection()?.toString()).toContain("all 12 passed")
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    await waitFor(() => expect(sent).toContainEqual({ type: "term_clear", sessionId: "s1" }))
  })

  it("asks the Host for nothing when this window already has the terminal", async () => {
    sent.length = 0
    useStore.setState({ term: { s2: { chunks: [{ stream: "out", text: "here already\n" }] } } as never })
    render(<TerminalPane sessionId="s2" cwd="C:/dev/shop" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(sent.filter((c) => c.type === "term_history")).toEqual([])
  })
})
