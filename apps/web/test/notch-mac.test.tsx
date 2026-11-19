// @vitest-environment jsdom
// Mac fork (owner, 14 Nov): the wing beside the notch shows what waits on you until it is decided, with an Approvals
// row's own Deny and Allow once; a Severe request, a question or a plan opens the main window instead.
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startShell } from "../src/lib/quickKey"
import { useStore } from "../src/store"
import { NotchMac } from "../src/surfaces/NotchMac"

const sent: unknown[] = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (cmd: unknown) => (sent.push(cmd), { ok: true })) }
})

const told: string[] = []
let listeners: Array<(e: { data: unknown }) => void> = []
const toPage = (data: string) => listeners.forEach((l) => l({ data }))

function view(id: string, kind: "permission" | "question", risk: number, project: string): PendingView {
  return {
    request: {
      id,
      nonce: "n",
      kind,
      sessionId: "s1",
      toolUseId: `tu-${id}`,
      toolName: kind === "question" ? "AskUserQuestion" : "Bash",
      input: { command: "git push" },
      cwd: "/Users/someone/dev/atlas",
      project,
      verdict: { outcome: "escalate", ruleId: "git-push", reason: "It pushes.", risk, decidedBy: "rules", policyHash: "h" },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      payloadHash: "p",
    },
    rawInput: { command: "git push" },
    defaultToNo: risk >= 70,
    phone: "delivered",
    hardDeadline: new Date(Date.now() + 1_800_000).toISOString(),
  } as PendingView
}

beforeEach(() => {
  told.length = 0
  sent.length = 0
  listeners = []
  ;(globalThis as Record<string, unknown>).chrome = {
    webview: {
      postMessage: (m: string) => told.push(m),
      addEventListener: (_: string, l: (e: { data: unknown }) => void) => listeners.push(l),
      removeEventListener: () => undefined,
    },
  }
  ;(globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  useStore.setState({ conn: "open", pending: {} })
})
afterEach(() => {
  cleanup()
  delete (globalThis as Record<string, unknown>).chrome
})

describe("the wing beside the notch", () => {
  it("hides while nothing waits", () => {
    render(<NotchMac />)
    expect(told).toContain("notch:hide")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("shows how many wait and the highest risk, decides a routine request, and opens the rest in the window", async () => {
    const low = view("r-low", "permission", 30, "atlas")
    const severe = view("r-severe", "permission", 95, "billing")
    const question = view("r-q", "question", 10, "docs")
    useStore.setState({ pending: { [low.request.id]: low, [severe.request.id]: severe, [question.request.id]: question } })
    render(<NotchMac />)
    expect(told.some((m) => m.startsWith("notch:size:"))).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: /3 waiting on you, the highest Severe risk/ }))
    const list = screen.getByRole("list", { name: "Waiting on you" })
    expect(list.children).toHaveLength(3)

    // A routine request: the Approvals row's own Allow once, sent as a decision from the desktop.
    await userEvent.click(screen.getAllByRole("button", { name: "Allow once" })[0]!)
    expect(sent).toContainEqual(expect.objectContaining({ type: "approve", requestId: "r-low", opened: false }))
    // A Severe request is never allowed here, and a question is answered in the window.
    expect(screen.getAllByRole("button", { name: "Allow once" })).toHaveLength(1)
    await userEvent.click(screen.getByRole("button", { name: "Read it first" }))
    await userEvent.click(screen.getByRole("button", { name: "Open" }))
    expect(told.filter((m) => m.startsWith("notch-open:"))).toEqual(["notch-open:r-severe", "notch-open:r-q"])

    // Decided anywhere, it goes; when nothing is left the wing hides.
    act(() => useStore.setState({ pending: {} }))
    expect(told.at(-1)).toBe("notch:hide")
  })

  it("takes the shape of where the window puts it: against the notch, or a pill under another screen's menu bar", () => {
    const low = view("r-low", "permission", 30, "atlas")
    useStore.setState({ pending: { [low.request.id]: low } })
    const { container } = render(<NotchMac />)
    const box = () => container.querySelector(".notch")!
    expect(box().hasAttribute("data-free")).toBe(false)
    act(() => toPage("notch-place:free"))
    expect(box().hasAttribute("data-free")).toBe(true)
    act(() => toPage("notch-place:notch"))
    expect(box().hasAttribute("data-free")).toBe(false)
  })

  it("shows the fighter's face where the dot was, ringed with the highest risk (owner, 19 Nov)", () => {
    const high = view("r-high", "permission", 80, "gatehouse")
    useStore.setState({ pending: { [high.request.id]: high } })
    const { container } = render(<NotchMac />)
    const face = container.querySelector(".notch-wing .fighter-face") as HTMLElement
    expect(face.style.backgroundImage).toContain("fighter.png")
    expect(face.style.backgroundPosition).toBe("-28px -1px")
    expect(container.querySelector(".notch")!.getAttribute("data-risk")).toBe("high")
  })

  it("the main window opens a request it is told of, on Approvals", () => {
    const severe = view("r-severe", "permission", 95, "billing")
    useStore.setState({ pending: { [severe.request.id]: severe }, route: "workspace" })
    const stop = startShell()
    toPage("open-request:r-severe")
    expect(useStore.getState()).toMatchObject({ route: "approvals", selectedRequest: "r-severe" })
    toPage("open-request:gone")
    expect(useStore.getState().selectedRequest).toBe("r-severe")
    stop()
  })
})
