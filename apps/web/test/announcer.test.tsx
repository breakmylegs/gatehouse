// @vitest-environment jsdom
// W1-12: one polite announcer for a new request and what happened lately, each said once.
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Announcer } from "../src/components/Announcer"
import { useStore } from "../src/store"

const view = (id: string, project: string) =>
  ({
    request: {
      id,
      nonce: "n",
      kind: "permission",
      sessionId: "s1",
      toolUseId: `t-${id}`,
      toolName: "Bash",
      input: { command: "git push" },
      cwd: "C:/dev/x",
      project,
      verdict: {
        outcome: "escalate",
        ruleId: "git-push",
        reason: "x",
        risk: 60,
        decidedBy: "rules",
        policyHash: "h",
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      payloadHash: "p",
    },
    rawInput: { command: "git push" },
    defaultToNo: false,
    phone: "none",
    hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
  }) as never

beforeEach(() => useStore.setState({ pending: { old: view("old", "atlas") }, notices: [] }))
afterEach(cleanup)

const said = (c: HTMLElement) => c.querySelector("[data-announcer]")?.textContent ?? ""

describe("the announcer", () => {
  it("says nothing about what was there when the window opened", () => {
    const { container } = render(<Announcer />)
    expect(said(container)).toBe("")
    expect(container.querySelector("[data-announcer]")?.getAttribute("aria-live")).toBe("polite")
  })

  it("announces a new request once, and a finished turn once", () => {
    const { container } = render(<Announcer />)
    act(() => useStore.setState((s) => ({ pending: { ...s.pending, r1: view("r1", "shop") } })))
    expect(said(container)).toBe("New request waiting on you: Run shell command, in shop.")
    // The same request again is not news: the words stay as they were.
    act(() => useStore.setState((s) => ({ pending: { ...s.pending } })))
    expect(said(container)).toBe("New request waiting on you: Run shell command, in shop.")
    act(() =>
      useStore.setState({
        notices: [{ id: "n1", at: Date.now(), sessionId: "s1", text: "shop: A turn finished." }],
      }),
    )
    expect(said(container)).toBe("shop: A turn finished.")
  })
})
