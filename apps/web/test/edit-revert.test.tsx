// @vitest-environment jsdom
// T-042 (t3code review): Edit from here can put the files back as they were when the message was sent. It finds the
// first checkpoint after the message, shows which files would change, and the files go back before anything is sent;
// if they cannot, nothing is sent.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
let revertOk = true
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      if (cmd.type === "checkpoint_list")
        return {
          ok: true,
          data: [
            { ref: "refs/gatehouse/cp/old", createdAt: "2026-11-14T09:00:00Z" },
            { ref: "refs/gatehouse/cp/later", createdAt: "2026-11-14T10:30:00Z" },
            { ref: "refs/gatehouse/cp/first", createdAt: "2026-11-14T10:05:00Z" },
          ],
        }
      if (cmd.type === "checkpoint_preview") return { ok: true, data: { changes: [{ path: "src/a.ts" }, { path: "src/b.ts" }] } }
      if (cmd.type === "edit_revert") return revertOk ? { ok: true } : { ok: false, error: { code: "x", message: "shared" } }
      if (cmd.type === "create_session") return { ok: true, data: { sessionId: "s2" } }
      return { ok: true }
    }),
  }
})
const { useStore } = await import("../src/store")
const { EditRevert, checkpointAfter } = await import("../src/components/EditRevert")
const { carryOnFrom } = await import("../src/lib/redo")

const at = Date.parse("2026-11-14T10:00:00Z")
const session = (o: Record<string, unknown> = {}) => ({
  id: "s1",
  cwd: "C:\\dev\\wt\\fix",
  project: "fix",
  mode: "default",
  state: "idle",
  pendingApprovals: 0,
  createdAt: "2026-11-14T08:00:00Z",
  sdkSessionId: "sdk-1",
  worktree: { branch: "fix", repo: "C:\\dev\\shop" },
  ...o,
})

beforeEach(() => {
  sent.length = 0
  revertOk = true
  useStore.setState({ sessions: { s1: session() }, panes: ["s1"] } as never)
})
afterEach(cleanup)

describe("Edit from here, putting files back (T-042)", () => {
  it("uses the first checkpoint after the message, and shows the files it would put back", async () => {
    expect(checkpointAfter([{ ref: "a", createdAt: "2026-11-14T09:00:00Z" }], at)).toBeUndefined()
    const refs: Array<string | undefined> = []
    render(<EditRevert sessionId="s1" at={at} onRef={(r) => refs.push(r)} />)
    fireEvent.click(screen.getByRole("checkbox", { name: /put the files back/ }))
    expect(await screen.findByText("src/a.ts, src/b.ts")).toBeTruthy()
    expect(sent.find((c) => c.type === "checkpoint_preview")).toMatchObject({ ref: "refs/gatehouse/cp/first" })
    expect(refs.at(-1)).toBe("refs/gatehouse/cp/first")
  })

  it("is not offered outside a worktree or in a chat", () => {
    useStore.setState({ sessions: { s1: session({ worktree: undefined }) } } as never)
    const { container } = render(<EditRevert sessionId="s1" at={at} onRef={() => undefined} />)
    expect(container.textContent).toBe("")
  })

  it("puts the files back before carrying on, and sends nothing when they cannot go back", async () => {
    expect(await carryOnFrom("s1", { before: "m1" }, "Try again", { revertRef: "refs/gatehouse/cp/first" })).toBe(true)
    expect(sent.map((c) => c.type).slice(0, 2)).toEqual(["edit_revert", "create_session"])
    sent.length = 0
    revertOk = false
    expect(await carryOnFrom("s1", { before: "m1" }, "Try again", { revertRef: "refs/gatehouse/cp/first" })).toBe(false)
    expect(sent.map((c) => c.type)).toEqual(["edit_revert"])
  })
})
