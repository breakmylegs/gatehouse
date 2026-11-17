// @vitest-environment jsdom
// T-002: Codehouse.exe <folder> from a terminal opens the start-session form with that folder filled in. Nothing starts
// until you say what to build, and a message that is not a plain folder is ignored.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startShell } from "../src/lib/quickKey"
import { useStore } from "../src/store"

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }), Toaster: () => null }))
const sent: unknown[] = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (c: unknown) => (sent.push(c), { ok: true })) }
})
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })) }))
const { Sessions } = await import("../src/surfaces/Sessions")

let deliver: ((e: { data: unknown }) => void) | undefined
beforeEach(() => {
  sent.length = 0
  ;(globalThis as { chrome?: unknown }).chrome = {
    webview: {
      postMessage: () => undefined,
      addEventListener: (_t: string, f: (e: { data: unknown }) => void) => (deliver = f),
      removeEventListener: () => (deliver = undefined),
    },
  }
  useStore.setState({ route: "workspace", startFolder: undefined, sessions: {} })
})
afterEach(() => {
  cleanup()
  delete (globalThis as { chrome?: unknown }).chrome
})

describe("opening a folder from a terminal (T-002)", () => {
  it("opens the start-session form with the folder filled in, and starts nothing", async () => {
    const stop = startShell()
    deliver?.({ data: "open-folder:C:\\dev\\shop" })
    expect(useStore.getState()).toMatchObject({ route: "sessions", startFolder: "C:\\dev\\shop" })
    render(<Sessions />)
    expect(await screen.findByDisplayValue("C:\\dev\\shop")).toBeTruthy()
    // Taken by the form, so it is not filled in again next time.
    expect(useStore.getState().startFolder).toBeUndefined()
    expect(sent.filter((c) => (c as { type?: string }).type === "create_session")).toEqual([])
    stop()
  })

  it("ignores an empty folder or one with a line break in it", () => {
    const stop = startShell()
    deliver?.({ data: "open-folder:" })
    deliver?.({ data: "open-folder:C:\\dev\\a\nopen-request:x" })
    expect(useStore.getState()).toMatchObject({ route: "workspace", startFolder: undefined })
    stop()
  })
})
