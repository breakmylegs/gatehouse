// @vitest-environment jsdom
// Owner, 25 Nov: "The timeline should be for each code session. Not combined." A session's Timeline shows only its
// own summaries: it reads that session's timeline and nothing else (no Codehouse releases, which O46 had put here and
// which stay on the changelog's timeline in Settings), and its points are one tab stop moved with the arrow keys.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const calls: string[] = []
const node = (at: string, summary: string) => ({
  at,
  from: new Date(Date.parse(at) - 600_000).toISOString(),
  summary,
  activity: { you: 1, claude: 2, tools: 3 },
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) => {
    calls.push(url)
    if (url === "/api/changelog") return { ok: true, status: 200, data: { releases: [{ version: "2.0.633", date: "2026-11-25T08:10:00Z", notes: "- Codehouse's own notes" }] } }
    const which = url.includes("home-services") ? "Home Services" : "Codehouse"
    return {
      ok: true,
      status: 200,
      data: { enabled: true, nodes: [node("2026-11-25T08:06:00Z", `${which}: added the export.`), node("2026-11-25T08:16:00Z", `${which}: wrote its tests.`)] },
    }
  }),
}))
const { SummaryTimeline } = await import("../src/components/SummaryTimeline")
afterEach(() => {
  cleanup()
  calls.length = 0
})

describe("a session's Timeline is that session's alone (owner, 25 Nov)", () => {
  it("reads only this session's summaries, with no Codehouse release among them", async () => {
    render(<SummaryTimeline sessionId="home-services" onClose={() => undefined} />)
    expect(await screen.findByText("Home Services: wrote its tests.")).toBeTruthy()
    expect(calls).toEqual(["/api/sessions/home-services/timeline"])
    const points = within(screen.getByRole("list", { name: /oldest first/ })).getAllByRole("button")
    expect(points.map((b) => b.getAttribute("aria-label"))).toEqual([expect.stringMatching(/the ten minutes before$/), expect.stringMatching(/the ten minutes before$/)])
    expect(screen.queryByText(/Release 2\.0\.633/)).toBeNull()
    expect(screen.queryByText(/Codehouse's own notes/)).toBeNull()
    expect(screen.queryByText(/Codehouse: /)).toBeNull()
  })

  it("is one tab stop moved with the arrow keys, Home and End", async () => {
    render(<SummaryTimeline sessionId="home-services" onClose={() => undefined} />)
    await screen.findByText("Home Services: wrote its tests.")
    const list = screen.getByRole("list", { name: /oldest first/ })
    const stops = () => within(list).getAllByRole("button").filter((b) => b.tabIndex === 0)
    expect(stops()).toHaveLength(1)
    fireEvent.keyDown(list, { key: "Home" })
    expect(screen.getByText("Home Services: added the export.")).toBeTruthy()
    expect(document.activeElement).toBe(within(list).getAllByRole("button")[0])
    fireEvent.keyDown(list, { key: "ArrowRight" })
    expect(screen.getByText("Home Services: wrote its tests.")).toBeTruthy()
    fireEvent.keyDown(list, { key: "End" })
    expect(stops()).toHaveLength(1)
  })
})
