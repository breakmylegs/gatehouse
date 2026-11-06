// @vitest-environment jsdom
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

describe("settings save as you change them", () => {
  it("saves a switch by itself, once, keeping settings this page does not show", async () => {
    render(<Settings />)
    await openSection("Sessions")
    const burst = await screen.findByRole("checkbox", { name: /first edit after a quiet spell/ })
    fireEvent.click(burst)
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({
      checkpoints: { beforeEscalation: true, editBursts: false },
      expectedOrg: "Example Ltd",
      futureSetting: { keep: true },
    })
    await waitFor(() => expect(toasts).toEqual(["Checkpoints saved"]))
    expect(screen.queryByRole("button", { name: /save settings/i })).toBeNull()
  })

  it("sets Extreme approval's limits, with No limit kept readable by an older version", async () => {
    render(<Settings />)
    await openSection("Sessions")
    const spend = await screen.findByRole("combobox", { name: "Most spending" })
    expect((spend as HTMLSelectElement).value).toBe("500")
    fireEvent.change(spend, { target: { value: "none" } })
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]?.extremeCarryOn).toEqual({ turns: 200, usd: 1000, noSpendLimit: true })
    await waitFor(() => expect(toasts).toEqual(["Extreme approval saved"]))
  })

  it("sets where sessions pause for the plan limit, and says what Never can cost", async () => {
    render(<Settings />)
    await openSection("Sessions")
    const at = await screen.findByRole("combobox", { name: /5-hour limit reaches/ })
    expect((at as HTMLSelectElement).value).toBe("95")
    expect(screen.queryByRole("note")).toBeNull()
    fireEvent.change(at, { target: { value: "off" } })
    await waitFor(() => expect(puts).toHaveLength(1))
    // A percentage stays beside off, for a version that reads only that.
    expect(puts[0]?.planLimitPause).toEqual({ percent: 95, off: true })
    expect(screen.getByRole("note").textContent).toMatch(/charged as extra usage/)
  })

  it("sets the output style new coding sessions start with, by name, and leaves out a name it cannot use", async () => {
    render(<Settings />)
    await openSection("Sessions")
    const style = await screen.findByRole("combobox", { name: /How Claude writes its answers/ })
    expect((style as HTMLSelectElement).value).toBe("")
    fireEvent.change(style, { target: { value: "Explanatory" } })
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]?.outputStyle).toBe("Explanatory")
    fireEvent.change(style, { target: { value: "own" } })
    const name = await screen.findByRole("textbox", { name: /Your style's name/ })
    fireEvent.change(name, { target: { value: "../notes" } })
    fireEvent.blur(name)
    await waitFor(() => expect(puts.at(-1)).not.toHaveProperty("outputStyle"))
    fireEvent.change(name, { target: { value: "Team notes" } })
    fireEvent.blur(name)
    await waitFor(() => expect(puts.at(-1)?.outputStyle).toBe("Team notes"))
  })

  it("saves a typed box when you leave it, not while you type, and not again when nothing changed", async () => {
    render(<Settings />)
    await openSection("Account and plan")
    const org = await screen.findByRole("textbox", { name: /Expected organisation/ })
    fireEvent.change(org, { target: { value: "Example" } })
    fireEvent.change(org, { target: { value: "Example Group" } })
    await new Promise((r) => setTimeout(r, 400))
    expect(puts).toHaveLength(0)
    fireEvent.blur(org)
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]?.expectedOrg).toBe("Example Group")
    fireEvent.blur(org)
    await new Promise((r) => setTimeout(r, 50))
    expect(puts).toHaveLength(1)
    await waitFor(() => expect(toasts).toEqual(["Expected organisation saved"]))
  })

  it("saves what every session is told, and leaves it out when it is emptied (W1-07)", async () => {
    render(<Settings />)
    await openSection("Sessions")
    const box = await screen.findByRole("textbox", { name: /What every session is told/ })
    fireEvent.change(box, { target: { value: "Be brief." } })
    expect(puts).toHaveLength(0)
    fireEvent.blur(box)
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ globalInstructions: "Be brief.", expectedOrg: "Example Ltd" })
    fireEvent.change(box, { target: { value: "   " } })
    fireEvent.blur(box)
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]).not.toHaveProperty("globalInstructions")
  })

  it("saves a one-line box on Enter", async () => {
    render(<Settings />)
    await openSection("Phone and notifications")
    const minutes = await screen.findByRole("spinbutton", { name: /Phone request expires/ })
    fireEvent.change(minutes, { target: { value: "5" } })
    fireEvent.keyDown(minutes, { key: "Enter" })
    await waitFor(() => expect(puts[0]?.phoneExpiryMs).toBe(300_000))
  })

  it("says what the Host refused, keeps what you typed, and tries again on the next change", async () => {
    refuse = "hardTimeoutMs: must be at least 1 minute"
    render(<Settings />)
    await openSection("Phone and notifications")
    const box = await screen.findByRole("spinbutton", { name: /Desktop request times out/ })
    fireEvent.change(box, { target: { value: "0" } })
    fireEvent.blur(box)
    expect(await screen.findByText("hardTimeoutMs: must be at least 1 minute")).toBeTruthy()
    expect(toasts).toEqual([
      "error: Desktop timeout not saved: hardTimeoutMs: must be at least 1 minute",
    ])
    expect((box as HTMLInputElement).value).toBe("0")
    refuse = undefined
    fireEvent.change(box, { target: { value: "20" } })
    fireEvent.blur(box)
    await waitFor(() => expect(puts.at(-1)?.hardTimeoutMs).toBe(1_200_000))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })
})
