// @vitest-environment jsdom
// /btw (owner, 4 Nov, for a colleague): a side question about a session, answered in a card, not in the conversation.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { askSideQuestion, dismissSideAnswer, sideLines } from "../src/lib/btw"
import { SideAnswerCard } from "../src/components/SideAnswer"
import type { Item } from "../src/lib/transcript"

const api = vi.fn()
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }))

afterEach(() => {
  cleanup()
  dismissSideAnswer("s1")
  vi.clearAllMocks()
})

const items = [
  { kind: "user", id: "u1", text: "Build the login page" },
  { kind: "tool", id: "t1", name: "Bash" },
  { kind: "text", id: "a1", text: "Done. Two tests fail.", subagent: "x" },
  { kind: "text", id: "a2", text: "Fixing the two failing tests." },
] as unknown as Item[]

describe("a /btw side question", () => {
  it("sends what you and Claude said, not tool calls or subagents' words, and shows the answer until Got it", async () => {
    expect(sideLines(items)).toEqual([
      { who: "you", text: "Build the login page" },
      { who: "claude", text: "Fixing the two failing tests." },
    ])
    let answer!: (v: unknown) => void
    api.mockReturnValue(new Promise((r) => (answer = r)))
    render(<SideAnswerCard sessionId="s1" />)
    act(() => void askSideQuestion("s1", "How far has it got?", items))
    expect(screen.getByText(/Claude is reading the session/)).toBeTruthy()
    expect(api).toHaveBeenCalledWith("POST", "/api/btw", {
      session: "s1",
      question: "How far has it got?",
      lines: sideLines(items),
    })
    await act(async () => answer({ ok: true, data: { answer: "It is fixing two tests." } }))
    expect(screen.getByText("It is fixing two tests.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Got it" }))
    expect(screen.queryByRole("region", { name: "By the way" })).toBeNull()
  })

  it("says why when it cannot answer", async () => {
    api.mockResolvedValue({ ok: false, status: 422, error: "The signed-in account has not been confirmed." })
    render(<SideAnswerCard sessionId="s1" />)
    await act(() => askSideQuestion("s1", "Where is it?", items))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not been confirmed/))
  })
})
