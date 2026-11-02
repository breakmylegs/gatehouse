// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EarlierSessions } from "../src/components/EarlierSessions"
import { toMarkdown } from "../src/lib/exportMarkdown"
import { groupByFolder } from "../src/lib/rail"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

const sent: Array<Record<string, unknown>> = []
let history: unknown[] = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      if (cmd.type === "list_history") return { ok: true, data: history }
      if (cmd.type === "create_session") return { ok: true, data: { sessionId: "new1" } }
      if (cmd.type === "search_history")
        return {
          ok: true,
          data: {
            complete: true,
            hits: [
              {
                sessionId: "p1",
                title: "Login fix",
                cwd: "C:/dev/shop",
                lastModified: 1,
                snippets: ["the login button"],
              },
            ],
          },
        }
      if (cmd.type === "context_usage")
        return {
          ok: true,
          data: {
            percentage: 34,
            totalTokens: 68_000,
            maxTokens: 200_000,
            categories: [
              { name: "Messages", tokens: 40_000, kind: "used" },
              { name: "System tools", tokens: 20_000, kind: "used" },
              { name: "Free space", tokens: 132_000, kind: "free" },
            ],
          },
        }
      return { ok: true, data: {} }
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
  cwd: `C:/dev/${id}`,
  project: id,
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-30T10:00:00Z",
  sdkSessionId: `sdk-${id}`,
  ...extra,
})

beforeEach(() => {
  sent.length = 0
  history = []
  useStore.setState({
    sessions: { s1: info("s1") as never },
    transcripts: {},
    panes: [],
    selectedSession: "s1",
  })
})
afterEach(cleanup)

describe("the sidebar's sessions", () => {
  it("puts pinned ones first and leaves archived ones out", () => {
    const groups = groupByFolder([
      info("a") as never,
      info("b", { pinned: true }) as never,
      info("c", { archived: true }) as never,
    ])
    expect(groups.map((g) => [g.label, g.sessions.map((s) => s.id)])).toEqual([
      ["Pinned", ["b"]],
      ["dev", ["a"]],
    ])
  })
})

describe("a session's own menu", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("button", { name: /: switch, open beside, rename/ }))

  it("renames it by its Claude Code id, and pins it", async () => {
    render(<Workspace />)
    open()
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename..." }))
    const dialog = screen.getByRole("dialog", { name: "Rename" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Title/ }), {
      target: { value: "Login fix" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(sent.find((c) => c.type === "session_meta")).toMatchObject({
        sdkSessionId: "sdk-s1",
        title: "Login fix",
      }),
    )
    open()
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin to the top" }))
    await waitFor(() =>
      expect(sent.filter((c) => c.type === "session_meta").at(-1)).toMatchObject({ pinned: true }),
    )
  })

  it("archives it by closing it first", async () => {
    render(<Workspace />)
    open()
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }))
    // The context meter asks too; only the archive matters here.
    const acts = () => sent.filter((c) => c.type !== "context_usage")
    await waitFor(() =>
      expect(acts().map((c) => c.type)).toEqual(["close_session", "session_meta"]),
    )
    expect(acts()[1]).toMatchObject({ archived: true })
  })

  it("shows how full the context is, and what fills it", async () => {
    render(<Workspace />)
    const meter = await screen.findByRole("button", {
      name: /Context 34% used, 68k of 200k tokens/,
    })
    fireEvent.click(meter)
    const panel = screen.getByRole("group", { name: "What fills the context" })
    expect(within(panel).getByText("Messages")).toBeTruthy()
    expect(within(panel).queryByText("Free space")).toBeNull()
  })
})

describe("earlier sessions", () => {
  beforeEach(() => {
    history = [
      { sessionId: "sdk-s1", title: "Already open", cwd: "C:/dev/s1", lastModified: 5, meta: {} },
      { sessionId: "p1", title: "Login fix", cwd: "C:/dev/shop", lastModified: 4, meta: {} },
      {
        sessionId: "p2",
        title: "Old idea",
        cwd: "C:/dev/idea",
        lastModified: 3,
        meta: { archived: true },
      },
      {
        sessionId: "p3",
        title: "Starred",
        cwd: "C:/dev/star",
        lastModified: 1,
        meta: { pinned: true },
      },
    ]
  })

  it("lists past sessions, pinned first, without those open now or archived ones", async () => {
    render(<EarlierSessions />)
    const list = await screen.findByRole("list", { name: "Earlier sessions" })
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining("Starred"), expect.stringContaining("Login fix")])
    fireEvent.click(screen.getByRole("checkbox", { name: "Show archived" }))
    expect(within(list).getByText(/Old idea/)).toBeTruthy()
  })

  it("resumes one where it stopped, or forks a copy", async () => {
    render(<EarlierSessions />)
    const list = await screen.findByRole("list", { name: "Earlier sessions" })
    const row = within(list)
      .getByText(/Login fix/)
      .closest("li")!
    fireEvent.click(within(row).getByRole("button", { name: "Fork" }))
    await waitFor(() =>
      expect(sent.find((c) => c.type === "create_session")).toEqual({
        type: "create_session",
        cwd: "C:/dev/shop",
        resume: "p1",
        fork: true,
      }),
    )
    expect(useStore.getState().route).toBe("workspace")
  })

  it("searches inside what was said", async () => {
    render(<EarlierSessions />)
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Search inside past conversations" }),
      {
        target: { value: "login" },
      },
    )
    fireEvent.click(screen.getByRole("button", { name: "Search what was said" }))
    expect(await screen.findByText("the login button")).toBeTruthy()
    expect(sent.find((c) => c.type === "search_history")).toEqual({
      type: "search_history",
      query: "login",
    })
  })
})

describe("an export", () => {
  it("holds what was said and the commands that ran, never their output", () => {
    const md = toMarkdown(
      [
        { id: "1", kind: "user", text: "Fix the login", at: Date.now() },
        { id: "2", kind: "text", text: "Looking now." },
        {
          id: "3",
          kind: "tool",
          toolUseId: "t",
          name: "Bash",
          input: { command: "npm test" },
          result: { text: "SECRET OUTPUT", isError: false },
        },
        { id: "4", kind: "text", text: "Fixed." },
      ],
      { title: "Login fix", cwd: "C:/dev/shop" },
    )
    expect(md).toMatch(/^# Login fix/)
    expect(md).toContain("## You")
    expect(md).toContain("Fix the login")
    expect(md).toContain("> npm test")
    expect(md).not.toContain("SECRET OUTPUT")
  })
})
