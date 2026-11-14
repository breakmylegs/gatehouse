// @vitest-environment jsdom
// T-051 (t3code review): files attached to an answer to Claude's question go through Add files' own route (the policy
// checks each, a blocked one is refused), and are named in the answer with @ as in a prompt; removing one takes it out.
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
const calls: Array<{ url: string; body: unknown }> = []
const errors: string[] = []
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn((m: string) => errors.push(m)) }) }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string, body: unknown) => {
    calls.push({ url, body })
    if (url === "/api/files/pick-files") return { ok: true, status: 200, data: { paths: ["C:\\x\\plan.pdf", "C:\\x\\.env"] } }
    return {
      ok: true,
      status: 200,
      data: {
        files: [
          { path: "C:\\x\\plan.pdf", rel: ".codehouse/attachments/ab12cd-plan.pdf" },
          { path: "C:\\x\\.env", error: "That file is blocked by the policy and was not attached." },
        ],
      },
    }
  }),
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (cmd: Record<string, unknown>) => (sent.push(cmd), { ok: true })) }
})
const { ApprovalCard } = await import("../src/components/ApprovalCard")

const question = {
  request: {
    id: "q1",
    nonce: "n",
    kind: "question",
    sessionId: "s1",
    toolUseId: "tu1",
    toolName: "AskUserQuestion",
    input: {},
    cwd: "C:\\dev\\atlas",
    project: "atlas",
    verdict: { outcome: "escalate", ruleId: "ask-user", reason: "x", risk: 0, decidedBy: "rules", policyHash: "h" },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    payloadHash: "p",
  },
  rawInput: { questions: [{ question: "Which design?", options: [{ label: "The first" }, { label: "The second" }] }] },
  defaultToNo: false,
  phone: "none",
  hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
} as unknown as PendingView

beforeEach(() => {
  sent.length = 0
  calls.length = 0
  errors.length = 0
})
afterEach(cleanup)

describe("files in an answer (T-051)", () => {
  it("attaches through the checked route, says what was refused, and names the file in the answer", async () => {
    render(<ApprovalCard view={question} />)
    fireEvent.click(screen.getByLabelText("The second"))
    fireEvent.click(screen.getByRole("button", { name: "Attach files..." }))
    await screen.findByRole("img", { name: "File plan.pdf" })
    expect(calls.map((c) => c.url)).toEqual(["/api/files/pick-files", "/api/files/attach"])
    expect(calls[1]!.body).toEqual({ session: "s1", paths: ["C:\\x\\plan.pdf", "C:\\x\\.env"] })
    expect(errors).toEqual([".env: That file is blocked by the policy and was not attached."])
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      type: "answer",
      requestId: "q1",
      answers: { "Which design?": "The second @.codehouse/attachments/ab12cd-plan.pdf" },
    })
  })

  it("takes a removed file out of the answer, and a file alone is an answer", async () => {
    render(<ApprovalCard view={question} />)
    fireEvent.click(screen.getByRole("button", { name: "Attach files..." }))
    await screen.findByRole("img", { name: "File plan.pdf" })
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ answers: { "Which design?": "@.codehouse/attachments/ab12cd-plan.pdf" } })
    fireEvent.click(screen.getByRole("button", { name: "Remove plan.pdf" }))
    expect(screen.queryByRole("img", { name: "File plan.pdf" })).toBeNull()
    expect((screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
