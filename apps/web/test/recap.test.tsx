// @vitest-environment jsdom
// B14: after ten minutes or more away, each open session says what happened while you were gone, in up to five
// lines, until you choose Got it.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { _cameBack, AWAY_MS, dismissRecap, recapLines, recapOf } from "../src/lib/recap"
import type { Item } from "../src/lib/transcript"

const api = vi.fn(
  async (..._a: unknown[]) =>
    ({ ok: false, status: 404 }) as { ok: boolean; status: number; data?: unknown },
)
vi.mock("../src/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }))
const { useStore } = await import("../src/store")
const { RecapCard } = await import("../src/components/RecapCard")

const since = Date.parse("2026-11-03T09:00:00Z")
const later = since + 60_000
const earlier = since - 60_000
const edit = (file: string, at: number, isError = false): Item => ({
  id: file + at,
  kind: "tool",
  at,
  toolUseId: file,
  name: "Edit",
  input: { file_path: file },
  result: { text: "", isError },
})
const turn = (at: number): Item => ({ id: `r${at}`, kind: "result", at, text: "", isError: false })

describe("what a session did while you were away", () => {
  it("says its turns, the files it changed, what was decided, what waits and whether it stopped", () => {
    expect(
      recapOf({
        since,
        cwd: "C:\\dev\\shop",
        items: [
          edit("C:\\dev\\shop\\old.ts", earlier),
          turn(earlier),
          edit("C:\\dev\\shop\\src\\a.ts", later),
          edit("C:\\dev\\shop\\src\\a.ts", later + 1),
          edit("C:\\dev\\shop\\b.ts", later),
          edit("C:\\dev\\shop\\failed.ts", later, true),
          turn(later),
          turn(later + 2),
        ],
        decided: [
          { outcome: "allow", at: new Date(later).toISOString() },
          { outcome: "deny", at: new Date(later).toISOString() },
          { outcome: "allow", at: new Date(earlier).toISOString() },
        ],
        waiting: 1,
        state: "error",
        error: "the network dropped",
      }),
    ).toEqual([
      "Claude finished 2 turns.",
      "Changed 2 files: src/a.ts and b.ts.",
      "2 requests were decided: 1 allowed, 1 not.",
      "1 request is waiting for you.",
      "It stopped: the network dropped.",
    ])
  })

  it("is nothing when nothing happened, and names a few files then counts the rest", () => {
    expect(
      recapOf({
        since,
        cwd: "C:\\x",
        items: [turn(earlier)],
        decided: [],
        waiting: 0,
        state: "idle",
      }),
    ).toEqual([])
    const many = ["a", "b", "c", "d", "e"].map((n) => edit(`C:\\x\\${n}.ts`, later))
    expect(
      recapOf({ since, cwd: "C:\\x", items: many, decided: [], waiting: 0, state: "running" }),
    ).toEqual(["Claude is still working.", "Changed 5 files: a.ts, b.ts and 3 more."])
  })
})

describe("the card", () => {
  beforeEach(() => {
    dismissRecap()
    useStore.setState({
      sessions: {
        s1: {
          id: "s1",
          cwd: "C:\\dev\\shop",
          project: "shop",
          mode: "default",
          state: "idle",
          pendingApprovals: 0,
          createdAt: "2026-11-03T08:00:00Z",
        },
      },
      transcripts: {
        s1: { items: [edit("C:\\dev\\shop\\a.ts", Date.now() - 60_000)] } as never,
      },
      resolved: {},
      pending: {},
    })
  })
  afterEach(cleanup)

  it("shows only after ten minutes or more away, and goes on Got it", () => {
    render(<RecapCard sessionId="s1" />)
    act(() => _cameBack(Date.now() - 5 * 60_000))
    expect(screen.queryByRole("region", { name: "While you were away" })).toBeNull()
    act(() => _cameBack(Date.now() - AWAY_MS - 60_000))
    const card = screen.getByRole("region", { name: "While you were away" })
    expect(card.textContent).toContain("Changed 1 file: a.ts.")
    fireEvent.click(screen.getByRole("button", { name: "Got it" }))
    expect(screen.queryByRole("region", { name: "While you were away" })).toBeNull()
  })
})

describe("written by Claude in plain English (owner, 4 Nov)", () => {
  const said = (at: number): Item[] => [
    { id: "u1", kind: "user", at, text: "Build the login page" } as Item,
    { id: "t1", kind: "text", at: at + 1, text: "Done. The tests still fail." },
    { id: "t2", kind: "text", at: at + 2, text: "inside a subagent", subagent: "a1" },
  ]
  beforeEach(() => {
    dismissRecap()
    api.mockReset()
    useStore.setState({
      sessions: {
        s1: {
          id: "s1",
          cwd: "C:\\dev\\shop",
          project: "shop",
          mode: "default",
          state: "running",
          pendingApprovals: 0,
          createdAt: "2026-11-03T08:00:00Z",
        },
      },
      transcripts: {
        s1: { items: [turn(Date.now() - 60_000), ...said(Date.now() - 50_000)] } as never,
      },
      resolved: {},
      pending: {},
    })
  })
  afterEach(cleanup)

  it("sends only what you and Claude said since you left, and leaves out a subagent's own words", () => {
    const items = [{ id: "old", kind: "text", at: earlier, text: "before" } as Item, ...said(later)]
    expect(recapLines(items, since)).toEqual([
      { who: "you", text: "Build the login page" },
      { who: "claude", text: "Done. The tests still fail." },
    ])
    expect(
      recapLines([{ id: "old", kind: "text", at: earlier, text: "before" } as Item], since),
    ).toEqual([])
  })

  it("shows Claude's summary first, with the list underneath", async () => {
    api.mockResolvedValue({
      ok: true,
      status: 200,
      data: { summary: "Claude built the login page; the tests still need fixing." },
    })
    render(<RecapCard sessionId="s1" />)
    act(() => _cameBack(Date.now() - AWAY_MS - 120_000))
    expect(
      await screen.findByText("Claude built the login page; the tests still need fixing."),
    ).toBeTruthy()
    expect(screen.getByText(/Claude finished a turn and is still working/)).toBeTruthy()
    const [, url, body] = api.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(url).toBe("/api/recap")
    expect(body).toMatchObject({
      session: "s1",
      state: "still working",
      lines: [{ who: "you" }, { who: "claude" }],
    })
  })

  it("is the list alone when Claude does not write it", async () => {
    api.mockResolvedValue({ ok: true, status: 200, data: { skipped: "off" } })
    render(<RecapCard sessionId="s1" />)
    act(() => _cameBack(Date.now() - AWAY_MS - 120_000))
    await vi.waitFor(() => expect(api).toHaveBeenCalled())
    await vi.waitFor(() => expect(screen.queryByText("Claude is writing a summary…")).toBeNull())
    expect(screen.getByText(/Claude finished a turn and is still working/)).toBeTruthy()
  })
})
