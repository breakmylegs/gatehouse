// @vitest-environment jsdom
// D-026: rules that would allow what was refused or asked about in the last 90 days are not saved; the editor lists
// those calls and saves them only when you type the phrase.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const puts: Array<Record<string, unknown>> = []
vi.mock("sonner", () => ({ toast: () => undefined, Toaster: () => null }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: Record<string, unknown>) => {
    if (method === "PUT" && url === "/api/policy/rules") {
      puts.push(body ?? {})
      if (body?.confirm === "allow 1") return { ok: true, status: 200, data: { hash: "h2" } }
      return {
        ok: false,
        status: 409,
        error: 'These rules would allow 1 of the 4 calls refused or asked about in the last 90 days, so they were not saved. Type "allow 1" to save them anyway.',
        detail: {
          regression: {
            total: 4,
            phrase: "allow 1",
            changes: [
              {
                line: 7,
                summary: "Bash: echo hello",
                before: { outcome: "escalate", ruleId: "no-rule" },
                after: { outcome: "allow", ruleId: "safe-shell" },
              },
            ],
          },
        },
      }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

import { Edit } from "../src/surfaces/Policy"

afterEach(() => {
  cleanup()
  puts.length = 0
})

describe("saving rules that would allow what was refused (D-026)", () => {
  it("lists the calls and saves only with the typed phrase", async () => {
    const onActivated = vi.fn(async () => undefined)
    render(<Edit data={{ rulesYaml: "version: 1\n", rulesYamlHash: "h1" } as never} onActivated={onActivated} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Rules (YAML)" }), {
      target: { value: "version: 1\n# looser\n" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Review diff" }))
    fireEvent.click(screen.getByRole("button", { name: "Activate these rules" }))
    const panel = await screen.findByRole("region", { name: "Would allow what was refused" })
    expect(panel.textContent).toContain("Bash: echo hello")
    expect(panel.textContent).toContain("escalate to allow")
    const save = screen.getByRole("button", { name: "Save them anyway" })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox", { name: /To save them anyway, type/ }), {
      target: { value: "allow 1" },
    })
    fireEvent.click(save)
    await waitFor(() => expect(onActivated).toHaveBeenCalled())
    expect(puts.map((p) => p.confirm)).toEqual([undefined, "allow 1"])
  })
})
