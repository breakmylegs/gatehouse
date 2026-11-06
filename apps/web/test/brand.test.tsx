// @vitest-environment jsdom
// The Codehouse visual identity pack (owner, 2 Nov): the app's icons, spot pictures and scenes are the pack's own
// files, not drawn by the build. Each icon a component names is in the pack's sprite, and each picture is on disk.
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EMPTY_PICTURES, EmptyState } from "../src/components/EmptyState"
import { Icon, ICON_NAMES, SPRITE } from "../src/components/Icon"

vi.mock("../src/lib/connection", () => ({
  takeToken: () => "token",
  Connection: class {
    start() {}
    send() {
      return Promise.resolve({ ok: true })
    }
  },
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))

const { useStore } = await import("../src/store")
const { Rail } = await import("../src/components/Rail")

const pub = join(__dirname, "..", "public")
const sprite = readFileSync(join(pub, SPRITE), "utf8")

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ route: "chat", selectedSession: undefined, panes: [], sessions: {} })
})
afterEach(cleanup)

describe("the pack's interface icons", () => {
  it("are every symbol in the pack's sprite, and no other", () => {
    const symbols = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1])
    expect([...ICON_NAMES].sort()).toEqual(symbols.sort())
  })

  it("draw from the sprite, take the text colour and are hidden from screen readers", () => {
    const { container } = render(<Icon name="kill-switch" />)
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("aria-hidden")).toBe("true")
    expect(svg.querySelector("use")!.getAttribute("href")).toBe(`${SPRITE}#kill-switch`)
    expect(sprite).not.toMatch(/<script|\son[a-z]+=|href=/i)
    expect(sprite).toMatch(/stroke="currentColor"/)
  })

  it("mark the sidebar's pages and the state of each session", () => {
    useStore.setState({
      route: "sessions",
      sessions: {
        a: {
          id: "a",
          cwd: "C:\\dev\\shop",
          project: "shop",
          mode: "default",
          state: "waiting",
          pendingApprovals: 1,
          createdAt: "2026-11-02T08:00:00Z",
        },
      },
    })
    const { container } = render(<Rail onHide={() => undefined} />)
    const used = new Set(
      [...container.querySelectorAll("svg[data-icon]")].map((s) => s.getAttribute("data-icon")),
    )
    for (const name of ["sidebar-hide", "chat", "code", "home", "new", "search", "needs-you"])
      expect(used, name).toContain(name)
  })
})

describe("the pack's spot pictures", () => {
  it("are all on disk", () => {
    for (const p of EMPTY_PICTURES)
      expect(existsSync(join(pub, "codehouse", "empty", `${p}.png`)), p).toBe(true)
  })

  it("show above what to do next, as decoration a screen reader skips", () => {
    render(
      <EmptyState picture="all-done">
        <p>Nothing is waiting.</p>
      </EmptyState>,
    )
    const img = document.querySelector("img")!
    expect(img.getAttribute("src")).toBe("./codehouse/empty/all-done.png")
    expect(img.getAttribute("alt")).toBe("")
    expect(screen.getByText("Nothing is waiting.")).toBeTruthy()
  })

  it("fill an empty sidebar: chats on the Chat side", () => {
    render(<Rail onHide={() => undefined} />)
    expect(document.querySelector('.empty-state[data-picture="empty-chats"]')).toBeTruthy()
    expect(screen.getByText(/No chats yet/)).toBeTruthy()
    // claude.ai chats come in from its export, so the empty list says where (owner, 6 Nov).
    fireEvent.click(screen.getByRole("button", { name: "Bring in your chats from claude.ai" }))
    expect(localStorage.getItem("gatehouse.settings.section")).toBe("privacy")
    expect(useStore.getState().route).toBe("settings")
  })
})
