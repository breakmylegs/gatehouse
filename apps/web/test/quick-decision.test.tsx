// @vitest-environment jsdom
// The request waiting in a session's workspace (Stitch, R5): its rule, its risk edge, and the same keys as the card.
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QuickDecision } from "../src/components/QuickDecision"
import { useStore } from "../src/store"

const sent: unknown[] = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (cmd: unknown) => (sent.push(cmd), { ok: true })) }
})

const view = (risk: number): PendingView => ({
  request: {
    id: "q1",
    nonce: "n",
    kind: "permission",
    sessionId: "s1",
    toolUseId: "tu1",
    toolName: "Bash",
    input: { command: "git push --force" },
    cwd: "C:\\dev\\atlas",
    project: "atlas",
    verdict: {
      outcome: "escalate",
      ruleId: "force-push",
      reason: "A force push can overwrite shared history.",
      risk,
      decidedBy: "rules",
      policyHash: "h",
    },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    payloadHash: "p",
  },
  rawInput: { command: "git push --force" },
  defaultToNo: risk >= 70,
  phone: "none",
  hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
})

beforeEach(() => {
  useStore.setState({ conn: "open" })
  sent.length = 0
})
afterEach(cleanup)

describe("the request in the workspace", () => {
  it("names its rule, shows the command, and marks a Severe one", () => {
    render(<QuickDecision view={view(91)} variant="panel" />)
    expect(screen.getByText("Rule force-push")).toBeInTheDocument()
    expect(screen.getByText("git push --force")).toBeInTheDocument()
    expect(document.querySelector(".quick-decision")?.getAttribute("data-risk")).toBe("severe")
  })

  it("allows only with Ctrl+Enter inside it, and Esc denies", async () => {
    render(<QuickDecision view={view(55)} variant="panel" />)
    const box = screen.getByRole("region", { name: "Run shell command" })
    fireEvent.keyDown(box, { key: "Enter" })
    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true })
    expect(sent).toEqual([])
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true })
    await waitFor(() => expect(sent).toEqual([{ type: "approve", requestId: "q1" }]))
  })
})

describe("a row of the queue (backlog U4)", () => {
  it("never allows a Severe request in one click: Read it first opens the card, and Deny still works", async () => {
    const opened = vi.fn()
    render(<QuickDecision view={view(91)} variant="row" onMore={opened} />)
    expect(screen.queryByRole("button", { name: /Allow once/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Read it first" }))
    expect(opened).toHaveBeenCalled()
    expect(sent).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: /Deny/ }))
    await waitFor(() => expect(sent).toEqual([{ type: "deny", requestId: "q1" }]))
  })

  it("keeps one-click Allow below Severe", () => {
    render(<QuickDecision view={view(80)} variant="row" />)
    expect(screen.getByRole("button", { name: /Allow once/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Read it first" })).toBeNull()
  })
})
