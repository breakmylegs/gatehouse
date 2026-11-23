// @vitest-environment jsdom
// O44: the changelog as a timeline of releases: each a point with its version and date; pressing one shows its notes,
// drawn as text; the version you run, newer ones and those new since you last looked are marked; arrow keys move.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChangelogPanel, compareVersions, SEEN_KEY } from "../src/components/ChangelogPanel"

const api = vi.fn()
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }))
beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const releases = [
  { version: "2.0.100", date: "2026-11-07T10:00:00Z", notes: "- Newer, not installed." },
  { version: "2.0.97", date: "2026-11-06T10:00:00Z", notes: "### Every platform\n- **/btw** side questions." },
  { version: "2.0.93", date: "2026-11-05T10:00:00Z", notes: "- <b>Fixes</b>.\nAnd <i>this</i> too." },
]
const points = () => screen.getAllByRole("button", { name: /^Version / })

describe("the changelog timeline", () => {
  it("puts each release on the timeline, oldest first, opens at this version, and shows another's notes as text", async () => {
    api.mockResolvedValue({ ok: true, status: 200, data: { releases, readAt: "2026-11-07T10:00:00Z" } })
    render(<ChangelogPanel current="2.0.93" />)
    await screen.findByRole("list", { name: "Releases, oldest first" })
    expect(points().map((b) => b.getAttribute("data-version"))).toEqual(["2.0.93", "2.0.97", "2.0.100"])
    expect(points()[0]!.getAttribute("aria-pressed")).toBe("true")
    // Shown as text: markup in notes is never drawn.
    expect(screen.getByText("• <b>Fixes</b>.")).toBeTruthy()
    expect(screen.getByText("And <i>this</i> too.")).toBeTruthy()
    fireEvent.click(points()[1]!)
    expect(screen.getByRole("heading", { name: "Every platform" })).toBeTruthy()
    expect(screen.getByText("• /btw side questions.")).toBeTruthy()
  })

  it("marks the version you run, newer ones not installed, and those new since you last looked", async () => {
    localStorage.setItem(SEEN_KEY, "2026-11-06T12:00:00Z")
    api.mockResolvedValue({ ok: true, status: 200, data: { releases } })
    render(<ChangelogPanel current="2.0.97" />)
    await screen.findByRole("list", { name: "Releases, oldest first" })
    const [old, mine, newer] = points()
    expect(old!.getAttribute("aria-label")).toBe("Version 2.0.93, released 5 Nov 2026")
    expect(mine!.getAttribute("aria-label")).toBe("Version 2.0.97, released 6 Nov 2026, this version")
    expect(newer!.getAttribute("aria-label")).toBe("Version 2.0.100, released 7 Nov 2026, not installed yet, new since you last looked")
    // Opening it is noted, for next time.
    expect(Date.parse(localStorage.getItem(SEEN_KEY)!)).toBeGreaterThan(Date.parse("2026-11-07T00:00:00Z"))
  })

  it("moves between releases with the arrow keys, Home and End", async () => {
    api.mockResolvedValue({ ok: true, status: 200, data: { releases } })
    render(<ChangelogPanel current="2.0.97" />)
    const list = await screen.findByRole("list", { name: "Releases, oldest first" })
    fireEvent.keyDown(list, { key: "ArrowRight" })
    expect(screen.getByRole("heading", { name: "2.0.100, released 7 Nov 2026" })).toBeTruthy()
    fireEvent.keyDown(list, { key: "Home" })
    expect(points()[0]!.getAttribute("aria-pressed")).toBe("true")
    expect(points()[0]!.getAttribute("tabindex")).toBe("0")
    expect(points()[1]!.getAttribute("tabindex")).toBe("-1")
  })

  it("says when it shows the copy last read because GitHub could not be reached, and reads again on request", async () => {
    api.mockResolvedValue({ ok: true, status: 200, data: { releases, readAt: "2026-11-05T09:00:00Z", offline: true } })
    render(<ChangelogPanel />)
    expect((await screen.findByRole("status")).textContent).toMatch(/as last read on 5 Nov 2026/)
    fireEvent.click(screen.getByRole("button", { name: "Read it again" }))
    expect(api).toHaveBeenLastCalledWith("GET", "/api/changelog?fresh=1")
  })

  it("orders versions by their numbers, not as text", () => {
    expect(compareVersions("2.0.100", "2.0.97")).toBeGreaterThan(0)
    expect(compareVersions("2.1.0", "2.0.99")).toBeGreaterThan(0)
    expect(compareVersions("2.0.9", "2.0.9")).toBe(0)
  })
})
