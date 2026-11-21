// @vitest-environment jsdom
// D-024: rules that take out a deny or an ask are saved only with their typed phrase, and then apply after the wait;
// the page says what waits and lets you cancel it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const puts: Array<Record<string, unknown>> = []
const pending: Array<{ id: string; what: string; appliesAt: string }> = []
vi.mock("sonner", () => ({ toast: () => undefined, Toaster: () => null }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: Record<string, unknown>) => {
    if (method === "PUT" && url === "/api/policy/rules") {
      puts.push(body ?? {})
      if (body?.loosen === "loosen remove no-ftp") {
        pending.push({ id: "l1", what: "remove no-ftp", appliesAt: "2026-11-21T10:10:00Z" })
        return { ok: true, status: 202, data: { pending: pending[0] } }
      }
      return { ok: false, status: 409, error: "This loosens", detail: { loosening: { what: "remove no-ftp", phrase: "loosen remove no-ftp", minutes: 10 } } }
    }
    if (method === "GET" && url === "/api/loosening") return { ok: true, status: 200, data: { pending: [...pending] } }
    if (method === "POST" && url === "/api/loosening/l1/cancel") {
      pending.length = 0
      return { ok: true, status: 200, data: { pending: [...pending] } }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

import { Edit } from "../src/surfaces/Policy"

afterEach(() => {
  cleanup()
  puts.length = 0
  pending.length = 0
})

describe("saving rules that take out a deny (D-024)", () => {
  it("asks for the phrase, keeps the change to apply after the wait, and lets you cancel it", async () => {
    const onActivated = vi.fn(async () => undefined)
    render(<Edit data={{ rulesYaml: "version: 1\n", rulesYamlHash: "h1" } as never} onActivated={onActivated} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Rules (YAML)" }), { target: { value: "version: 1\n# no ftp rule\n" } })
    fireEvent.click(screen.getByRole("button", { name: "Review diff" }))
    fireEvent.click(screen.getByRole("button", { name: "Activate these rules" }))
    const go = await screen.findByRole("button", { name: "Loosen in 10 minutes" })
    expect(go).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox", { name: /To go ahead, type/ }), { target: { value: "loosen remove no-ftp" } })
    fireEvent.click(go)
    const list = await screen.findByRole("list", { name: "Waiting to loosen" })
    expect(list.textContent).toContain("remove no-ftp")
    expect(onActivated).not.toHaveBeenCalled()
    expect(puts.map((p) => p.loosen)).toEqual([undefined, "loosen remove no-ftp"])
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("list", { name: "Waiting to loosen" })).toBeNull())
  })
})
