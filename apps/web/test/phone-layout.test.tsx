// @vitest-environment jsdom
// O55 (owner, 25 Nov): the phone layout, switched on by the window's size (PHONE_QUERY), never by where the page came
// from. At phone width the desktop's sidebar, its resizer, the section pills and the help column are not drawn, the tab
// bar is; a session opens alone, full-screen, with a back button; a request opens as a screen of its own with the same
// card, every check included. At a computer's width nothing of the phone's is drawn. The real browser's half (nothing
// sideways, 44 px targets, the sheets) is phone-browser.test.ts.
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PHONE_QUERY } from "../src/lib/phone"

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
// jsdom has no layout, so the virtual list would draw no rows: every row, plainly, here.
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data = [], itemContent, computeItemKey }: { data?: unknown[]; itemContent: (i: number, d: unknown) => unknown; computeItemKey?: (i: number, d: unknown) => string }) =>
    data.map((d, i) => <div key={computeItemKey ? computeItemKey(i, d) : i}>{itemContent(i, d) as never}</div>),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const { App } = await import("../src/App")
// The workspace loads when first shown: loaded here, so a test does not wait for it.
await import("../src/surfaces/Workspace")
const { useStore } = await import("../src/store")

let phone = false
function media(on: boolean) {
  phone = on
  window.matchMedia = ((q: string) => ({
    matches: q === PHONE_QUERY ? phone : false,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const health = {
  approver: { state: "up" as const, errors: [] },
  relay: { state: "not-configured" as const, devices: 0 },
  signin: { signedIn: true, email: "a@b.c", organization: "Org", managedPolicy: "detected" as const, orgOk: true },
  killSwitch: { engaged: false, approverConfirmed: true },
  pwsh: { running: true },
}
const base = { mode: "default" as const, pendingApprovals: 0, createdAt: "2026-11-01T09:00:00Z" }
const sessions = [
  { ...base, id: "s1", cwd: "C:/dev/shop", project: "shop", state: "running" as const },
  { ...base, id: "s2", cwd: "C:/dev/docs", project: "docs", state: "idle" as const },
]
const severe: PendingView = {
  request: {
    id: "r1",
    nonce: "n",
    kind: "permission",
    sessionId: "s1",
    toolUseId: "tu1",
    toolName: "Bash",
    input: { command: "git push --force origin main" },
    cwd: "C:/dev/shop",
    project: "shop",
    verdict: { outcome: "escalate", ruleId: "force-push", reason: "A force push can overwrite shared history.", risk: 90, decidedBy: "rules", policyHash: "h" },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    payloadHash: "p",
  },
  rawInput: { command: "git push --force origin main" },
  defaultToNo: true,
  phone: "delivered",
  hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
} as PendingView

function start(route: string, extra: Record<string, unknown> = {}) {
  useStore.getState().handleEvent({ type: "hello", sessions, pending: [severe], health, usage: {} } as never)
  useStore.setState({ route: route as never, setupDone: true, ...extra })
  return render(<App />)
}
const names = (el: HTMLElement) => within(el).queryAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim())

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.layout
})

describe("at phone width (O55)", () => {
  beforeEach(() => media(true))

  it("draws the tab bar and none of the desktop's sidebar, resizer, pills or help column", () => {
    const { container } = start("approvals")
    expect(document.documentElement.dataset.layout).toBe("phone")
    const tabs = screen.getByRole("navigation", { name: "Sections" })
    expect(within(tabs).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Needs you, 1", "Sessions, 1", "Ask", "More"])
    for (const sel of [".rail", ".rail-resizer", ".show-rail", ".section-pills"]) expect(container.querySelector(sel), sel).toBeNull()
    expect(screen.queryByRole("complementary", { name: /help/i })).toBeNull()
  })

  it("opens a request as a screen of its own, with the same card and every button it has on a computer", async () => {
    start("approvals")
    const page = document.querySelector<HTMLElement>(".approvals-page")!
    expect(page.dataset.phoneScreen).toBe("queue")
    fireEvent.click(document.querySelector(".board-row")!)
    expect(page.dataset.phoneScreen).toBe("card")
    const onPhone = names(await screen.findByRole("region", { name: "Selected request" }))
    fireEvent.click(screen.getByRole("button", { name: "Back to Needs you" }))
    expect(page.dataset.phoneScreen).toBe("queue")
    cleanup()
    media(false)
    start("approvals")
    const onComputer = names(await screen.findByRole("region", { name: "Selected request" }))
    // The phone adds only its back button: Severe still asks for what it asks for on a computer.
    expect(onPhone.filter((n) => n !== "Back to Needs you")).toEqual(onComputer)
  })

  it("opens a session alone and full-screen, with a back button to the list and no tab bar", async () => {
    const { container } = start("workspace", { selectedSession: "s2", panes: ["s1", "s2"], focusPane: 1 })
    await screen.findByRole("button", { name: "Back to Sessions" }, { timeout: 15_000 })
    expect(container.querySelectorAll(".pane-slot")).toHaveLength(1)
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull()
    // The panes you set on a computer are kept for when you are back there.
    expect(useStore.getState().panes).toEqual(["s1", "s2"])
    fireEvent.click(screen.getByRole("button", { name: "Back to Sessions" }))
    expect(useStore.getState().route).toBe("sessions")
    const list = screen.getByRole("list", { name: "Sessions" })
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringMatching(/^shop.*Working$/), expect.stringMatching(/^docs.*Ready$/)])
  })

  it("says a page made for a big screen is best opened on a computer", () => {
    start("policy")
    expect(screen.getByRole("heading", { name: "Open this on a computer" })).toBeTruthy()
    expect(document.querySelector("main h1")?.textContent).toBe("Open this on a computer")
  })

  it("follows the window: narrowed to a phone, then widened again", () => {
    media(false)
    const { container, rerender } = start("approvals")
    expect(container.querySelector(".rail")).not.toBeNull()
    act(() => media(true))
    rerender(<App />)
    expect(container.querySelector(".rail")).toBeNull()
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy()
  })
})

describe("at a computer's width", () => {
  beforeEach(() => media(false))

  it("is drawn as before: the sidebar, both panes, no tab bar, no back button", async () => {
    const { container } = start("workspace", { selectedSession: "s2", panes: ["s1", "s2"] })
    expect(container.querySelector(".rail")).not.toBeNull()
    await vi.waitFor(() => expect(container.querySelectorAll(".pane-slot")).toHaveLength(2), { timeout: 15_000 })
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull()
    expect(document.documentElement.dataset.layout).toBeUndefined()
  })
})
