// @vitest-environment jsdom
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApprovalCard } from "../src/components/ApprovalCard"
import { useStore } from "../src/store"

const sent: unknown[] = []
let reply: (cmd: { type: string }) => {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
} = () => ({
  ok: true,
})

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: { type: string }) => {
      sent.push(cmd)
      return reply(cmd)
    }),
  }
})

function view(
  over: Partial<PendingView["request"]> = {},
  rest: Partial<PendingView> = {},
): PendingView {
  return {
    request: {
      id: "req-1",
      nonce: "n",
      kind: "permission",
      sessionId: "s1",
      toolUseId: "tu1",
      toolName: "Bash",
      input: { command: "git push --force origin main && npm publish" },
      cwd: "C:\\dev\\atlas",
      project: "atlas",
      verdict: {
        outcome: "escalate",
        ruleId: "force-push",
        reason: "A force push can overwrite shared history.",
        risk: 82,
        segments: [
          { text: "git push --force origin main", ruleId: "force-push", outcome: "escalate" },
          { text: "npm publish", ruleId: "x", outcome: "allow" },
        ],
        decidedBy: "rules",
        policyHash: "h",
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      payloadHash: "p",
      ...over,
    },
    rawInput: { command: "git push --force origin main && npm publish" },
    defaultToNo: true,
    phone: "delivered",
    hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
    ...rest,
  }
}

/** U4: at High risk Allow waits a second after the request appears. */
const allowReady = () =>
  waitFor(() => expect(screen.getByRole("button", { name: /^Allow once/ })).toBeEnabled(), {
    timeout: 3000,
  })

beforeEach(() => {
  useStore.setState({ conn: "open" })
  sent.length = 0
  reply = () => ({ ok: true })
})
afterEach(cleanup)

describe("ApprovalCard", () => {
  it("shows the whole command, the escalating segment marked, where, the rule and the risk as words", () => {
    render(<ApprovalCard view={view()} />)
    expect(screen.getByLabelText("What will run").textContent).toBe(
      "git push --force origin main && npm publish",
    )
    expect(document.querySelector("mark")?.textContent).toBe("git push --force origin main")
    expect(screen.getByText("C:\\dev\\atlas")).toBeInTheDocument()
    expect(screen.getByText("force-push")).toBeInTheDocument()
    expect(screen.getByText(/High risk 82/)).toBeInTheDocument()
    expect(screen.getByText(/Phone notified/)).toBeInTheDocument()
  })

  it("shows what a call would delete and whether it can be undone (G20)", () => {
    render(
      <ApprovalCard
        view={view({
          input: { command: "rm -rf build" },
          effects: {
            kind: "delete",
            count: 23,
            paths: ["build/a.js", "build/b.js"],
            more: false,
            reversible: false,
            undo: "Cannot be undone: 23 files are not committed in git as they are.",
          },
        })}
      />,
    )
    const effects = screen.getByLabelText("What it would delete or throw away")
    expect(effects.textContent).toContain("Deletes 23 files")
    expect(effects.textContent).toContain("build/a.js, build/b.js, and more")
    expect(effects.textContent).toContain("Cannot be undone")
  })

  it("waits a second before Allow works at High risk, so a stray click or keypress allows nothing (U4)", async () => {
    render(<ApprovalCard view={view()} />)
    const allowButton = screen.getByRole("button", { name: /^Allow once/ })
    expect(allowButton).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText("What will run"), { key: "Enter", ctrlKey: true })
    expect(sent).toEqual([])
    await allowReady()
    // Low risk has no wait.
    cleanup()
    render(
      <ApprovalCard
        view={view({ verdict: { ...view().request.verdict, risk: 20, segments: [] } })}
      />,
    )
    expect(screen.getByRole("button", { name: /^Allow once/ })).toBeEnabled()
  })

  it("asks you to type allow before a Severe request is allowed, by button or keys (U4)", async () => {
    render(<ApprovalCard view={view({ verdict: { ...view().request.verdict, risk: 92 } })} />)
    await allowReady()
    fireEvent.click(screen.getByRole("button", { name: /^Allow once/ }))
    fireEvent.keyDown(screen.getByLabelText("What will run"), { key: "Enter", ctrlKey: true })
    expect(sent).toEqual([])
    const form = screen.getByRole("form", { name: "Confirm a Severe request" })
    const box = within(form).getByRole("textbox")
    const confirm = within(form).getByRole("button", { name: "Allow once" })
    fireEvent.change(box, { target: { value: "yes" } })
    expect(confirm).toBeDisabled()
    // Ctrl+Enter inside the box allows nothing either.
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true })
    expect(sent).toEqual([])
    fireEvent.change(box, { target: { value: " Allow " } })
    fireEvent.click(confirm)
    // Typed, so the Host takes it as deliberate (owner, 13 Nov: typing allow did not allow after fast approvals).
    await waitFor(() => expect(sent).toEqual([{ type: "approve", requestId: "req-1", typed: true, opened: true, shownMs: expect.any(Number) }]))
  })

  it("has no effects row for a call that deletes nothing", () => {
    render(<ApprovalCard view={view()} />)
    expect(screen.queryByLabelText("What it would delete or throw away")).toBeNull()
  })

  it("never starts with focus on Allow, and Deny is one click", async () => {
    render(<ApprovalCard view={view()} />)
    expect(screen.getByRole("button", { name: /Allow once/ })).not.toHaveFocus()
    expect(
      document.activeElement === document.body ||
        !(document.activeElement as HTMLElement).textContent?.includes("Allow"),
    ).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: /^Deny\s*Esc/ }))
    expect(sent).toEqual([{ type: "deny", requestId: "req-1" }])
  })

  it("allows with Ctrl+Enter only while focus is inside the card", async () => {
    render(
      <>
        <textarea aria-label="Prompt" />
        <ApprovalCard view={view()} />
      </>,
    )
    // Ctrl+Enter in the composer must send a prompt, never approve.
    fireEvent.keyDown(screen.getByLabelText("Prompt"), { key: "Enter", ctrlKey: true })
    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true })
    expect(sent).toEqual([])
    await allowReady()
    fireEvent.keyDown(screen.getByLabelText("What will run"), { key: "Enter", ctrlKey: true })
    await waitFor(() => expect(sent).toEqual([{ type: "approve", requestId: "req-1", opened: true, shownMs: expect.any(Number) }]))
  })

  it("answers the Stitch letter keys inside the card, and no letter ever allows", async () => {
    render(<ApprovalCard view={view()} />)
    const card = screen.getByLabelText("What will run")
    fireEvent.keyDown(card, { key: "m" })
    expect(screen.getByLabelText("Message to Claude")).toBeInTheDocument()
    fireEvent.keyDown(screen.getByLabelText("Message to Claude"), { key: "Escape" })
    fireEvent.keyDown(card, { key: "e" })
    expect(screen.getByRole("group", { name: "Edit then allow" })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("group", { name: "Edit then allow" }), { key: "Escape" })
    fireEvent.keyDown(card, { key: "S", shiftKey: true })
    expect(screen.getByRole("group", { name: "Confirm stopping the session" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Keep session" }))
    for (const key of ["a", "y", "Enter", " "]) fireEvent.keyDown(card, { key })
    expect(sent).toEqual([])
    fireEvent.keyDown(card, { key: "d" })
    await waitFor(() => expect(sent).toEqual([{ type: "deny", requestId: "req-1" }]))
  })

  it("takes letters typed in a box as words, not keys", async () => {
    render(<ApprovalCard view={view()} />)
    await userEvent.click(screen.getByRole("button", { name: /Deny with message/ }))
    await userEvent.type(screen.getByLabelText("Message to Claude"), "do redo me")
    expect(screen.getByLabelText("Message to Claude")).toHaveValue("do redo me")
    expect(sent).toEqual([])
  })

  it("a plain Enter inside the card does not allow", () => {
    render(<ApprovalCard view={view()} />)
    fireEvent.keyDown(screen.getByLabelText("What will run"), { key: "Enter" })
    expect(sent).toEqual([])
  })

  it("Esc closes an open panel first and denies on the next press", async () => {
    render(<ApprovalCard view={view()} />)
    await userEvent.click(screen.getByRole("button", { name: /Deny with message/ }))
    expect(screen.getByLabelText("Message to Claude")).toBeInTheDocument()
    fireEvent.keyDown(screen.getByLabelText("Message to Claude"), { key: "Escape" })
    expect(screen.queryByLabelText("Message to Claude")).toBeNull()
    expect(sent).toEqual([])
    fireEvent.keyDown(screen.getByLabelText("What will run"), { key: "Escape" })
    await waitFor(() => expect(sent).toEqual([{ type: "deny", requestId: "req-1" }]))
  })

  it("denies with a trimmed message to Claude", async () => {
    render(<ApprovalCard view={view()} />)
    await userEvent.click(screen.getByRole("button", { name: /Deny with message/ }))
    await userEvent.type(screen.getByLabelText("Message to Claude"), "  use a branch instead  ")
    await userEvent.click(screen.getByRole("button", { name: "Deny with message" }))
    expect(sent).toEqual([{ type: "deny", requestId: "req-1", message: "use a branch instead" }])
  })

  it("sends the edited command, keeping the other input fields, and only when it changed", async () => {
    render(
      <ApprovalCard
        view={view({}, { rawInput: { command: "rm -rf build", description: "clean" } })}
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: /Edit then allow/ }))
    const box = screen.getByLabelText("Command to run instead")
    expect(screen.getByRole("button", { name: "Allow edited input" })).toBeDisabled()
    await userEvent.clear(box)
    await userEvent.type(box, "rm -rf build/tmp")
    await userEvent.click(screen.getByRole("button", { name: "Allow edited input" }))
    expect(sent).toEqual([
      {
        type: "approve",
        requestId: "req-1",
        updatedInput: { command: "rm -rf build/tmp", description: "clean" },
        opened: true, shownMs: expect.any(Number),
      },
    ])
  })

  it("refuses to send edited JSON that does not parse, for a non-shell tool", async () => {
    render(
      <ApprovalCard
        view={view({ toolName: "Write" }, { rawInput: { file_path: "C:\\a.txt", content: "x" } })}
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: /Edit then allow/ }))
    const box = screen.getByLabelText(/Input to send instead/)
    fireEvent.change(box, { target: { value: "{ not json" } })
    await userEvent.click(screen.getByRole("button", { name: "Allow edited input" }))
    expect(sent).toEqual([])
    expect(screen.getByRole("alert").textContent).toMatch(/not valid JSON/)
  })

  it("shows the exact rule before remembering, and what the Host said when it cannot", async () => {
    reply = (cmd) =>
      cmd.type === "remember_preview"
        ? { ok: true, data: { ok: true, preview: "Allow Bash to run exactly: npm test" } }
        : { ok: true }
    render(<ApprovalCard view={view()} />)
    await userEvent.click(screen.getByRole("button", { name: /Remember/ }))
    expect(await screen.findByText("Allow Bash to run exactly: npm test")).toBeInTheDocument()
    expect(sent.at(-1)).toEqual({ type: "remember_preview", requestId: "req-1" })
    await userEvent.click(screen.getByRole("button", { name: "Allow once and remember" }))
    // C-013: unless you choose otherwise, it lasts 30 days and holds in this folder only.
    expect(sent.at(-1)).toEqual({
      type: "approve",
      requestId: "req-1",
      remember: true,
      rememberFor: { days: 30 },
      opened: true, shownMs: expect.any(Number),
    })
  })

  it("explains when nothing can be remembered", async () => {
    reply = () => ({ ok: true, data: { ok: false, reason: "A chain cannot be remembered." } })
    render(<ApprovalCard view={view()} />)
    await userEvent.click(screen.getByRole("button", { name: /Remember/ }))
    expect(await screen.findByText(/A chain cannot be remembered/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Allow once and remember" })).toBeNull()
  })

  it("shows the Host's reason when a decision is refused, instead of pretending it worked", async () => {
    reply = () => ({
      ok: false,
      error: { code: "x", message: "The edited input is denied by rule secrets." },
    })
    render(<ApprovalCard view={view()} />)
    await allowReady()
    await userEvent.click(screen.getByRole("button", { name: /Allow once/ }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/denied by rule secrets/)
  })

  it("collapses a long command behind Show all, and never drops a line", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `echo line${i}`).join("\n")
    render(<ApprovalCard view={view({}, { rawInput: { command: long } })} />)
    expect(screen.getByLabelText("What will run").textContent).not.toContain("line39")
    await userEvent.click(screen.getByRole("button", { name: /Show all \(40 lines/ }))
    expect(screen.getByLabelText("What will run").textContent).toBe(long)
  })

  it("shows a ten thousand character command in full once expanded", async () => {
    const huge = "echo " + "a".repeat(10_000)
    render(<ApprovalCard view={view({}, { rawInput: { command: huge } })} />)
    expect(screen.getByLabelText("What will run").textContent!.length).toBeLessThan(2000)
    await userEvent.click(screen.getByRole("button", { name: /Show all/ }))
    expect(screen.getByLabelText("What will run").textContent).toBe(huge)
  })

  it("answers a question with the chosen option and a typed answer", async () => {
    const q = view(
      { kind: "question", toolName: "AskUserQuestion" },
      {
        rawInput: {
          questions: [
            { question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }] },
            { question: "Anything else?", options: [] },
          ],
        },
      },
    )
    render(<ApprovalCard view={q} />)
    const send1 = screen.getByRole("button", { name: "Send answer" })
    expect(send1).toBeDisabled()
    await userEvent.click(screen.getByLabelText("SQLite"))
    await userEvent.type(
      screen.getAllByLabelText("Or write your own answer")[1] as HTMLElement,
      "No",
    )
    await userEvent.click(send1)
    expect(sent).toEqual([
      {
        type: "answer",
        requestId: "req-1",
        answers: { "Which database?": "SQLite", "Anything else?": "No" },
      },
    ])
  })

  it("makes Deny the filled choice and Allow the outline one at high risk, and the reverse at low risk", () => {
    const { unmount } = render(<ApprovalCard view={view({}, { defaultToNo: true })} />)
    expect(screen.getByRole("button", { name: /^Deny.*Esc/ })).toHaveClass("btn-primary")
    expect(screen.getByRole("button", { name: /Allow once/ })).not.toHaveClass("btn-primary")
    // The red band says why (Stitch, R3).
    expect(screen.getByText(/Deny is the safe choice/)).toBeInTheDocument()
    unmount()
    render(<ApprovalCard view={view({}, { defaultToNo: false })} />)
    expect(screen.getByRole("button", { name: /Allow once/ })).toHaveClass("btn-primary")
    expect(screen.queryByText(/Deny is the safe choice/)).toBeNull()
  })

  it("asks before stopping the session, and Keep session backs out", async () => {
    render(<ApprovalCard view={view()} />)
    await userEvent.click(screen.getByRole("button", { name: "Stop session…" }))
    expect(sent).toEqual([])
    await userEvent.click(screen.getByRole("button", { name: "Keep session" }))
    expect(screen.getByRole("button", { name: "Stop session…" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Stop session…" }))
    await userEvent.click(screen.getByRole("button", { name: "Stop session" }))
    await waitFor(() =>
      expect(sent).toEqual([
        { type: "deny", requestId: "req-1", message: "The user stopped this session." },
        { type: "close_session", sessionId: "s1" },
      ]),
    )
  })

  it("pauses every decision while the Host is not connected, including the keyboard", () => {
    useStore.setState({ conn: "closed" })
    render(<ApprovalCard view={view()} />)
    expect(screen.getByText(/Not connected to the Host/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Allow once/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /^Deny.*Esc/ })).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText("What will run"), { key: "Enter", ctrlKey: true })
    fireEvent.keyDown(screen.getByLabelText("What will run"), { key: "Escape" })
    expect(sent).toEqual([])
  })

  it("says what the Host said, or that it was not connected, when a send fails", async () => {
    reply = () => ({ ok: false, error: { code: "disconnected", message: "x" } })
    render(<ApprovalCard view={view()} />)
    await allowReady()
    await userEvent.click(screen.getByRole("button", { name: /Allow once/ }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing was sent/)
  })

  it("shows the status line and the target path of an edit", () => {
    render(
      <ApprovalCard
        view={view(
          { toolName: "Edit" },
          { rawInput: { file_path: "C:/dev/atlas/a.ts", old_string: "a", new_string: "b" } },
        )}
      />,
    )
    expect(screen.getByText(/Target: C:.dev.atlas.a.ts/)).toBeInTheDocument()
    expect(screen.getByText(/Desktop times.out at/)).toBeInTheDocument()
  })

  it("collapses a long single-line command by characters", async () => {
    render(<ApprovalCard view={view({}, { rawInput: { command: "x".repeat(5000) } })} />)
    expect(screen.getByLabelText("What will run").textContent!.length).toBeLessThanOrEqual(1500)
  })
})
