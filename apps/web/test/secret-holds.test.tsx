// @vitest-environment jsdom
// O59 (owner, 27 Nov): Settings, Safety, Held for secrets: what secret-in-commit last held in each repository, never a
// value; Allow once for one finding asks you first, then tells the Host, which records it; Clear forgets them.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const sent: Array<{ type: string } & Record<string, unknown>> = []
let held = [
  {
    repo: "C:/dev/peter",
    at: "2026-11-27T10:00:00Z",
    findings: [{ kind: "a password in a web address", file: "scripts/update.sh", line: 496, commit: "71a1293", branch: "deploy-alignment", allowedOnce: false }],
  },
]
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: { type: string } & Record<string, unknown>) => {
      sent.push(cmd)
      if (cmd.type === "secret_holds") return { ok: true, data: { repos: held } }
      if (cmd.type === "secret_allow_once") held = held.map((h) => ({ ...h, findings: h.findings.map((f) => ({ ...f, allowedOnce: true })) }))
      if (cmd.type === "secret_holds_clear") held = []
      return { ok: true, data: {} }
    }),
  }
})
const { SecretHoldsPanel } = await import("../src/components/SecretHoldsPanel")

afterEach(() => {
  cleanup()
  sent.length = 0
})

describe("Held for secrets (O59)", () => {
  it("shows each finding with its file, line, commit and branch, and allows one once after you confirm", async () => {
    render(<SecretHoldsPanel />)
    const list = await screen.findByRole("list", { name: "Held for secrets" })
    expect(within(list).getByText(/a password in a web address in scripts\/update.sh, line 496 of commit 71a1293 on branch deploy-alignment/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /^Allow once:/ }))
    // Nothing is sent until you say it is not a secret.
    expect(sent.filter((c) => c.type === "secret_allow_once")).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Yes, it is not a secret" }))
    await waitFor(() =>
      expect(sent).toContainEqual({ type: "secret_allow_once", repo: "C:/dev/peter", kind: "a password in a web address", file: "scripts/update.sh", line: 496 }),
    )
    expect(await screen.findByText("Allowed once, for the next commit or push")).toBeTruthy()
  })

  it("clears a repository's holds", async () => {
    render(<SecretHoldsPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }))
    await waitFor(() => expect(sent).toContainEqual({ type: "secret_holds_clear", repo: "C:/dev/peter" }))
    expect(await screen.findByText(/Nothing is held/)).toBeTruthy()
  })
})
