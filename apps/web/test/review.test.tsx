// @vitest-environment jsdom
// B27, B28: a review, or a security review, of a session's changes by a second session that changes nothing.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { REVIEW_PROMPTS } from "../src/lib/review"
import { send, useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (c: { type: string }) =>
      c.type === "create_session" ? { ok: true, data: { sessionId: "r1" } } : { ok: true },
    ),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function V() {
    return <div />
  }),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const sent = () => vi.mocked(send).mock.calls.map((c) => c[0] as Record<string, unknown>)

beforeEach(() => {
  vi.mocked(send).mockClear()
  localStorage.clear()
  useStore.setState({
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "acceptEdits",
        extreme: true,
        model: "claude-opus-5-5",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-11-04T09:00:00Z",
      },
    },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
  })
})
afterEach(cleanup)

describe("reviewing a session's changes", () => {
  for (const [label, kind] of [
    ["Review the changes", "review"],
    ["Security review of the changes", "security"],
  ] as const)
    it(`${label}: starts in Plan mode in the same folder, never in Extreme approval, and opens beside`, async () => {
      render(<Workspace />)
      fireEvent.click(screen.getByRole("button", { name: /: switch, open beside, rename/ }))
      fireEvent.click(await screen.findByRole("menuitem", { name: label }))
      await waitFor(() => expect(sent().some((c) => c.type === "prompt")).toBe(true))
      expect(sent().find((c) => c.type === "create_session")).toEqual({
        type: "create_session",
        cwd: "C:/dev/shop",
        mode: "plan",
        model: "claude-opus-5-5",
      })
      expect(String(sent().find((c) => c.type === "prompt")?.text)).toContain(REVIEW_PROMPTS[kind])
      expect(useStore.getState().panes).toContain("r1")
    })
})
