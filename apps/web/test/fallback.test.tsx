// @vitest-environment jsdom
// B21: a chat that had to stop carries on, when you choose, with a model no looser with your words than Claude.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  boundaryRank,
  carriedText,
  FallbackButton,
  fallbackModels,
} from "../src/components/FallbackButton"
import { send, useStore } from "../src/store"

let providers: Record<string, unknown> = {}
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (c: { type: string }) =>
      c.type === "create_session" ? { ok: true, data: { sessionId: "c2" } } : { ok: true },
    ),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) =>
    url === "/api/providers"
      ? { ok: true, status: 200, data: providers }
      : { ok: false, status: 404 },
  ),
}))

const chat = {
  id: "c1",
  cwd: "C:/chats/x",
  project: "x",
  title: "Launch plan",
  kind: "chat" as const,
  mode: "plan" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-11-04T09:00:00Z",
}

beforeEach(() => {
  vi.mocked(send).mockClear()
  providers = {
    enabled: true,
    local: { kind: "ollama" },
    check: { ok: true, models: ["qwen3:8b"] },
    label: "On this computer",
  }
  useStore.setState({
    sessions: { c1: chat },
    transcripts: {
      c1: {
        items: [
          { id: "u", kind: "user", text: "Plan the launch" },
          { id: "t", kind: "text", text: "Start with the date." },
        ],
        todos: [],
        seq: 2,
      },
    } as never,
    panes: ["c1"],
  })
})
afterEach(cleanup)

describe("carrying a chat on with another model", () => {
  it("is offered only for a model no looser than Claude: this computer, or a gateway that keeps nothing or 30 days", () => {
    expect(boundaryRank({ kind: "ollama" })).toBeLessThan(boundaryRank("claude"))
    expect(boundaryRank({ kind: "gateway", keeps: "nothing" })).toBeLessThan(boundaryRank("claude"))
    expect(boundaryRank({ kind: "gateway", keeps: "30-days" })).toBe(boundaryRank("claude"))
    const view = (keeps: string) => ({
      enabled: true,
      local: { kind: "gateway" as const, keeps: keeps as never },
      check: { ok: true, models: ["m"] },
    })
    expect(fallbackModels(view("unknown"), true)).toEqual([])
    expect(fallbackModels(view("nothing"), true)).toEqual(["m"])
    expect(fallbackModels(view("nothing"), false)).toEqual([])
    expect(fallbackModels({ ...view("nothing"), check: { ok: false } }, true)).toEqual([])
  })

  it("records the switch first, then starts a chat on that model with what was said, beside the first", async () => {
    render(<FallbackButton session={chat} />)
    fireEvent.click(await screen.findByRole("button", { name: /Carry on with qwen3:8b/ }))
    await waitFor(() => expect(vi.mocked(send).mock.calls.length).toBeGreaterThanOrEqual(3))
    const sent = vi.mocked(send).mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(sent[0]).toEqual({ type: "fallback_used", from: "c1", model: "qwen3:8b" })
    expect(sent[1]).toMatchObject({ type: "create_session", kind: "chat", localModel: "qwen3:8b" })
    expect(String(sent[2]?.text)).toContain("You: Plan the launch\n\nClaude: Start with the date.")
    expect(useStore.getState().panes).toContain("c2")
    expect(carriedText("c1", 10)).toMatch(/^\.\.\.\n/)
  })

  it("is not offered for a coding session, nor when no model is ready", async () => {
    const { container } = render(<FallbackButton session={{ ...chat, kind: undefined } as never} />)
    expect(container.textContent).toBe("")
    cleanup()
    providers = { enabled: false }
    render(<FallbackButton session={chat} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("button")).toBeNull()
  })
})
