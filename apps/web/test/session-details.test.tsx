// @vitest-environment jsdom
// T-063: a session's details card with the rows you choose: the context meter with where auto-compact happens, usage
// limits, background tasks each with Stop, and the side chats started from it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { compactMark, readRows, SessionDetails } from "../src/components/SessionDetails"
import { send, useStore } from "../src/store"

const sent: Array<Record<string, unknown>> = []
vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }), Toaster: () => null }))
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })) }))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      if (cmd.type === "context_usage") return { ok: true, data: { percentage: 40, totalTokens: 80_000, maxTokens: 200_000, categories: [], autoCompactThreshold: 160_000, isAutoCompactEnabled: true } }
      if (cmd.type === "session_details") return { ok: true, data: { computer: "PC", cwd: "C:/dev/shop", connectors: [] } }
      if (cmd.type === "stop_task") return { ok: true, data: { stopped: true } }
      // The other panels' reads: none here, as when a Host does not have them.
      return { ok: false, error: { code: "unavailable", message: "not here" } }
    }),
  }
})

const session = {
  id: "s1",
  cwd: "C:/dev/shop",
  project: "shop",
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-11-19T00:00:00Z",
  backgroundTasks: [{ id: "t9", description: "npm run dev", startedAt: new Date(Date.now() - 65_000).toISOString() }],
}

beforeEach(() => {
  localStorage.clear()
  sent.length = 0
  localStorage.setItem("gatehouse.sides", JSON.stringify({ side1: "s1", other: "s2" }))
  useStore.setState({ sessions: { s1: session as never, side1: { ...session, id: "side1", title: "Why is the cache slow?", backgroundTasks: [] } as never } })
})
afterEach(cleanup)

describe("the session details card (T-063)", () => {
  it("marks where auto-compact happens, and says when it does not", () => {
    expect(compactMark({ autoCompactThreshold: 160_000, isAutoCompactEnabled: true, maxTokens: 200_000 })).toBe(80)
    expect(compactMark({ autoCompactThreshold: 160_000, isAutoCompactEnabled: false, maxTokens: 200_000 })).toBeUndefined()
  })

  it("shows the compact mark, a Stop for each background task, and the side chats", async () => {
    render(<SessionDetails session={session as never} />)
    expect(await screen.findByText(/compacts the conversation by itself at 160\.0k \(80%\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop npm run dev" }))
    await waitFor(() => expect(sent).toContainEqual({ type: "stop_task", sessionId: "s1", taskId: "t9" }))
    expect(screen.getByText("Why is the cache slow?")).toBeTruthy()
    expect(screen.getByRole("region", { name: "Usage limits" })).toBeTruthy()
    expect(vi.mocked(send)).toHaveBeenCalled()
  })

  it("shows only the rows you choose, and remembers them", async () => {
    render(<SessionDetails session={session as never} />)
    fireEvent.click(screen.getByRole("button", { name: "Choose rows" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Side chats" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Working in the background" }))
    expect(screen.queryByRole("region", { name: "Side chats" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Stop npm run dev" })).toBeNull()
    expect(readRows().has("sides")).toBe(false)
    expect(readRows().has("context")).toBe(true)
  })
})
