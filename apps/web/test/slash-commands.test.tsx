// @vitest-environment jsdom
// Claude Code's own commands and skills, from the plus menu, reach Claude as typed; JCVC's own still work.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readInit } from "../src/lib/sessionMeta"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

const sent: Array<Record<string, unknown>> = []
const errors: string[] = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return { ok: true }
    }),
  }
})
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: (m: string) => errors.push(m) }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (i: number, d: unknown) => React.ReactNode }) => (
    <div>
      {data.map((d, i) => (
        <div key={i}>{itemContent(i, d)}</div>
      ))}
    </div>
  ),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

beforeEach(() => {
  sent.length = 0
  errors.length = 0
  useStore.setState({
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-10-31T10:00:00Z",
      },
    },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
    meta: {
      s1: readInit({ type: "system", subtype: "init", slash_commands: ["review"], skills: ["pdf"] })!,
    },
  })
})
afterEach(cleanup)

const prompts = () => sent.filter((c) => c.type === "prompt")
function type(text: string) {
  const box = screen.getByRole("textbox", { name: "Prompt" })
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: "Enter" })
}

describe("slash commands in the prompt box", () => {
  it("sends a Claude Code command or skill the session offers, as typed", async () => {
    render(<Workspace />)
    type("/review the login change")
    await waitFor(() => expect(prompts()).toEqual([{ type: "prompt", sessionId: "s1", text: "/review the login change" }]))
    type("/pdf")
    await waitFor(() => expect(prompts()).toHaveLength(2))
    expect(errors).toEqual([])
  })

  it("still runs JCVC's own commands, and says when a command is unknown", async () => {
    render(<Workspace />)
    type("/plan")
    await waitFor(() => expect(sent).toContainEqual({ type: "set_mode", sessionId: "s1", mode: "plan" }))
    type("/pln")
    await waitFor(() => expect(errors).toEqual(["Unknown command /pln. Type / to see the list."]))
    expect(prompts()).toEqual([])
  })
})
