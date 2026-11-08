// @vitest-environment jsdom
// Backlog G21: characters you cannot see are drawn as their codes on a request, and Copy keeps the text as it is.
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { QuickDecision } from "../src/components/QuickDecision"
import { hasHidden, ShowHidden } from "../src/components/ShowHidden"
import { useStore } from "../src/store"

afterEach(cleanup)

const view = (command: string): PendingView => ({
  request: {
    id: "q1",
    nonce: "n",
    kind: "permission",
    sessionId: "s1",
    toolUseId: "tu1",
    toolName: "Bash",
    input: { command },
    cwd: "C:\\dev\\atlas",
    project: "atlas",
    verdict: {
      outcome: "escalate",
      ruleId: "hidden-unicode",
      reason: "It contains characters you cannot see.",
      risk: 80,
      decidedBy: "rules",
      policyHash: "h",
    },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    payloadHash: "p",
  },
  rawInput: { command },
  defaultToNo: true,
  phone: "none",
  hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
})

describe("characters you cannot see", () => {
  it("are drawn as their codes in place, and ordinary text is left alone", () => {
    const { container } = render(<ShowHidden text={"git status\u202E && rm x\u200B"} />)
    expect(container.textContent).toBe("git status[U+202E] && rm x[U+200B]")
    expect(screen.getAllByLabelText(/hidden character U\+/)).toHaveLength(2)
    cleanup()
    const plain = render(<ShowHidden text="git status" />)
    expect(plain.container.textContent).toBe("git status")
    expect(hasHidden("git status")).toBe(false)
    expect(hasHidden("x\u{E0041}")).toBe(true)
  })

  it("are shown on a waiting request", () => {
    useStore.setState({ conn: "open" })
    render(<QuickDecision view={view("echo ok\u2066")} variant="panel" />)
    expect(screen.getByText(/\[U\+2066\]/)).toBeTruthy()
  })
})
