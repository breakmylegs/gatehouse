// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Approver } from "../src/surfaces/Approver"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url === "/api/approver")
      return {
        ok: true,
        status: 200,
        data: {
          state: "up",
          supervised: true,
          policy: { hash: "abcdef0123456789", errors: [], overlays: [], remembered: 2 },
          pwsh: { running: true, languageMode: "ConstrainedLanguage" },
          tools: [{ name: "evaluate_permission", purpose: "Decides one permission request." }],
          recent: [
            {
              seq: 1,
              ts: "2026-10-28T10:00:00Z",
              tool: "Bash",
              project: "atlas",
              outcome: "allow",
              ruleId: "read-only-git",
              reason: "A read-only git command.",
              risk: 5,
              latencyMs: 12,
            },
          ],
        },
      }
    if (url === "/api/policy/test")
      return {
        ok: true,
        status: 200,
        data: { outcome: "escalate", ruleId: "no-rule", reason: "No rule matched.", risk: 50 },
      }
    if (url === "/api/approver/restart") return { ok: true, status: 200, data: { state: "up" } }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

beforeEach(() => {
  calls.length = 0
})
afterEach(cleanup)

describe("the Approver workbench", () => {
  it("shows its state, policy, tools and what it decided", async () => {
    render(<Approver />)
    expect(await screen.findByText("Running")).toBeTruthy()
    expect(screen.getByText("abcdef012345")).toBeTruthy()
    expect(screen.getByText("evaluate_permission")).toBeTruthy()
    expect(screen.getByText("read-only-git")).toBeTruthy()
    expect(screen.getByText("Allowed")).toBeTruthy()
  })

  it("runs a dry test through the policy and shows the verdict", async () => {
    render(<Approver />)
    await screen.findByText("Running")
    fireEvent.click(screen.getByRole("button", { name: "Try it" }))
    expect(await screen.findByText("No rule matched.")).toBeTruthy()
    const test = calls.find((c) => c.url === "/api/policy/test")
    expect(test?.body).toMatchObject({
      toolName: "Bash",
      input: { command: "npm install left-pad" },
    })
  })

  it("restarts only after you confirm", async () => {
    render(<Approver />)
    await screen.findByText("Running")
    fireEvent.click(screen.getByRole("button", { name: "Restart the Approver" }))
    expect(calls.some((c) => c.url === "/api/approver/restart")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Yes, restart" }))
    await waitFor(() => expect(calls.some((c) => c.url === "/api/approver/restart")).toBe(true))
  })
})
