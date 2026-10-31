// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Settings } from "../src/surfaces/Settings"

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
vi.mock("../src/components/JcvcPicker", () => ({ JcvcPicker: () => null }))

beforeEach(() => {
  puts.length = 0
  toasts.length = 0
  refuse = undefined
})
afterEach(cleanup)

describe("settings save as you change them", () => {
  it("saves a switch by itself, once, keeping settings this page does not show", async () => {
    render(<Settings />)
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
    const spend = await screen.findByRole("combobox", { name: "Most spending" })
    expect((spend as HTMLSelectElement).value).toBe("500")
    fireEvent.change(spend, { target: { value: "none" } })
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]?.extremeCarryOn).toEqual({ turns: 200, usd: 1000, noSpendLimit: true })
    await waitFor(() => expect(toasts).toEqual(["Extreme approval saved"]))
  })

  it("saves a typed box when you leave it, not while you type, and not again when nothing changed", async () => {
    render(<Settings />)
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

  it("saves a one-line box on Enter", async () => {
    render(<Settings />)
    const minutes = await screen.findByRole("spinbutton", { name: /Phone request expires/ })
    fireEvent.change(minutes, { target: { value: "5" } })
    fireEvent.keyDown(minutes, { key: "Enter" })
    await waitFor(() => expect(puts[0]?.phoneExpiryMs).toBe(300_000))
  })

  it("says what the Host refused, keeps what you typed, and tries again on the next change", async () => {
    refuse = "hardTimeoutMs: must be at least 1 minute"
    render(<Settings />)
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
