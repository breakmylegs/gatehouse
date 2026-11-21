// @vitest-environment jsdom
// D-067: the migration panel plans waves, and a wave cannot be handed to Claude or compared before it is captured.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
const plan = { id: "abcdef012345", goal: "Move to ES modules", waves: [{ n: 1, files: [{ file: "src/util.js", callable: true }] }] }
let captured = false
vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }) }))
vi.mock("../src/store", () => ({
  send: vi.fn(async (cmd: Record<string, unknown>) => {
    sent.push(cmd)
    if (cmd.type === "migration_wave" && cmd.step === "capture") captured = true
    const files = [{ file: "src/util.js", callable: true, ...(captured ? { captured: "t" } : {}) }]
    return {
      ok: true,
      data: { plan: { ...plan, waves: [{ n: 1, files }] }, states: [{ toCapture: captured ? [] : ["src/util.js"], toCompare: captured ? ["src/util.js"] : [], done: false, changed: 0 }] },
    }
  }),
}))

import { MigrationPanel } from "../src/components/MigrationPanel"

afterEach(() => {
  cleanup()
  sent.length = 0
  captured = false
})

describe("the migration panel", () => {
  it("plans waves, and asks for a capture before Claude does a wave or it is compared", async () => {
    render(<MigrationPanel sessionId="s1" onClose={() => undefined} />)
    fireEvent.change(screen.getByLabelText("What the migration is"), { target: { value: "Move to ES modules" } })
    fireEvent.click(screen.getByRole("button", { name: "Plan it in waves" }))
    expect(await screen.findByText("Wave 1: 1 file(s) to capture")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ask Claude to do this wave" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Compare after" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Capture before" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask Claude to do this wave" })).toBeEnabled())
    expect(screen.getByText("Wave 1: 1 file(s) to compare")).toBeTruthy()
    expect(sent.map((c) => c.type === "migration_wave" ? c.step : c.type)).toEqual(["migration_plan", "capture"])
    expect(sent[0]).toMatchObject({ folder: "src", goal: "Move to ES modules" })
  })
})
