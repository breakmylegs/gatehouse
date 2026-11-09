// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { groupByFolder } from "../src/lib/rail"
import { useStore } from "../src/store"
import { NewChat } from "../src/surfaces/NewChat"
import { Workspace } from "../src/surfaces/Workspace"

const sent: Array<Record<string, unknown>> = []
/** How often the page asked the Host to have a chat ready (the warm chat). */
let warmed = 0
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      if (cmd.type === "warm_chat") return (warmed++, { ok: true })
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
  useStore.setState({ sessions: { code1: { id: "code1", cwd: "C:/dev/shop", project: "shop", mode: "default", state: "idle", pendingApprovals: 0, createdAt: "2026-11-06T09:00:00Z" } as never }, transcripts: {}, panes: [], route: "chat" })
})
afterEach(cleanup)

describe("a chat", () => {
  it("starts from a long first message: only its start names the chat, and all of it is sent", async () => {
    const long = `Review this:\n${"word ".repeat(1000)}`
    render(<NewChat />)
    fireEvent.change(screen.getByRole("textbox", { name: "What do you want to know?" }), {
      target: { value: long },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    await waitFor(() => expect(sent.map((c) => c.type)).toEqual(["create_session", "prompt"]))
    expect(String(sent[0]!.title).length).toBeLessThanOrEqual(200)
    expect(sent[0]!.title).toMatch(/^Review this: word word/)
    expect(sent[1]).toMatchObject({ type: "prompt", text: long.trim() })
  })

  it("starts from what you say, in Plan mode, and opens with your words as the first message", async () => {
    render(<NewChat />)
    fireEvent.change(screen.getByRole("textbox", { name: "What do you want to know?" }), {
      target: { value: "How do vite proxies work?" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    await waitFor(() => expect(sent.map((c) => c.type)).toEqual(["create_session", "prompt"]))
    expect(warmed).toBeGreaterThan(0)
    expect(sent[0]).toMatchObject({
      kind: "chat",
      title: "How do vite proxies work?",
      mode: "plan",
      about: "code1",
    })
    expect(sent[0]).not.toHaveProperty("research")
    expect(sent[1]).toEqual({ type: "prompt", sessionId: "c1", text: "How do vite proxies work?" })
    expect(useStore.getState().route).toBe("workspace")
    expect(useStore.getState().selectedSession).toBe("c1")
  })

  it("starts a research chat when Research is ticked (W1-10)", async () => {
    render(<NewChat />)
    fireEvent.change(screen.getByRole("textbox", { name: "What do you want to know?" }), {
      target: { value: "What changed in Vite 8?" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: /Research/ }))
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    await waitFor(() =>
      expect(sent[0]).toMatchObject({ type: "create_session", kind: "chat", research: true }),
    )
  })

  it("asks only about an open code session: none open, nothing to ask about; one chosen from its menu comes chosen", async () => {
    useStore.setState({ sessions: { talk: info("talk", { kind: "chat" }) as never } })
    const { unmount } = render(<NewChat />)
    fireEvent.change(screen.getByRole("textbox", { name: "What do you want to know?" }), {
      target: { value: "How far has it got?" },
    })
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/No code session is open/)).toBeTruthy()
    unmount()
    useStore.setState({
      sessions: { a: info("a") as never, b: info("b") as never },
      newChatAbout: "b",
    })
    render(<NewChat />)
    const which = screen.getByRole("combobox", { name: "Which session" }) as HTMLSelectElement
    expect(which.value).toBe("b")
    expect(useStore.getState().newChatAbout).toBeUndefined()
    fireEvent.change(screen.getByRole("textbox", { name: "What do you want to know?" }), {
      target: { value: "What changed today?" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    await waitFor(() => expect(sent[0]).toMatchObject({ type: "create_session", about: "b" }))
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
    // Only what the chat made to show you (W1-09): no plan, files, changes or terminal.
    const panels = screen.getByRole("group", { name: "Side panels" })
    expect([...panels.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Artifacts",
      "Sources",
      "Memory",
      // O21: its details, as every session has.
      "Details",
    ])
    expect(screen.queryByRole("combobox", { name: /^Mode$/ })).toBeNull()
    expect(screen.getByText(/never changes files/)).toBeTruthy()
  })

  it("says which code session a question is about, and that it changes nothing", () => {
    useStore.setState({
      sessions: {
        c1: info("c1", {
          kind: "chat",
          about: { id: "code1", title: "Codehouse", cwd: "C:/dev/gatehouse" },
        }) as never,
      },
      selectedSession: "c1",
    })
    render(<Workspace />)
    expect(screen.getByText(/About the code session Codehouse/)).toBeTruthy()
    expect(screen.getByText(/never changes anything/)).toBeTruthy()
  })
})
