// @vitest-environment jsdom
// B10: start a session in a new worktree from a base you name, and remove worktrees from the panel: asked first,
// asked plainly when work not committed would be lost, the branch always kept.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"

const sent: Array<Record<string, unknown>> = []
const posts: unknown[] = []
let rows: Array<Record<string, unknown>> = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return cmd.type === "create_session"
        ? {
            ok: true,
            data: {
              sessionId: "s9",
              info: { cwd: "C:\\dev\\shop.worktrees\\x", worktree: { branch: "codehouse/x" } },
            },
          }
        : { ok: true }
    }),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    if (url === "/api/worktrees") return { ok: true, status: 200, data: { worktrees: rows } }
    if (url === "/api/worktrees/remove") {
      posts.push(body)
      return { ok: true, status: 200, data: { removed: "x", branch: "codehouse/a" } }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

const { Sessions } = await import("../src/surfaces/Sessions")
const row = (o: Record<string, unknown>) => ({
  path: "C:\\dev\\shop.worktrees\\a",
  branch: "codehouse/a",
  repo: "C:\\dev\\shop",
  baseName: "main",
  createdAt: "2026-11-03T01:00:00Z",
  exists: true,
  bytes: 5 * 1024 ** 2,
  changed: 0,
  commits: 2,
  open: false,
  ...o,
})

beforeEach(() => {
  sent.length = 0
  posts.length = 0
  rows = []
  useStore.setState({ sessions: {}, transcripts: {}, activity: {}, route: "sessions" })
})
afterEach(cleanup)

describe("a session in a new worktree", () => {
  it("is asked for with the base you name", async () => {
    render(<Sessions />)
    fireEvent.change(screen.getByRole("textbox", { name: /^Folder/ }), {
      target: { value: "C:\\dev\\shop" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: /Work in a new worktree/ }))
    fireEvent.change(screen.getByRole("textbox", { name: "From" }), {
      target: { value: "release" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    await waitFor(() =>
      expect(sent.find((c) => c.type === "create_session")).toMatchObject({
        cwd: "C:\\dev\\shop",
        worktree: { base: "release" },
      }),
    )
  })
})

describe("the worktrees panel", () => {
  it("shows what each holds, and removes one only after you confirm, keeping the branch", async () => {
    rows = [row({})]
    render(<Sessions />)
    const panel = await screen.findByRole("region", { name: "Worktrees" })
    expect(panel.textContent).toContain("5 MB, 2 commits on its branch, nothing changed")
    fireEvent.click(within(panel).getByRole("button", { name: "Remove the worktree codehouse/a" }))
    expect(posts).toHaveLength(0)
    const ask = within(panel).getByRole("group", { name: "Remove codehouse/a?" })
    expect(ask.textContent).toContain("the branch stays")
    fireEvent.click(within(ask).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(posts).toEqual([{ path: "C:\\dev\\shop.worktrees\\a" }]))
  })

  it("says work not committed would be lost, and only then removes it anyway", async () => {
    rows = [row({ changed: 3 })]
    render(<Sessions />)
    const panel = await screen.findByRole("region", { name: "Worktrees" })
    fireEvent.click(within(panel).getByRole("button", { name: "Remove the worktree codehouse/a" }))
    const ask = within(panel).getByRole("group", { name: "Remove codehouse/a?" })
    expect(ask.textContent).toContain("changes not committed will be lost")
    fireEvent.click(within(ask).getByRole("button", { name: "Remove anyway" }))
    await waitFor(() =>
      expect(posts).toEqual([{ path: "C:\\dev\\shop.worktrees\\a", force: true }]),
    )
  })

  it("does not offer to remove one a session is working in", async () => {
    rows = [row({ open: true })]
    render(<Sessions />)
    const panel = await screen.findByRole("region", { name: "Worktrees" })
    expect(
      (
        within(panel).getByRole("button", {
          name: "Remove the worktree codehouse/a",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})
