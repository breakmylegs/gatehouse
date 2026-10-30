// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UpdateNotice, UpdateResult } from "../src/components/UpdateNotice"
import { UpdatesPanel } from "../src/components/UpdatesPanel"
import type { UpdateStatus } from "../src/lib/update"
import { useStore } from "../src/store"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let reply: UpdateStatus
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    return { ok: true, status: 200, data: reply }
  }),
}))

const base = (o: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: "1.0.5",
  kind: "release",
  canInstall: true,
  settings: { checkEveryMinutes: 30, downloadInBackground: true, skipped: [] },
  where: "https://github.com/breakmylegs/gatehouse/releases",
  tokenSet: false,
  checking: false,
  available: true,
  latest: { version: "1.0.6", notes: "- Faster start\n- Updates" },
  phase: "idle",
  ...o,
})

beforeEach(() => {
  calls.length = 0
  reply = base()
  useStore.setState({ update: base(), conn: "closed", sessions: {} })
})
afterEach(cleanup)

describe("the update bar and dialog", () => {
  it("shows nothing when there is no newer version, or when it cannot install", () => {
    useStore.setState({ update: base({ available: false }) })
    const { rerender } = render(<UpdateNotice />)
    expect(screen.queryByRole("region", { name: "New version of JCVC" })).toBeNull()
    useStore.setState({ update: base({ canInstall: false }) })
    rerender(<UpdateNotice />)
    expect(screen.queryByRole("region", { name: "New version of JCVC" })).toBeNull()
  })

  it("puts Update now on a bar, and says your sessions come back", async () => {
    render(<UpdateNotice />)
    const bar = screen.getByRole("region", { name: "New version of JCVC" })
    expect(bar.textContent).toContain(
      "JCVC 1.0.6 is out. Your sessions come back after it restarts.",
    )
    fireEvent.click(within(bar).getByRole("button", { name: "Update now" }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ url: "/api/update/install", body: { version: "1.0.6" } })
    // The Host keeps it: the bar says it switches by itself and offers nothing to click twice.
    act(() =>
      useStore.setState({
        update: base({
          phase: "preparing",
          applyWhenReady: "1.0.6",
          progress: { step: "download", done: 1, total: 4, label: "Downloading" },
        }),
      }),
    )
    expect(bar.textContent).toContain("Getting JCVC 1.0.6 ready, 25%. It switches by itself")
    expect(
      (within(bar).getByRole("button", { name: "Updating" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(within(bar).queryByRole("button", { name: "Later" })).toBeNull()
  })

  it("opens the notes from the bar, and Later hides it until JCVC next opens", () => {
    useStore.setState({
      sessions: { s1: { state: "running" }, s2: { state: "ended" } } as never,
    })
    const first = render(<UpdateNotice />)
    fireEvent.click(screen.getByRole("button", { name: "What is new" }))
    const d = screen.getByRole("dialog", { name: "JCVC 1.0.6 is available" })
    expect(d.textContent).toContain("You have 1.0.5.")
    expect(screen.getByText("Faster start")).toBeTruthy()
    expect(d.textContent).toContain("1 session is open. They come back by themselves")
    fireEvent.click(within(d).getByRole("button", { name: "Later" }))
    fireEvent.click(screen.getByRole("button", { name: "Later" }))
    expect(screen.queryByRole("region", { name: "New version of JCVC" })).toBeNull()
    // Still hidden after the page draws it again, until a newer version comes out.
    first.unmount()
    render(<UpdateNotice />)
    expect(screen.queryByRole("region", { name: "New version of JCVC" })).toBeNull()
    act(() => useStore.setState({ update: base({ latest: { version: "1.0.7", notes: "" } }) }))
    expect(screen.getByRole("region", { name: "New version of JCVC" }).textContent).toContain(
      "1.0.7",
    )
  })

  it("switches at once when the version is already downloaded, and can skip it instead", async () => {
    reply = base({ phase: "ready", ready: "1.0.6", latest: { version: "1.0.8", notes: "" } })
    useStore.setState({ update: reply })
    render(<UpdateNotice />)
    expect(screen.getByRole("region").textContent).toContain("JCVC 1.0.8 is ready.")
    fireEvent.click(screen.getByRole("button", { name: "Update now" }))
    await waitFor(() => expect(calls.map((c) => c.url)).toEqual(["/api/update/install"]))
    calls.length = 0
    fireEvent.click(screen.getByRole("button", { name: "What is new" }))
    fireEvent.click(screen.getByRole("button", { name: "Skip this version" }))
    await waitFor(() =>
      expect(calls[0]).toMatchObject({ url: "/api/update/skip", body: { version: "1.0.8" } }),
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("says plainly when an update did not start and JCVC went back", async () => {
    useStore.setState({
      update: base({
        lastResult: {
          ok: false,
          mode: "apply",
          from: "1.0.5",
          to: "1.0.6",
          reason: "It closed before it was ready.",
        },
      }),
    })
    render(<UpdateResult />)
    expect(screen.getByRole("status").textContent).toMatch(
      /did not start, so JCVC went back to 1\.0\.5/,
    )
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    await waitFor(() => expect(calls[0]?.url).toBe("/api/update/dismiss"))
  })
})

describe("Settings, Updates", () => {
  it("changes how often to look, and offers a skipped version again", async () => {
    reply = base({
      settings: { checkEveryMinutes: 15, downloadInBackground: true, skipped: ["1.0.4"] },
    })
    useStore.setState({
      update: base({
        settings: { checkEveryMinutes: 30, downloadInBackground: true, skipped: ["1.0.4"] },
      }),
    })
    render(<UpdatesPanel />)
    expect(
      (screen.getByRole("combobox", { name: "Look for a new version" }) as HTMLSelectElement).value,
    ).toBe("30")
    fireEvent.change(screen.getByRole("combobox", { name: "Look for a new version" }), {
      target: { value: "15" },
    })
    await waitFor(() =>
      expect(calls[0]).toMatchObject({
        method: "PUT",
        url: "/api/update/settings",
        body: { checkEveryMinutes: 15 },
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Offer 1.0.4 again" }))
    await waitFor(() =>
      expect(calls[1]).toMatchObject({ url: "/api/update/unskip", body: { version: "1.0.4" } }),
    )
  })

  it("asks before going back to the kept version", async () => {
    useStore.setState({ update: base({ previous: "1.0.4" }) })
    render(<UpdatesPanel />)
    fireEvent.click(screen.getByRole("button", { name: "Go back to 1.0.4" }))
    expect(calls).toHaveLength(0)
    expect(screen.getByRole("group", { name: "Confirm going back" })).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: "Go back to 1.0.4" })[0]!)
    await waitFor(() => expect(calls[0]?.url).toBe("/api/update/rollback"))
  })

  it("from the source folder, says why it cannot install and offers no download", () => {
    useStore.setState({
      update: base({
        kind: "source",
        canInstall: false,
        why: "JCVC is running from its source folder.",
      }),
    })
    render(<UpdatesPanel />)
    expect(screen.getByText(/running from its source folder/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Update to 1\.0\.6/ })).toBeNull()
  })

  it("keeps a token write-only: the field empties once saved", async () => {
    render(<UpdatesPanel />)
    const field = screen.getByLabelText(/GitHub token/) as HTMLInputElement
    fireEvent.change(field, { target: { value: "github_pat_" + "a".repeat(30) } })
    fireEvent.click(screen.getByRole("button", { name: "Save token" }))
    await waitFor(() => expect(calls[0]).toMatchObject({ method: "PUT", url: "/api/update/token" }))
    await waitFor(() => expect(field.value).toBe(""))
  })
})
