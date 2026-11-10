// @vitest-environment jsdom
// CH-07 (owner's Chat build): Trust and continue shows what will be sent before an imported chat is carried on here.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ContinueDialog } from "../src/components/ContinueDialog"
import { useStore } from "../src/store"

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
const api = vi.fn(
  async (_m: string, url: string, body?: { withMemory?: boolean; previewId?: string }) => {
    if (url === "/api/chat/continue/preview")
      return {
        ok: true,
        status: 200,
        data: {
          previewId: body?.withMemory ? "p-mem" : "p-plain",
          seed: body?.withMemory
            ? "<<<HISTORY ... HISTORY>>>\n- Prefers metric."
            : "<<<HISTORY ... HISTORY>>>",
          chars: 1200,
          tokens: 300,
          summarised: true,
          summary: "They talked about colours.",
          turnsKept: 10,
          instructionsAvailable: false,
          memoryAvailable: 1,
        },
      }
    if (url === "/api/chat/continue") return { ok: true, status: 200, data: { sessionId: "s-new" } }
    return { ok: false, status: 404 }
  },
)
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...(a as [string, string])) }))
afterEach(() => {
  cleanup()
  api.mockClear()
})

describe("Trust and continue", () => {
  it("shows what will be sent, with both imported extras off, and continues with exactly that", async () => {
    const onClose = vi.fn()
    render(<ContinueDialog conversation="c1" onClose={onClose} />)
    expect(await screen.findByText(/1,200 characters, about 300 tokens/)).toBeTruthy()
    expect(screen.getByText("They talked about colours.")).toBeTruthy()
    expect(api).toHaveBeenCalledWith("POST", "/api/chat/continue/preview", {
      conversation: "c1",
      withInstructions: false,
      withMemory: false,
    })
    const instructions = screen.getByRole("checkbox", {
      name: /project's instructions/,
    }) as HTMLInputElement
    expect(instructions.checked).toBe(false)
    expect(instructions.disabled).toBe(true)
    fireEvent.click(screen.getByRole("checkbox", { name: /memory imported/ }))
    expect(await screen.findByText(/Prefers metric/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Trust and continue" }))
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("POST", "/api/chat/continue", { previewId: "p-mem" }),
    )
    await waitFor(() =>
      expect(useStore.getState()).toMatchObject({ route: "workspace", selectedSession: "s-new" }),
    )
    expect(onClose).toHaveBeenCalled()
  })
})
