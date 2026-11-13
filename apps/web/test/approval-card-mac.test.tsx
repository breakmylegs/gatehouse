// @vitest-environment jsdom
// Mac fork: the request as a Mac shows it (mac-standard.css): the session, the rule and the wait as grouped rows with
// Where and Why, the keys named as a Mac names them, and the sidebar's disclosure drawn, not typed.
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApprovalCard } from "../src/components/ApprovalCard"
import { Disclosure } from "../src/components/DisclosureMac"
import { useStore } from "../src/store"

const SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"

function view(): PendingView {
  return {
    request: {
      id: "req-1",
      nonce: "n",
      kind: "permission",
      sessionId: "s1",
      toolUseId: "tu1",
      toolName: "Bash",
      input: { command: "git push --force origin main" },
      cwd: "/Users/someone/dev/atlas",
      project: "atlas",
      verdict: {
        outcome: "escalate",
        ruleId: "force-push",
        reason: "A force push can overwrite shared history.",
        risk: 82,
        segments: [
          { text: "git push --force origin main", ruleId: "force-push", outcome: "escalate" },
        ],
        decidedBy: "rules",
        policyHash: "h",
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      payloadHash: "p",
    },
    rawInput: { command: "git push --force origin main" },
    defaultToNo: true,
    phone: "delivered",
    hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
  }
}

beforeEach(() => {
  useStore.setState({ conn: "open" })
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(SAFARI)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("the request on a Mac", () => {
  it("puts the session, the rule and the wait in the grouped rows with Where", () => {
    render(<ApprovalCard view={view()} />)
    const rows = document.querySelector(".pass dl") as HTMLElement
    const labels = [...rows.querySelectorAll("dt")].map((d) => d.textContent)
    expect(labels.slice(0, 4)).toEqual(["Session", "Rule", "Waiting", "Where"])
    expect(within(rows).getByText("force-push")).toBeInTheDocument()
    expect(within(rows).getByText("atlas")).toBeInTheDocument()
  })

  it("names Allow once's key, and the high-risk note's, as a Mac does", () => {
    render(<ApprovalCard view={view()} />)
    expect(screen.getByRole("button", { name: /^Allow once/ }).textContent).toContain("⌘↩")
    expect(screen.getByText(/Risk is high/).textContent).toContain("⌘↩")
  })

  it("draws the sidebar's disclosure on a Mac and keeps upstream's arrow elsewhere", () => {
    const { container, rerender } = render(<Disclosure open mac />)
    expect(container.querySelector("svg")).not.toBeNull()
    expect(container.textContent).toBe("")
    rerender(<Disclosure open={false} mac={false} />)
    expect(container.textContent).toBe("▸")
  })
})
