// @vitest-environment jsdom
// T-004: the welcome shows the coding agents and runtimes found on this computer, and the projects of recent Claude
// Code conversations, each to open or carry on; nothing starts until you choose.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { recentProjects, WelcomeFound } from "../src/components/WelcomeFound"
import { useStore } from "../src/store"

const sent: Array<Record<string, unknown>> = []
const PAST = [
  { sessionId: "a1", title: "Fix the cart", cwd: "C:\\dev\\shop", lastModified: 300, meta: {} },
  { sessionId: "a0", title: "Older cart work", cwd: "c:\\dev\\SHOP\\", lastModified: 100, meta: {} },
  { sessionId: "b1", title: "Docs", cwd: "C:\\dev\\site", lastModified: 200, meta: {} },
  { sessionId: "c1", title: "Gone", cwd: "C:\\dev\\old", lastModified: 400, meta: { archived: true } },
  { sessionId: "d1", title: "No folder", lastModified: 500, meta: {} },
]
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({
    ok: true,
    status: 200,
    data: {
      agents: [
        { id: "claude", name: "Claude Code", where: "C:\\Users\\p\\AppData\\Roaming\\npm\\claude.cmd" },
        { id: "codex", name: "OpenAI Codex CLI" },
      ],
      runtimes: [
        { kind: "ollama", name: "Ollama", url: "http://127.0.0.1:11434", up: true },
        { kind: "openai-compatible", name: "LM Studio", url: "http://127.0.0.1:1234", up: false },
      ],
    },
  })),
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return cmd.type === "list_history" ? { ok: true, data: PAST } : { ok: true, data: { sessionId: "new-1" } }
    }),
  }
})
afterEach(cleanup)

describe("the welcome (T-004)", () => {
  it("groups recent conversations by project, newest first, with the latest of each, leaving out archived ones", () => {
    expect(recentProjects(PAST).map((p) => [p.name, p.sessions, p.latest.sessionId])).toEqual([
      ["shop", 2, "a1"],
      ["site", 1, "b1"],
    ])
  })

  it("shows what it found and carries on a project's latest conversation only when asked", async () => {
    const onLeave = vi.fn()
    render(<WelcomeFound onLeave={onLeave} />)
    expect(await screen.findByText("Claude Code")).toBeTruthy()
    expect(screen.queryByText("OpenAI Codex CLI")).toBeNull()
    expect(screen.getByText("Ollama")).toBeTruthy()
    expect(screen.queryByText("LM Studio")).toBeNull()
    expect(await screen.findByText("shop")).toBeTruthy()
    expect(sent.filter((c) => c.type === "create_session")).toEqual([])
    const carry = screen.getAllByRole("button", { name: "Carry on" })[0]!
    fireEvent.click(carry)
    await vi.waitFor(() => expect(sent.find((c) => c.type === "create_session")).toEqual({ type: "create_session", cwd: "C:\\dev\\shop", resume: "a1" }))
    await vi.waitFor(() => expect(useStore.getState().route).toBe("workspace"))
    expect(onLeave).toHaveBeenCalled()
  })

  it("opens a project's folder in the start form without starting anything", async () => {
    render(<WelcomeFound onLeave={() => undefined} />)
    fireEvent.click((await screen.findAllByRole("button", { name: "Open" }))[1]!)
    expect(useStore.getState().startFolder).toBe("C:\\dev\\site")
    expect(useStore.getState().route).toBe("sessions")
  })
})
