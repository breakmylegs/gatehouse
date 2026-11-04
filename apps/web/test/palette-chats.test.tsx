// @vitest-environment jsdom
// CH-03 (owner's Chat build, 4 Nov): Ctrl+K searches what was said in your chats, from Chat's own store.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandPalette } from "../src/components/CommandPalette"

const openConversation = vi.fn(async () => true)
vi.mock("../src/lib/redo", () => ({
  openConversation: (...a: unknown[]) => openConversation(...(a as [])),
}))
const api = vi.fn(async () => ({
  ok: true,
  status: 200,
  data: {
    hits: [
      {
        conversationId: "c1",
        messageId: "m1",
        title: "Baking",
        snippet: "How long to bake [sourdough]?",
      },
    ],
  },
}))
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...(a as [])) }))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never
Element.prototype.scrollIntoView ??= () => undefined

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const openPalette = () => act(() => window.dispatchEvent(new Event("codeh:palette")))

describe("searching your chats from Ctrl+K", () => {
  it("finds what was said and opens that chat", async () => {
    render(<CommandPalette />)
    openPalette()
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sourdough" } })
    await waitFor(() => expect(api).toHaveBeenCalledWith("GET", "/api/chat/search?q=sourdough"))
    const hit = await screen.findByText("Baking")
    expect(screen.getByText("How long to bake [sourdough]?")).toBeTruthy()
    fireEvent.click(hit)
    expect(openConversation).toHaveBeenCalledWith("c1")
  })

  it("does not search for a single letter", async () => {
    vi.useFakeTimers()
    try {
      render(<CommandPalette />)
      openPalette()
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "s" } })
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(api).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
