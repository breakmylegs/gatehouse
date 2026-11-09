// @vitest-environment jsdom
// B34: routines in Settings: listed, added, switched off and removed.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RoutinesPanel } from "../src/components/RoutinesPanel"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let routines: Array<Record<string, unknown>> = []
let runs: Array<Record<string, unknown>> = []
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url === "/api/routines" && method === "GET")
      return { ok: true, status: 200, data: { routines } }
    if (url === "/api/routines/runs") return { ok: true, status: 200, data: { runs } }
    return { ok: true, status: 200, data: {} }
  }),
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (c: { type: string }) =>
      c.type === "changes" ? { ok: true, data: { files: [{}, {}, {}] } } : { ok: true },
    ),
  }
})
const { useStore } = await import("../src/store")

beforeEach(() => {
  calls.length = 0
  runs = []
  routines = [
    {
      id: "r1",
      name: "Triage",
      folder: "C:/dev/shop",
      prompt: "Sort the issues.",
      time: "07:30",
      days: ["mon", "fri"],
      enabled: true,
      lastRun: "2026-11-03",
    },
  ]
})
afterEach(cleanup)

describe("routines in Settings", () => {
  it("lists each with when it runs, and switches one off or removes it", async () => {
    render(<RoutinesPanel />)
    const list = await screen.findByRole("list", { name: "Your routines" })
    expect(list.textContent).toMatch(/Triage.*07:30, mon fri, C:\/dev\/shop, last ran 2026-11-03/)
    fireEvent.click(within(list).getByRole("checkbox", { name: "On" }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({
        id: "r1",
        enabled: false,
      }),
    )
    fireEvent.click(within(list).getByRole("button", { name: "Remove Triage" }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/routines/r1")).toBe(true),
    )
  })

  it("adds one on weekdays by default", async () => {
    routines = []
    render(<RoutinesPanel />)
    const form = await screen.findByRole("form", { name: "Add a routine" })
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), {
      target: { value: "Nightly build" },
    })
    fireEvent.change(within(form).getByRole("textbox", { name: "Folder" }), {
      target: { value: "C:\\dev\\app" },
    })
    fireEvent.change(within(form).getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Build it." },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Add the routine" }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        name: "Nightly build",
        folder: "C:\\dev\\app",
        prompt: "Build it.",
        time: "08:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        extreme: false,
        worktree: false,
        enabled: true,
      }),
    )
  })
})

describe("the review inbox (G23)", () => {
  it("lists recent runs with what waits for you, what changed, the cost, and Open", async () => {
    runs = [
      {
        routineId: "r1",
        name: "Triage",
        sessionId: "s1",
        at: "2026-11-09T07:30:00Z",
        branch: "codehouse/x",
      },
      { routineId: "r1", name: "Triage", sessionId: "gone", at: "2026-11-08T07:30:00Z" },
    ]
    useStore.setState({
      sessions: {
        s1: {
          id: "s1",
          cwd: "C:/w",
          project: "shop",
          mode: "default",
          state: "waiting",
          pendingApprovals: 2,
          createdAt: "2026-11-09T07:30:00Z",
        },
      } as never,
      usage: { bySession: { s1: { costUsd: 0.42 } } } as never,
      transcripts: {},
    })
    render(<RoutinesPanel />)
    const inbox = await screen.findByRole("region", { name: "Recent runs" })
    await waitFor(() => expect(inbox.textContent).toContain("3 files changed"))
    const [first, second] = within(inbox).getAllByRole("listitem")
    expect(first!.textContent).toMatch(/Triage.*codehouse\/x.*2 actions wait for you.*\$0\.42/)
    expect(second!.textContent).toContain("closed")
    expect(within(second!).queryByRole("button")).toBeNull()
    fireEvent.click(within(first!).getByRole("button", { name: "Open the run of Triage" }))
    expect(useStore.getState()).toMatchObject({ route: "workspace", selectedSession: "s1" })
  })

  it("adds a routine that runs in a new worktree each time", async () => {
    routines = []
    render(<RoutinesPanel />)
    const form = await screen.findByRole("form", { name: "Add a routine" })
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), {
      target: { value: "Nightly" },
    })
    fireEvent.change(within(form).getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Tidy up." },
    })
    fireEvent.click(within(form).getByRole("checkbox", { name: "In a new worktree each time" }))
    fireEvent.click(within(form).getByRole("button", { name: "Add the routine" }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ worktree: true }),
    )
  })
})

describe("routines started by a trigger", () => {
  it("adds one that starts on a new commit, with no time or days, and lists it so", async () => {
    routines = [
      {
        id: "r2",
        name: "Review",
        folder: "C:/dev/shop",
        prompt: "Review it.",
        time: "00:00",
        days: [],
        enabled: true,
        trigger: { kind: "files" },
      },
    ]
    render(<RoutinesPanel />)
    const list = await screen.findByRole("list", { name: "Your routines" })
    expect(list.textContent).toMatch(/Review.*when files change, C:\/dev\/shop/)
    const form = screen.getByRole("form", { name: "Add a routine" })
    fireEvent.change(within(form).getByRole("combobox", { name: "Starts" }), {
      target: { value: "commit" },
    })
    expect(within(form).queryByText("Days")).toBeNull()
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), {
      target: { value: "On commit" },
    })
    fireEvent.change(within(form).getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Review the last commit." },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Add the routine" }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({
        name: "On commit",
        trigger: { kind: "commit" },
      }),
    )
  })
})
