// @vitest-environment jsdom
// Owner, 18 Nov: when Codehouse and CNW speak different versions of their protocol, Settings, Neighbourhood Watch says
// which needs updating, in words, rather than leaving histories to go missing quietly.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NeighbourhoodWatchPanel, UPDATE_TEXT } from "../src/components/NeighbourhoodWatchPanel"

let status: Record<string, unknown> = {}
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: true, status: 200, data: status })) }))
afterEach(cleanup)

describe("Settings, Neighbourhood Watch", () => {
  it("says which side needs updating when the protocols differ, and nothing when they match", async () => {
    status = { paired: true, on: true, url: "https://192.168.1.225:8443", state: "connected", needsUpdate: "cnw" }
    render(<NeighbourhoodWatchPanel />)
    expect((await screen.findByRole("status")).textContent).toBe(UPDATE_TEXT.cnw)
    cleanup()
    status = { paired: true, on: true, url: "https://192.168.1.225:8443", state: "connected" }
    render(<NeighbourhoodWatchPanel />)
    await screen.findByText("Connected")
    expect(screen.queryByRole("status")).toBeNull()
  })
})
