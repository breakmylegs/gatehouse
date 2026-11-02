// @vitest-environment jsdom
// Retry and Edit on your messages (owner, 2 Nov): the transcript remembers the conversation message before each of
// yours; Retry sends the same words again from there and Edit sends changed ones, in a fork that takes the old
// session's place; the version left behind is closed and stays under Earlier sessions.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { addUser, emptyTranscript, reduce, reduceHistory } from "../src/lib/transcript"

const sent: Array<Record<string, unknown>> = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return cmd.type === "create_session" ? { ok: true, data: { sessionId: "s2" } } : { ok: true }
    }),
  }
})
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const { useStore } = await import("../src/store")
const { ItemView } = await import("../src/surfaces/Workspace")

beforeEach(() => {
  sent.length = 0
  useStore.setState({
    panes: ["s1"],
    selectedSession: "s1",
    sessions: {
      s1: {
        id: "s1",
        kind: "chat",
        cwd: "C:\\data\\chats\\launch",
        project: "launch",
        mode: "plan",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-11-02T09:00:00Z",
        sdkSessionId: "sdk-1",
      },
    },
  })
})
afterEach(cleanup)

describe("where each of your messages carries on from", () => {
  it("is the conversation's message before it, and the first message knows it is first", () => {
    let t = addUser(emptyTranscript(), "Plan the launch")
    expect(t.items[0]).toMatchObject({ kind: "user", first: true })
    t = reduce(t, {
      type: "assistant",
      uuid: "a1",
      message: { content: [{ type: "text", text: "Here." }] },
    })
    t = addUser(t, "Shorter, please")
    expect(t.items.at(-1)).toMatchObject({ kind: "user", before: "a1" })
    expect(t.items.at(-1)).not.toHaveProperty("first")
    let h = reduceHistory(emptyTranscript(), {
      type: "user",
      uuid: "u1",
      message: { content: "Hi" },
    })
    h = addUser(h, "Next")
    expect(h.items.at(-1)).toMatchObject({ before: "u1" })
  })
})

describe("Retry and Edit", () => {
  const item = { id: "u3", kind: "user" as const, text: "Shorter, please", before: "a1" }

  it("Retry sends the same words again from just before, in a fork that takes the session's place", async () => {
    render(<ItemView item={item} sessionId="s1" />)
    fireEvent.click(screen.getByRole("button", { name: /^Retry/ }))
    await waitFor(() =>
      expect(sent.map((c) => c.type)).toEqual(["create_session", "prompt", "close_session"]),
    )
    expect(sent[0]).toMatchObject({
      type: "create_session",
      kind: "chat",
      cwd: "C:\\data\\chats\\launch",
      resume: "sdk-1",
      fork: true,
      resumeAt: "a1",
    })
    expect(sent[1]).toEqual({ type: "prompt", sessionId: "s2", text: "Shorter, please" })
    expect(sent[2]).toEqual({ type: "close_session", sessionId: "s1" })
    expect(useStore.getState().panes).toEqual(["s2"])
  })

  it("Edit changes the words in place and sends them from just before", async () => {
    render(<ItemView item={item} sessionId="s1" />)
    fireEvent.click(screen.getByRole("button", { name: /^Edit your message and carry on/ }))
    const box = screen.getByRole("textbox")
    fireEvent.change(box, { target: { value: "Much shorter" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() =>
      expect(sent[1]).toEqual({ type: "prompt", sessionId: "s2", text: "Much shorter" }),
    )
    expect(sent[0]).toMatchObject({ resumeAt: "a1", fork: true })
  })

  it("waits while Claude is working", async () => {
    useStore.setState((s) => ({ sessions: { s1: { ...s.sessions.s1!, state: "running" } } }))
    render(<ItemView item={item} sessionId="s1" />)
    fireEvent.click(screen.getByRole("button", { name: /^Retry/ }))
    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toEqual([])
  })
})
