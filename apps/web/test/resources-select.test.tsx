// @vitest-environment jsdom
// Low, Medium or High in the session bar (owner, 30 Oct), offered only where JCVC can set limits.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
const told: string[] = []
vi.mock("sonner", async (orig) => {
  const actual = await orig<typeof import("sonner")>()
  const toast = Object.assign((m: string) => told.push(m), { error: (m: string) => told.push(m) })
  return { ...actual, toast }
})
vi.mock("../src/lib/connection", () => ({
  takeToken: () => "token",
  Connection: class {
    start() {}
    send(cmd: Record<string, unknown>) {
      sent.push(cmd)
      return Promise.resolve({ ok: true })
    }
  },
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({ Virtuoso: () => <div /> }))

const { startConnection, useStore } = await import("../src/store")
const { Workspace } = await import("../src/surfaces/Workspace")
startConnection()

const ID = "019a0000-0000-7000-8000-00000000000a"
const open = (extra: Record<string, unknown>) => {
  useStore.setState({
    conn: "open",
    sessions: {
      [ID]: {
        id: ID,
        cwd: "C:\\dev\\shop",
        project: "shop",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-10-31T09:00:00Z",
        ...extra,
      },
    },
    transcripts: {},
    route: "workspace",
    selectedSession: ID,
    panes: [ID],
  })
  render(<Workspace />)
}

beforeEach(() => {
  sent.length = 0
  told.length = 0
})
afterEach(cleanup)

describe("Resources in the session bar", () => {
  it("changes the session's level and says what it lets the session use", async () => {
    open({ resources: "high" })
    const pick = screen.getByRole("combobox", { name: "Resources" }) as HTMLSelectElement
    expect(pick.value).toBe("high")
    fireEvent.change(pick, { target: { value: "low" } })
    await waitFor(() =>
      expect(sent.find((c) => c.type === "set_resources")).toEqual({
        type: "set_resources",
        sessionId: ID,
        level: "low",
      }),
    )
    await waitFor(() => expect(told.at(-1)).toMatch(/a fifth of the processor and 2 GB.*fails/))
  })

  it("is not offered where JCVC cannot set limits", () => {
    open({})
    expect(screen.queryByRole("combobox", { name: "Resources" })).toBeNull()
  })
})
