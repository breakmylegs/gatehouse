// @vitest-environment jsdom
// O46: a session's Timeline also shows each Codehouse release published while the session ran, as a diamond labelled
// "Release 2.0.523" in time order among the summaries, with the changelog's notes as text, the version you run marked,
// and Update now, through the usual update, for a newer one.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let releases: unknown = []
const node = (at: string, summary: string) => ({
  at,
  from: new Date(Date.parse(at) - 600_000).toISOString(),
  summary,
  activity: { you: 1, claude: 2, tools: 3 },
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url === "/api/changelog") return { ok: true, status: 200, data: { releases } }
    if (url.startsWith("/api/update")) return { ok: true, status: 200, data: { current: "2.0.522" } }
    return {
      ok: true,
      status: 200,
      data: { enabled: true, nodes: [node("2026-11-16T10:10:00Z", "Added the export."), node("2026-11-16T10:30:00Z", "Wrote its tests.")] },
    }
  }),
}))
const { SummaryTimeline, timelinePoints } = await import("../src/components/SummaryTimeline")
const { useStore } = await import("../src/store")

const status = (o: Record<string, unknown> = {}) =>
  ({ current: "2.0.522", canInstall: true, available: true, latest: { version: "2.0.524", notes: "" }, ...o }) as never

beforeEach(() => {
  calls.length = 0
  releases = [
    { version: "2.0.524", date: "2026-11-16T10:25:00Z", notes: "- The newest.\n<img src=x onerror=alert(1)>" },
    { version: "2.0.523", date: "2026-11-16T10:15:00Z", notes: "## What is new\n- **Release** nodes on the timeline." },
    { version: "2.0.522", date: "2026-11-16T10:05:00Z", notes: "- The one you run." },
    // Before the session's first summary: not on its timeline.
    { version: "2.0.521", date: "2026-11-15T09:00:00Z", notes: "- Older." },
  ]
  useStore.setState({ update: status() })
})
afterEach(cleanup)

const open = async () => {
  render(<SummaryTimeline sessionId="s1" onClose={() => undefined} />)
  await screen.findByText("Wrote its tests.")
  return screen.findByRole("button", { name: /^Release 2\.0\.523/ })
}
const names = () => within(screen.getByRole("list", { name: /oldest first/ })).getAllByRole("button").map((b) => b.getAttribute("aria-label"))

describe("releases on a session's Timeline (O46)", () => {
  it("puts each release published during the session among the summaries, in time order, as its own kind of point", async () => {
    await open()
    expect(names()).toEqual([
      expect.stringMatching(/^Release 2\.0\.522, published .*, this version$/),
      expect.stringMatching(/the ten minutes before$/),
      expect.stringMatching(/^Release 2\.0\.523, published .*, not installed$/),
      expect.stringMatching(/^Release 2\.0\.524, published .*, not installed$/),
      expect.stringMatching(/the ten minutes before$/),
    ])
    const r = screen.getByRole("button", { name: /^Release 2\.0\.523/ })
    expect(r.getAttribute("data-kind")).toBe("release")
    expect(r.querySelector(".summary-dot")!.getAttribute("data-kind")).toBe("release")
    expect(r.textContent).toContain("Release 2.0.523")
    expect(screen.getByRole("button", { name: /^Release 2\.0\.522/ }).querySelector(".summary-dot")!.getAttribute("data-mark")).toBe("current")
    // The changelog is read the way Settings reads it, once.
    expect(calls.filter((c) => c.url === "/api/changelog")).toHaveLength(1)
  })

  it("shows a release's notes as text, never as HTML, and offers Update now for a newer one through the usual update", async () => {
    fireEvent.click(await open())
    const shown = screen.getByRole("region", { name: "Release 2.0.523" })
    expect(within(shown).getByText(/Release nodes on the timeline\./).textContent).not.toContain("**")
    expect(within(shown).getByRole("heading", { name: /not installed yet/ })).toBeTruthy()
    fireEvent.click(within(shown).getByRole("button", { name: "Update now, to 2.0.524" }))
    expect(calls.at(-1)).toEqual({ method: "POST", url: "/api/update/install", body: { version: "2.0.524" } })

    fireEvent.click(screen.getByRole("button", { name: /^Release 2\.0\.524/ }))
    const newest = screen.getByRole("region", { name: "Release 2.0.524" })
    expect(newest.querySelector("img")).toBeNull()
    expect(within(newest).getByText(/<img src=x/)).toBeTruthy()
    expect(within(newest).getByRole("button", { name: "Update now" })).toBeTruthy()
  })

  it("offers no update for the version you run, nor when this copy cannot install one", async () => {
    await open()
    fireEvent.click(screen.getByRole("button", { name: /^Release 2\.0\.522/ }))
    expect(screen.getByRole("heading", { name: /the version you run/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Update now/ })).toBeNull()
    useStore.setState({ update: status({ canInstall: false }) })
    fireEvent.click(screen.getByRole("button", { name: /^Release 2\.0\.524/ }))
    expect(screen.queryByRole("button", { name: /Update now/ })).toBeNull()
  })

  it("is one tab stop moved with the arrow keys, Home and End, across summaries and releases", async () => {
    await open()
    const list = screen.getByRole("list", { name: /oldest first/ })
    const stops = () => within(list).getAllByRole("button").filter((b) => b.tabIndex === 0)
    expect(stops()).toHaveLength(1)
    fireEvent.keyDown(list, { key: "Home" })
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Release 2\.0\.522/)
    fireEvent.keyDown(list, { key: "ArrowRight" })
    fireEvent.keyDown(list, { key: "ArrowRight" })
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Release 2\.0\.523/)
    expect(screen.getByRole("region", { name: "Release 2.0.523" })).toBeTruthy()
    expect(stops()).toHaveLength(1)
    fireEvent.keyDown(list, { key: "End" })
    expect(screen.getByText("Wrote its tests.")).toBeTruthy()
  })

  it("works from the last copy of the changelog, and without one shows the summaries alone", async () => {
    releases = undefined
    render(<SummaryTimeline sessionId="s1" onClose={() => undefined} />)
    await screen.findByText("Wrote its tests.")
    expect(names()).toHaveLength(2)
    expect(
      timelinePoints([node("2026-11-16T10:10:00Z", "x")], [{ version: "2.0.9", date: "2026-11-16T10:01:00Z", notes: "" }], Date.parse("2026-11-16T10:00:30Z")),
    ).toHaveLength(1)
  })
})
