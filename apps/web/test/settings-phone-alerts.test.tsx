// @vitest-environment jsdom
// Mac fork (owner, 12 Nov): Settings, Phone and notifications chooses whether the phone hears only of decisions.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Settings } from "../src/surfaces/Settings"

/** Settings opens one section at a time: go to the one that holds the setting. */
async function openSection(name: string) {
  const nav = await screen.findByRole("navigation", { name: "Settings sections" })
  fireEvent.click(within(nav).getByRole("button", { name: new RegExp(`^${name}`) }))
}

const puts: Array<Record<string, unknown>> = []
let refuse: string | undefined
const toasts: string[] = []

vi.mock("sonner", () => {
  const t = Object.assign((m: string) => toasts.push(m), {
    error: (m: string) => toasts.push(`error: ${m}`),
  })
  return { toast: t, Toaster: () => null }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: Record<string, unknown>) => {
    if (url === "/api/settings" && method === "GET")
      return {
        ok: true,
        status: 200,
        data: {
          path: "C:\\Users\\x\\AppData\\Local\\Gatehouse\\config.json",
          // A key this page does not show, written by a newer version: it must survive a save.
          saved: { expectedOrg: "Example Ltd", futureSetting: { keep: true } },
          running: {
            redactTerms: ["acme"],
            phoneExpiryMs: 600_000,
            hardTimeoutMs: 1_800_000,
            digestTime: "08:00",
            checkpoints: { beforeEscalation: true, editBursts: true, burstWindowMs: 60_000 },
          },
          workspaceRootsInEffect: [],
          quietHoursInPolicy: null,
        },
      }
    if (url === "/api/settings" && method === "PUT") {
      puts.push(body as Record<string, unknown>)
      return refuse
        ? { ok: false, status: 422, errors: [refuse] }
        : { ok: true, status: 200, data: { restartRequired: false } }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
vi.mock("../src/lib/update", async (orig) => ({
  ...(await orig<typeof import("../src/lib/update")>()),
  updateCall: vi.fn(async () => undefined),
}))
vi.mock("../src/components/UpdatesPanel", () => ({ UpdatesPanel: () => null }))

beforeEach(() => {
  puts.length = 0
  toasts.length = 0
  refuse = undefined
})
afterEach(cleanup)

describe("what the phone is told", () => {
  it("saves decisions only when chosen, and leaves the setting out again for everything", async () => {
    render(<Settings />)
    await openSection("Phone and notifications")
    const everything = await screen.findByRole("radio", { name: /^Everything/ })
    // Its own group, the first one the section shows, so it is the first thing you see there.
    const shown = [
      ...document.querySelectorAll<HTMLFieldSetElement>("fieldset:not([hidden]) > legend"),
    ]
    expect(shown[0]?.textContent).toMatch(/^Phone notifications/)
    expect(everything.closest("fieldset")?.querySelector("legend")?.textContent).toMatch(
      /^Phone notifications/,
    )
    expect(everything).toBeChecked()
    fireEvent.click(screen.getByRole("radio", { name: /^Only decisions waiting for you/ }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ phoneAlerts: "decisions", futureSetting: { keep: true } })
    fireEvent.click(everything)
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]).not.toHaveProperty("phoneAlerts")
  })
})
