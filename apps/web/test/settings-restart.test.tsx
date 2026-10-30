// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"
import { Settings } from "../src/surfaces/Settings"

const sent: Array<{ type: string }> = []
let restartReply: { ok: boolean; error?: { code: string; message: string } } = { ok: true }

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: { type: string }) => {
      sent.push(cmd)
      return cmd.type === "restart" ? restartReply : { ok: true }
    }),
  }
})
vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }) }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string) => {
    if (url === "/api/settings" && method === "GET")
      return {
        ok: true,
        status: 200,
        data: {
          path: "config.json",
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
    if (url === "/api/settings") return { ok: true, status: 200, data: { restartRequired: true } }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
vi.mock("../src/components/UpdatesPanel", () => ({ UpdatesPanel: () => null }))
vi.mock("../src/components/JcvcPicker", () => ({ JcvcPicker: () => null }))

beforeEach(() => {
  sent.length = 0
  restartReply = { ok: true }
  useStore.setState({
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/a",
        project: "a",
        mode: "default",
        state: "running",
        pendingApprovals: 0,
        createdAt: "2026-10-30T10:00:00Z",
      },
    },
  })
})
afterEach(cleanup)

async function saveSomethingThatNeedsARestart() {
  render(<Settings />)
  const box = await screen.findByRole("textbox", { name: /Where new projects go/ })
  fireEvent.change(box, { target: { value: "C:\\dev" } })
  fireEvent.blur(box)
  return screen.findByRole("group", { name: "Restart JCVC" })
}

describe("a setting that needs a restart", () => {
  it("offers Restart now, says open sessions stop, and restarts when asked", async () => {
    await saveSomethingThatNeedsARestart()
    expect(screen.getByText(/1 session is open/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }))
    await waitFor(() => expect(sent).toEqual([{ type: "restart" }]))
    expect(screen.getByText(/Restarting JCVC/)).toBeTruthy()
  })

  it("puts it off with Later, sending nothing", async () => {
    await saveSomethingThatNeedsARestart()
    fireEvent.click(screen.getByRole("button", { name: "Later" }))
    expect(screen.queryByRole("group", { name: "Restart JCVC" })).toBeNull()
    expect(sent).toEqual([])
  })

  it("says what to do when JCVC cannot restart itself here", async () => {
    restartReply = {
      ok: false,
      error: { code: "unavailable", message: "JCVC cannot restart itself from here." },
    }
    await saveSomethingThatNeedsARestart()
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }))
    expect(await screen.findByText("JCVC cannot restart itself from here.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy()
  })
})
