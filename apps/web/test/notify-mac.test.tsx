// @vitest-environment jsdom
// Mac fork (owner, 25 Nov): Deny and Allow once from the Mac's notification of a request. The page answers as a row of
// Approvals does; Allow once goes only for a permission below High that is not default to no, whatever the window
// sent, and anything else, or an answer the Host refused, opens the window on the request instead.
import type { PendingView } from "@gatehouse/shared/ws-protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startShell } from "../src/lib/quickKey"
import { useStore } from "../src/store"

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }), Toaster: () => null }))
const sent: Array<Record<string, unknown>> = []
let reply: { ok: boolean; error?: { code: string; message: string } } = { ok: true }
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (c: Record<string, unknown>) => (sent.push(c), reply)) }
})

const ID = "0195f0c2-7d1e-7abc-9def-0123456789ab"
const view = (o: { risk: number; kind?: string; defaultToNo?: boolean }) =>
  ({
    request: {
      id: ID,
      kind: o.kind ?? "permission",
      toolName: "Bash",
      createdAt: new Date(Date.now() - 5000).toISOString(),
      verdict: { risk: o.risk },
    },
    rawInput: {},
    defaultToNo: o.defaultToNo === true,
  }) as unknown as PendingView

let deliver: ((e: { data: unknown }) => void) | undefined
const posted: string[] = []
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
beforeEach(() => {
  sent.length = 0
  posted.length = 0
  reply = { ok: true }
  ;(globalThis as { chrome?: unknown }).chrome = {
    webview: {
      postMessage: (m: string) => void posted.push(m),
      addEventListener: (_t: string, f: (e: { data: unknown }) => void) => (deliver = f),
      removeEventListener: () => (deliver = undefined),
    },
  }
})
afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

describe("a request's buttons on the Mac's notification", () => {
  it("says when the page listens, so the window can pass on a folder from the Finder", () => {
    const stop = startShell()
    expect(posted).toContain("shell-ready")
    stop()
  })

  it("denies, and allows a Moderate permission once without the card opened", async () => {
    const stop = startShell()
    useStore.setState({ pending: { [ID]: view({ risk: 50 }) } })
    deliver?.({ data: `notify-deny:${ID}` })
    deliver?.({ data: `notify-allow:${ID}` })
    await settle()
    expect(sent).toEqual([
      { type: "deny", requestId: ID },
      { type: "approve", requestId: ID, opened: false, shownMs: expect.any(Number) },
    ])
    expect(posted).not.toContain(`notify-open:${ID}`)
    stop()
  })

  it("never allows a High one, a question, a plan or one that is default to no: the window opens on it", async () => {
    const stop = startShell()
    for (const v of [view({ risk: 70 }), view({ risk: 95 }), view({ risk: 10, kind: "question" }), view({ risk: 10, kind: "plan" }), view({ risk: 10, defaultToNo: true })]) {
      posted.length = 0
      useStore.setState({ pending: { [ID]: v } })
      deliver?.({ data: `notify-allow:${ID}` })
      await settle()
      expect(posted).toEqual([`notify-open:${ID}`])
    }
    expect(sent).toEqual([])
    stop()
  })

  it("opens the window when the Host refuses, and does nothing for a request already decided or a bad id", async () => {
    const stop = startShell()
    useStore.setState({ pending: { [ID]: view({ risk: 20 }) } })
    reply = { ok: false, error: { code: "friction", message: "Look at what this one does" } }
    deliver?.({ data: `notify-allow:${ID}` })
    await settle()
    expect(posted).toContain(`notify-open:${ID}`)
    posted.length = 0
    sent.length = 0
    useStore.setState({ pending: {} })
    deliver?.({ data: `notify-deny:${ID}` })
    deliver?.({ data: "notify-allow:x\nopen-request:y" })
    await settle()
    expect([sent, posted]).toEqual([[], []])
    stop()
  })
})
