// @vitest-environment jsdom
// ADR 0020: a computer that refused CNW's certificate says so plainly, and can trust it again in place: it is shown the
// root's fingerprint first, and confirms exactly that one.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NeighbourhoodWatchPanel } from "../src/components/NeighbourhoodWatchPanel"

const FP = "AB12 CD34 EF56"
const posted: Array<[string, unknown]> = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    if (url === "/api/cnw") return { ok: true, status: 200, data: { paired: true, on: true, url: "https://192.168.1.225", state: "refused", refusal: "certificate", trust: "leaf" } }
    if (method === "GET" && url === "/api/cnw/trust-again") return { ok: true, status: 200, data: { kind: "root", root: FP } }
    posted.push([url, body])
    return { ok: true, status: 200, data: { paired: true, on: true, url: "https://192.168.1.225", state: "connecting", trust: "root", root: FP } }
  }),
}))
afterEach(cleanup)

describe("trusting CNW's certificate again (ADR 0020)", () => {
  it("says the certificate changed, shows the fingerprint, and confirms only that one", async () => {
    render(<NeighbourhoodWatchPanel />)
    expect(await screen.findByText(/CNW's certificate changed, so nothing was sent\. Trust it again, or pair again\./)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Trust CNW's certificate again" }))
    expect(await screen.findByText(FP)).toBeTruthy()
    expect(posted).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "It matches: trust it" }))
    await waitFor(() => expect(posted).toEqual([["/api/cnw/trust-again", { fingerprint: FP }]]))
  })
})
