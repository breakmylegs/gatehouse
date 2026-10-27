// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Devices } from "../src/surfaces/Devices"

type Call = { method: string; url: string; body?: unknown }
const calls: Call[] = []
let routes: Record<string, (c: Call) => { ok: boolean; data?: unknown; error?: string }> = {}

vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    const c = { method, url, body }
    calls.push(c)
    const h = routes[`${method} ${url}`] ?? routes[`${method} ${url.replace(/\/[^/]+$/, "/:id")}`]
    return h ? { status: 200, ...h(c) } : { ok: false, status: 404, error: "no route" }
  }),
}))

beforeEach(() => {
  calls.length = 0
  routes = {}
})
afterEach(cleanup)

const connected = (phones: unknown[] = []) => ({
  ok: true,
  data: { health: { state: "connected", devices: phones.length }, phones },
})

describe("Devices page", () => {
  it("asks for the Relay address and the one-time token before anything else, and shows the Relay's refusal", async () => {
    routes["GET /api/relay"] = () => ({
      ok: true,
      data: { health: { state: "not-configured", devices: 0 }, phones: [] },
    })
    routes["POST /api/relay/setup"] = () => ({
      ok: false,
      error: "That enrolment token is not valid",
    })
    render(<Devices />)
    await userEvent.type(await screen.findByLabelText("Relay address"), "https://gh.example.com")
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/One-time enrolment token/), "abc123")
    await userEvent.click(screen.getByRole("button", { name: "Connect" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/not valid/)
    expect(calls.find((c) => c.url === "/api/relay/setup")?.body).toMatchObject({
      url: "https://gh.example.com",
      enrolToken: "abc123",
    })
  })

  it("shows the pairing code, then the six digits, and pairs only when the user says they match", async () => {
    let status = "waiting"
    routes["GET /api/relay"] = () => connected()
    routes["POST /api/relay/pairing"] = () => ({
      ok: true,
      data: { id: "p1", code: "ABCD2345", status: "waiting", expiresAt: "x" },
    })
    routes["GET /api/relay/pairing/:id"] = () => ({
      ok: true,
      data:
        status === "waiting"
          ? { id: "p1", code: "ABCD2345", status }
          : {
              id: "p1",
              code: "ABCD2345",
              status,
              phoneName: "Peter's iPhone",
              fingerprint: "481516",
            },
    })
    routes["POST /api/relay/pairing/:id/confirm"] = () => ({ ok: true, data: { ok: true } })
    render(<Devices />)
    await userEvent.click(await screen.findByRole("button", { name: "Show a pairing code" }))
    expect(await screen.findByText("ABCD2345")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /They match/ })).toBeNull()
    status = "awaiting-confirmation"
    expect(await screen.findByText("481516", {}, { timeout: 6000 })).toBeInTheDocument()
    expect(calls.some((c) => c.url.endsWith("/confirm"))).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: /They match/ }))
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url === "/api/relay/pairing/p1/confirm"),
      ).toBe(true),
    )
  })

  it("cancelling at the six digits never confirms", async () => {
    routes["GET /api/relay"] = () => connected()
    routes["POST /api/relay/pairing"] = () => ({
      ok: true,
      data: {
        id: "p2",
        code: "ZZZZ2222",
        status: "awaiting-confirmation",
        phoneName: "Phone",
        fingerprint: "123456",
        expiresAt: "x",
      },
    })
    routes["DELETE /api/relay/pairing/:id"] = () => ({ ok: true, data: { ok: true } })
    render(<Devices />)
    await userEvent.click(await screen.findByRole("button", { name: "Show a pairing code" }))
    await userEvent.click(await screen.findByRole("button", { name: /They differ/ }))
    expect(calls.some((c) => c.url.endsWith("/confirm"))).toBe(false)
    expect(calls.some((c) => c.method === "DELETE")).toBe(true)
  })

  it("lists phones, renames one, and asks before revoking", async () => {
    const phone = { id: "ph1", name: "Peter's iPhone", pairedAt: "2026-10-01T10:00:00Z" }
    routes["GET /api/relay"] = () => connected([phone])
    routes["PUT /api/relay/phones/:id"] = () => ({ ok: true, data: { ok: true } })
    routes["DELETE /api/relay/phones/:id"] = () => ({
      ok: true,
      data: { ok: true, removed: true, relayNotified: true },
    })
    render(<Devices />)
    expect(await screen.findByText("Peter's iPhone")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Rename" }))
    const box = screen.getByLabelText("New name")
    await userEvent.clear(box)
    await userEvent.type(box, "Work phone")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ name: "Work phone" }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Revoke…" }))
    expect(calls.some((c) => c.method === "DELETE")).toBe(false)
    expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus()
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/relay/phones/ph1")).toBe(
        true,
      ),
    )
  })

  it("says plainly when the Relay cannot be reached, and that desktop decisions still work", async () => {
    routes["GET /api/relay"] = () => ({
      ok: true,
      data: { health: { state: "unreachable", devices: 1 }, phones: [] },
    })
    render(<Devices />)
    expect((await screen.findByRole("status")).textContent).toMatch(/cannot be reached.*still work/)
  })
})
