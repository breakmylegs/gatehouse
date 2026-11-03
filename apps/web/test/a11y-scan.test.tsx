// @vitest-environment jsdom
// B40: an automated accessibility scan of the main screens with axe-core. Colour contrast needs a real browser, so it
// is checked by apps/web/test/theme-tokens.test.ts instead; everything axe can see in a page's structure is here.
import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { forwardRef, type ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Home } from "../src/surfaces/Home"
import { MemoryPage } from "../src/surfaces/Memory"
import { NewChat } from "../src/surfaces/NewChat"
import { Projects } from "../src/surfaces/Projects"
import { Settings } from "../src/surfaces/Settings"
import { Workspace } from "../src/surfaces/Workspace"
import { setScreenReaderMode } from "../src/lib/screenReader"
import { useStore } from "../src/store"

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string) =>
    url === "/api/settings" && method === "GET"
      ? {
          ok: true,
          status: 200,
          data: {
            path: "C:\\Users\\x\\AppData\\Local\\Gatehouse\\config.json",
            saved: {},
            running: {
              redactTerms: [],
              phoneExpiryMs: 600_000,
              hardTimeoutMs: 1_800_000,
              digestTime: "08:00",
              checkpoints: { beforeEscalation: true, editBursts: true, burstWindowMs: 60_000 },
            },
            workspaceRootsInEffect: [],
            quietHoursInPolicy: null,
          },
        }
      : { ok: false, status: 404, error: "no route" },
  ),
}))
vi.mock("../src/components/UpdatesPanel", () => ({ UpdatesPanel: () => null }))
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

/** What axe finds wrong in what is on the page, as "rule: what (where)" lines. */
async function problems(): Promise<string[]> {
  const r = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    resultTypes: ["violations"],
  })
  return r.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${v.help} (${n.target.join(" ")})`),
  )
}

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-11-03T09:00:00Z",
        resources: "medium",
      },
    },
    transcripts: {
      s1: {
        items: [
          { id: "u1", kind: "user", text: "Fix the login" },
          { id: "t1", kind: "text", text: "Looking now." },
        ],
        todos: [],
        seq: 2,
      },
    } as never,
    pending: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
  })
})
afterEach(() => {
  cleanup()
  setScreenReaderMode(false)
})

const SCREENS: Array<[string, () => ReactElement]> = [
  ["Home", () => <Home />],
  ["a session", () => <Workspace />],
  ["Start a chat", () => <NewChat />],
  ["Projects", () => <Projects />],
  ["Memory", () => <MemoryPage />],
  ["Settings", () => <Settings />],
]

describe("the accessibility scan", () => {
  for (const [name, draw] of SCREENS)
    it(`finds nothing wrong on ${name}`, async () => {
      render(draw())
      // Let the first loads settle.
      await screen.findAllByRole("button")
      expect(await problems()).toEqual([])
    })

  it("finds nothing wrong on a session in screen reader mode", async () => {
    setScreenReaderMode(true)
    render(<Workspace />)
    await screen.findByRole("list", { name: "Conversation" })
    expect(await problems()).toEqual([])
  })
})
