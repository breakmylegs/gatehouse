// @vitest-environment jsdom
// The audit log (Stitch, R7): the chain check, the quick views, risk and rule on every row, and why a row was decided.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const asked: string[] = []
vi.mock("../src/lib/api", () => ({
  download: vi.fn(async () => undefined),
  api: vi.fn(async (_m: string, url: string) => {
    if (url === "/api/audit/verify")
      return {
        ok: true,
        status: 200,
        data: { ok: true, files: 2, records: 1234, problems: [], moreProblems: 0 },
      }
    if (url.startsWith("/api/audit?")) {
      asked.push(url)
      return { ok: true, status: 200, data: { records: [rec(2, "deny", 91), rec(1, "allow", 12)] } }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
// A stand-in table that draws every row.
vi.mock("react-virtuoso", () => ({
  TableVirtuoso: (p: {
    data: unknown[]
    fixedHeaderContent: () => ReactNode
    itemContent: (i: number, d: unknown) => ReactNode
  }) => (
    <table>
      <thead>{p.fixedHeaderContent()}</thead>
      <tbody>
        {p.data.map((d, i) => (
          <tr key={i}>{p.itemContent(i, d)}</tr>
        ))}
      </tbody>
    </table>
  ),
}))

function rec(seq: number, outcome: "allow" | "deny", risk: number) {
  return {
    seq,
    ts: "2026-11-01T10:00:00Z",
    session: "s1",
    event: "decision",
    channel: "approver",
    tool: "Bash",
    cwd: "C:\\dev\\shop",
    project: "shop",
    inputJson: JSON.stringify({ command: outcome === "deny" ? "rm -rf /" : "git status" }),
    verdict: {
      outcome,
      ruleId: outcome === "deny" ? "destructive-shell" : "safe-shell",
      reason: outcome === "deny" ? "Deletes everything." : "Reads only.",
      risk,
      decidedBy: "rules",
    },
    latencyMs: 3,
  }
}

const { Audit } = await import("../src/surfaces/Audit")
const { useStore } = await import("../src/store")

beforeEach(() => {
  asked.length = 0
  useStore.setState({ audit: [] })
})
afterEach(cleanup)

describe("the audit log", () => {
  it("says the chain is intact, and shows risk, decision and rule on every row", async () => {
    render(<Audit />)
    expect(await screen.findByText(/Chain intact: 1,234 records in 2 files/)).toBeTruthy()
    const deny = (await screen.findByText("rm -rf /")).closest("tr") as HTMLElement
    expect(within(deny).getByText(/Severe risk 91/)).toBeTruthy()
    expect(within(deny).getByText("Denied")).toBeTruthy()
    expect(within(deny).getByText("destructive-shell")).toBeTruthy()
  })

  it("filters from a quick view, and shows why a row was decided", async () => {
    render(<Audit />)
    await screen.findByText("rm -rf /")
    fireEvent.click(screen.getByRole("button", { name: "Asked you" }))
    await waitFor(() => expect(asked.at(-1)).toContain("decision=escalate"))
    expect(screen.getByRole("button", { name: "Asked you" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    fireEvent.click(screen.getByRole("button", { name: "From the phone" }))
    await waitFor(() => expect(asked.at(-1)).toContain("channel=phone"))
    fireEvent.click(await screen.findByRole("button", { name: "rm -rf /" }))
    const detail = screen.getByRole("complementary", { name: "Decision detail" })
    expect(within(detail).getByText("Deletes everything.")).toBeTruthy()
  })
})
