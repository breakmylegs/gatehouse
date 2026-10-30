// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { groupByFolder } from "../src/lib/rail"
import { useStore } from "../src/store"
import { NewChat } from "../src/surfaces/NewChat"
import { Workspace } from "../src/surfaces/Workspace"

const sent: Array<Record<string, unknown>> = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return cmd.type === "create_session" ? { ok: true, data: { sessionId: "c1" } } : { ok: true }
    }),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const info = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  cwd: `C:/x/${id}`,
  project: id,
  mode: "plan" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-30T10:00:00Z",
  ...extra,
})

beforeEach(() => {
  sent.length = 0
  useStore.setState({ sessions: {}, transcripts: {}, panes: [], route: "chat" })
})
afterEach(cleanup)

describe("a chat", () => {
  it("starts from what you say, in Plan mode, and opens with your words as the first message", async () => {
    render(<NewChat />)
    fireEvent.change(screen.getByRole("textbox", { name: "What do you want to talk about?" }), {
      target: { value: "How do vite proxies work?" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start the chat" }))
    await waitFor(() => expect(sent.map((c) => c.type)).toEqual(["create_session", "prompt"]))
    expect(sent[0]).toMatchObject({
      kind: "chat",
      title: "How do vite proxies work?",
      mode: "plan",
    })
    expect(sent[1]).toEqual({ type: "prompt", sessionId: "c1", text: "How do vite proxies work?" })
    expect(useStore.getState().route).toBe("workspace")
    expect(useStore.getState().selectedSession).toBe("c1")
  })

  it("is listed under Chats, after your projects", () => {
    const groups = groupByFolder([
      info("talk", { kind: "chat" }) as never,
      info("shop", { cwd: "C:/dev/shop" }) as never,
    ])
    expect(groups.map((g) => g.label)).toEqual(["dev", "Chats"])
  })

  it("has no project panels and no mode picker, and says why", () => {
    useStore.setState({
      sessions: { c1: info("c1", { kind: "chat" }) as never },
      selectedSession: "c1",
    })
    render(<Workspace />)
    expect(screen.queryByRole("group", { name: "Side panels" })).toBeNull()
    expect(screen.queryByRole("combobox", { name: /^Mode$/ })).toBeNull()
    expect(screen.getByText(/never changes files/)).toBeTruthy()
  })
})
