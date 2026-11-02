// @vitest-environment jsdom
// Settings shows Codehouse's temporary leftovers and clears them (owner, 1 Nov: the disk filled with them).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TempFilesPanel } from "../src/components/TempFilesPanel"

let left = { items: 3, bytes: 3 * 1024 ** 3 }
const toasts: string[] = []
vi.mock("sonner", () => ({
  toast: Object.assign((t: string) => toasts.push(t), { error: (t: string) => toasts.push(t) }),
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string) => {
    if (url === "/api/housekeeping/temp") return { ok: true, status: 200, data: left }
    if (url === "/api/housekeeping/temp/clear" && method === "POST") {
      const was = left
      left = { items: 0, bytes: 0 }
      return { ok: true, status: 200, data: { removed: was.items, bytes: was.bytes, left: 0 } }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
afterEach(cleanup)

describe("temporary files in Settings", () => {
  it("says how much Codehouse has left, and clears it", async () => {
    render(<TempFilesPanel />)
    expect(await screen.findByText("3 items, 3.0 GB.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Clear temporary files" }))
    await waitFor(() => expect(toasts.at(-1)).toBe("Cleared 3 temporary items, 3.0 GB."))
    expect(await screen.findByText("None left now.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Clear temporary files" })).toBeDisabled()
  })
})
