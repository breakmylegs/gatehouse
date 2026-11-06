// @vitest-environment jsdom
// Settings in sections, with search and a marker on what differs from the default (owner, 31 Oct, W1-04).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Settings } from "../src/surfaces/Settings"

let changed = false

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string) => {
    if (url === "/api/settings" && method === "GET")
      return {
        ok: true,
        status: 200,
        data: {
          path: "C:\\Users\\x\\AppData\\Local\\Gatehouse\\config.json",
          // Nothing changed: what the Host itself starts with.
          saved: changed ? { expectedOrg: "ACN - Premium" } : {},
          running: {
            redactTerms: changed ? ["acme"] : [],
            phoneExpiryMs: changed ? 1_200_000 : 600_000,
            hardTimeoutMs: 1_800_000,
            checkpoints: { beforeEscalation: true, editBursts: true, burstWindowMs: 60_000 },
            extremeCarryOn: { turns: 200, usd: 500 },
          },
          workspaceRootsInEffect: [],
          quietHoursInPolicy: null,
        },
      }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
vi.mock("../src/components/UpdatesPanel", () => ({ UpdatesPanel: () => <p>Updates panel</p> }))

beforeEach(() => {
  localStorage.clear()
  changed = false
})
afterEach(cleanup)

const nav = async () => within(await screen.findByRole("navigation", { name: "Settings sections" }))
const group = (name: string) => screen.queryByRole("group", { name })
const open = async (name: RegExp | string) =>
  fireEvent.click((await nav()).getByRole("button", { name }))
const search = async (text: string) =>
  fireEvent.change(await screen.findByRole("searchbox", { name: "Search settings" }), {
    target: { value: text },
  })

describe("Settings in sections", () => {
  it("opens on General, shows one section at a time, and keeps the one you left it on", async () => {
    const { unmount } = render(<Settings />)
    const list = await nav()
    // Grouped as in Claude's desktop app (owner, 4 Nov): Preferences, This computer, Customize.
    expect(list.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Preferences",
      "This computer",
      "Customize",
    ])
    expect(list.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "General",
      "Account and plan",
      "Privacy",
      "Usage",
      "Capabilities",
      "Sessions",
      "Phone and notifications",
      "System",
      "Updates",
      "Changelog",
      "Developer",
      "Skills",
      "Connectors",
      "Plugins",
    ])
    expect(list.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("page")
    expect(group("Setup")).toBeTruthy()
    expect(group("Organisation and workspaces")).toBeNull()
    await open("Sessions")
    expect(group("Extreme approval")).toBeTruthy()
    expect(group("Setup")).toBeNull()
    unmount()
    render(<Settings />)
    expect(await screen.findByRole("group", { name: /Extreme approval/ })).toBeTruthy()
    expect(
      (await nav()).getByRole("button", { name: "Sessions" }).getAttribute("aria-current"),
    ).toBe("page")
  })

  it("puts every setting in a section, so none is lost", async () => {
    render(<Settings />)
    const seen = new Set<string>()
    for (const name of [
      "General",
      "Account and plan",
      "Privacy",
      "Usage",
      "Capabilities",
      "Sessions",
      "Phone and notifications",
      "System",
      "Updates",
      "Changelog",
      "Developer",
      "Skills",
      "Connectors",
      "Plugins",
    ]) {
      await open(name)
      for (const g of screen.getAllByRole("group"))
        seen.add(g.querySelector("legend")?.textContent ?? "")
    }
    for (const title of [
      "Organisation and workspaces",
      "Quiet hours and timeouts",
      "Extreme approval",
      "Daily digest",
      "Redaction list",
      "Checkpoints",
      "Updates",
      "Changelog",
      "Output style",
      "Worktree location",
      "Setup",
      "Notifications",
      "Appearance",
      "Your usage limits",
      "Memory",
      "Quick prompt",
      "Temporary files",
      "Telemetry",
      "Local MCP servers",
      "Skills",
      "Plugins",
    ])
      expect(
        [...seen].some((t) => t.startsWith(title)),
        title,
      ).toBe(true)
  })
})

describe("searching Settings", () => {
  it("finds a setting by its label, across sections, and marks it", async () => {
    render(<Settings />)
    await screen.findByRole("navigation", { name: "Settings sections" })
    await search("Most spending")
    expect(group("Extreme approval")).toBeTruthy()
    expect(group("Setup")).toBeNull()
    expect(screen.getByText("Most spending").closest("label")?.getAttribute("data-match")).toBe(
      "true",
    )
    // The section list gives way to the results while a search is typed.
    expect((await nav()).queryByRole("button", { current: "page" })).toBeNull()
  })

  it("finds a setting by its help text", async () => {
    render(<Settings />)
    await screen.findByRole("navigation", { name: "Settings sections" })
    await search("belongs to this organisation")
    expect(group("Organisation and workspaces")).toBeTruthy()
    expect(group("Extreme approval")).toBeNull()
  })

  it("says so when nothing matches, and clearing the box brings the section back", async () => {
    render(<Settings />)
    await screen.findByRole("navigation", { name: "Settings sections" })
    await search("zzzz")
    expect(await screen.findByText(/Nothing in Settings matches/)).toBeTruthy()
    await search("")
    expect(screen.queryByText(/Nothing in Settings matches/)).toBeNull()
    expect(group("Setup")).toBeTruthy()
  })
})

describe("what differs from the default", () => {
  it("shows no marker when nothing has changed", async () => {
    render(<Settings />)
    await nav()
    for (const name of ["Account and plan", "Sessions", "Phone and notifications", "Privacy"]) {
      await open(name)
      expect(screen.queryByText("Changed from the default"), name).toBeNull()
    }
    expect(screen.queryByText("Changed")).toBeNull()
  })

  it("marks the group and its section when a setting differs", async () => {
    changed = true
    render(<Settings />)
    const list = await nav()
    expect(list.getByRole("button", { name: /^Account and plan/ }).textContent).toContain("Changed")
    expect(list.getByRole("button", { name: /^Phone and notifications/ }).textContent).toContain(
      "Changed",
    )
    expect(list.getByRole("button", { name: /^Privacy/ }).textContent).toContain("Changed")
    expect(list.getByRole("button", { name: /^Sessions/ }).textContent).not.toContain("Changed")
    await open(/^Account and plan/)
    expect(
      screen.getByRole("group", { name: /Organisation and workspaces/ }).textContent,
    ).toContain("Changed from the default")
  })
})
