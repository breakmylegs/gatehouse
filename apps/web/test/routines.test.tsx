// @vitest-environment jsdom
// B34: routines in Settings: listed, added, switched off and removed.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RoutinesPanel } from "../src/components/RoutinesPanel"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let routines: Array<Record<string, unknown>> = []
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url === "/api/routines" && method === "GET")
      return { ok: true, status: 200, data: { routines } }
    return { ok: true, status: 200, data: {} }
  }),
}))

beforeEach(() => {
  calls.length = 0
  routines = [
    {
      id: "r1",
      name: "Triage",
      folder: "C:/dev/shop",
      prompt: "Sort the issues.",
      time: "07:30",
      days: ["mon", "fri"],
      enabled: true,
      lastRun: "2026-11-03",
    },
  ]
})
afterEach(cleanup)

describe("routines in Settings", () => {
  it("lists each with when it runs, and switches one off or removes it", async () => {
    render(<RoutinesPanel />)
    const list = await screen.findByRole("list", { name: "Your routines" })
    expect(list.textContent).toMatch(/Triage.*07:30, mon fri, C:\/dev\/shop, last ran 2026-11-03/)
    fireEvent.click(within(list).getByRole("checkbox", { name: "On" }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({
        id: "r1",
        enabled: false,
      }),
    )
    fireEvent.click(within(list).getByRole("button", { name: "Remove Triage" }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/routines/r1")).toBe(true),
    )
  })

  it("adds one on weekdays by default", async () => {
    routines = []
    render(<RoutinesPanel />)
    const form = await screen.findByRole("form", { name: "Add a routine" })
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), {
      target: { value: "Nightly build" },
    })
    fireEvent.change(within(form).getByRole("textbox", { name: "Folder" }), {
      target: { value: "C:\\dev\\app" },
    })
    fireEvent.change(within(form).getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Build it." },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Add the routine" }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        name: "Nightly build",
        folder: "C:\\dev\\app",
        prompt: "Build it.",
        time: "08:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        extreme: false,
        enabled: true,
      }),
    )
  })
})
