// @vitest-environment jsdom
// E-099: the health score shows the worst factor's state as the whole, each factor's 30 days, and opens its source.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"

const days = (n: number) => [...new Array<number>(29).fill(0), n]
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({
    ok: true,
    data: {
      state: "fail",
      at: "",
      factors: [
        { id: "canaries", label: "Safety checks", state: "fail", detail: "The last run had a check failing.", trend: days(1), source: "doctor" },
        { id: "audit", label: "Audit log", state: "ok", detail: "The audit chain verifies.", trend: days(0), source: "audit" },
      ],
    },
  })),
}))

afterEach(cleanup)

describe("the health score", () => {
  it("shows the worst state as the whole, each factor's month, and opens a factor's source", async () => {
    const { HealthScore } = await import("../src/components/HealthScore")
    render(<HealthScore />)
    expect(await screen.findByRole("heading", { name: /Health: Not right/ })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Safety checks: 1 in 30 days" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Audit log" }))
    expect(useStore.getState().route).toBe("audit")
  })

  it("on the dashboard, lists only what needs looking at", async () => {
    const { HealthScore } = await import("../src/components/HealthScore")
    render(<HealthScore compact />)
    expect(await screen.findByText("Safety checks")).toBeInTheDocument()
    expect(screen.queryByText("Audit log", { selector: "strong" })).toBeNull()
  })
})
