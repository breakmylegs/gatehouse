// @vitest-environment jsdom
// The changelog in Settings (owner, 4 Nov): a drop-down of every version with its release date, and its notes below.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ChangelogPanel } from "../src/components/ChangelogPanel"

const api = vi.fn()
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const releases = [
  { version: "2.0.97", date: "2026-11-06T10:00:00Z", notes: "### Every platform\n- **/btw** side questions." },
  { version: "2.0.93", date: "2026-11-05T10:00:00Z", notes: "- <b>Fixes</b>." },
]

describe("the changelog panel", () => {
  it("opens at this version, lists each with its release date, and shows another's notes as text", async () => {
    api.mockResolvedValue({ ok: true, status: 200, data: { releases, readAt: "2026-11-06T10:00:00Z" } })
    render(<ChangelogPanel current="2.0.93" />)
    const pick = (await screen.findByRole("combobox", { name: "Version" })) as HTMLSelectElement
    expect(pick.value).toBe("2.0.93")
    expect([...pick.options].map((o) => o.textContent)).toEqual([
      "2.0.97, released 6 Nov 2026",
      "2.0.93, released 5 Nov 2026 (this one)",
    ])
    // Shown as text: markup in notes is never drawn.
    expect(screen.getByText("• <b>Fixes</b>.")).toBeTruthy()
    fireEvent.change(pick, { target: { value: "2.0.97" } })
    expect(screen.getByRole("heading", { name: "Every platform" })).toBeTruthy()
    expect(screen.getByText("• /btw side questions.")).toBeTruthy()
  })

  it("says when it shows the copy last read because GitHub could not be reached, and reads again on request", async () => {
    api.mockResolvedValue({
      ok: true,
      status: 200,
      data: { releases, readAt: "2026-11-05T09:00:00Z", offline: true },
    })
    render(<ChangelogPanel />)
    expect((await screen.findByRole("status")).textContent).toMatch(/as last read on 5 Nov 2026/)
    fireEvent.click(screen.getByRole("button", { name: "Read it again" }))
    expect(api).toHaveBeenLastCalledWith("GET", "/api/changelog?fresh=1")
  })
})
