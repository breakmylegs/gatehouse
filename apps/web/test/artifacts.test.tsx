// @vitest-environment jsdom
// The Artifacts panel (owner's plan, W1-09, ADR 0003): shown in a sandbox, versions compared and exported.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ArtifactsPane } from "../src/components/ArtifactsPane"
import { OFFLINE_POLICY, offlineExport } from "../src/lib/artifactExport"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"
import { emptyTranscript, reduceHistory } from "../src/lib/transcript"

const SESSION = "019a0000-0000-7000-8000-0000000000aa"
let artifacts: Array<{
  id: string
  title: string
  kind: "html" | "svg"
  versions: Array<{ version: number; bytes: number; at: string }>
}> = []
const contents: Record<string, string> = {}
const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []
const saved: Array<{ name: string; text: string; type?: string }> = []

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/exportMarkdown", async (orig) => ({
  ...(await orig<typeof import("../src/lib/exportMarkdown")>()),
  download: (name: string, text: string, type?: string) => saved.push({ name, text, type }),
}))
// A stand-in list that draws every item.
vi.mock("react-virtuoso", () => ({
  Virtuoso: (p: { data: unknown[]; itemContent: (i: number, d: unknown) => React.ReactNode }) => (
    <div>
      {p.data.map((d, i) => (
        <div key={i}>{p.itemContent(i, d)}</div>
      ))}
    </div>
  ),
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: Record<string, unknown>) => {
    calls.push({ method, url, ...(body ? { body } : {}) })
    if (url.startsWith("/api/artifacts?")) return { ok: true, status: 200, data: { artifacts } }
    if (url === "/api/artifacts/open")
      return {
        ok: true,
        status: 200,
        data: { path: `/artifact/tok-${body?.artifact}-${body?.version}` },
      }
    if (url.startsWith("/api/artifacts/export")) {
      const q = new URLSearchParams(url.split("?")[1])
      const key = `${q.get("artifact")}@${q.get("version")}`
      return {
        ok: true,
        status: 200,
        data: { name: `${q.get("artifact")}-v${q.get("version")}.html`, content: contents[key] },
      }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

beforeEach(() => {
  const at = "2026-11-01T09:00:00Z"
  artifacts = [
    {
      id: "chart",
      title: "Chart",
      kind: "html",
      versions: [
        { version: 1, bytes: 10, at },
        { version: 2, bytes: 12, at },
      ],
    },
    { id: "logo", title: "Logo", kind: "svg", versions: [{ version: 1, bytes: 5, at }] },
  ]
  contents["chart@1"] = "<h1>one</h1>\n<p>old line</p>\n"
  contents["chart@2"] = "<h1>one</h1>\n<p>new line</p>\n"
  contents["logo@1"] = "<svg/>"
  calls.length = 0
  saved.length = 0
})
afterEach(cleanup)

describe("the Artifacts panel", () => {
  it("shows the newest version of the newest artifact in a sandbox that runs only its own scripts", async () => {
    render(<ArtifactsPane sessionId={SESSION} refresh={0} />)
    const frame = (await screen.findByTitle("Artifact: Logo, version 1")) as HTMLIFrameElement
    // The sandbox: scripts and nothing else. No same origin, forms, pop-ups or top navigation.
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts")
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer")
    expect(frame.getAttribute("src")).toBe("/artifact/tok-logo-1")
  })

  it("moves between artifacts and versions", async () => {
    render(<ArtifactsPane sessionId={SESSION} refresh={0} />)
    await userEvent.click(await screen.findByRole("button", { name: "Chart" }))
    expect(await screen.findByTitle("Artifact: Chart, version 2")).toBeTruthy()
    fireEvent.change(screen.getByRole("combobox", { name: "Version" }), { target: { value: "1" } })
    expect(await screen.findByTitle("Artifact: Chart, version 1")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Compare with the one before" })).toBeDisabled()
  })

  it("compares a version with the one before, line by line", async () => {
    render(<ArtifactsPane sessionId={SESSION} refresh={0} />)
    await userEvent.click(await screen.findByRole("button", { name: "Chart" }))
    await screen.findByTitle("Artifact: Chart, version 2")
    await userEvent.click(screen.getByRole("button", { name: "Compare with the one before" }))
    const changes = await screen.findByLabelText("Changes from the version before")
    expect(changes.textContent).toContain("- <p>old line</p>")
    expect(changes.textContent).toContain("+ <p>new line</p>")
    expect(changes.textContent).toContain("  <h1>one</h1>")
    // The comparison replaces the page; choosing it again goes back.
    expect(screen.queryByTitle(/Artifact: Chart/)).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Compare with the one before" }))
    expect(await screen.findByTitle("Artifact: Chart, version 2")).toBeTruthy()
  })

  it("exports the stored version as a file of its own kind", async () => {
    render(<ArtifactsPane sessionId={SESSION} refresh={0} />)
    await screen.findByTitle("Artifact: Logo, version 1")
    await userEvent.click(screen.getByRole("button", { name: "Export for offline use" }))
    await waitFor(() =>
      expect(saved[0]).toEqual({ name: "logo-v1.html", text: "<svg/>", type: "image/svg+xml" }),
    )
  })

  it("exports a page that fetches nothing when opened from the file, as in the app (B45)", () => {
    const page = offlineExport("html", "<html><head><title>t</title></head><body>x</body></html>")
    expect(page).toBe(
      `<html><head><meta http-equiv="Content-Security-Policy" content="${OFFLINE_POLICY}"><title>t</title></head><body>x</body></html>`,
    )
    expect(OFFLINE_POLICY).toContain("connect-src 'none'")
    expect(OFFLINE_POLICY).toContain("default-src 'none'")
    // A page with no head gets one, before anything in it.
    expect(offlineExport("html", "<p>hi</p>")).toMatch(/^<!doctype html>\n<head><meta http-equiv/)
    expect(offlineExport("svg", "<svg/>")).toBe("<svg/>")
  })

  it("says what to do when there is nothing yet, and looks again when a chat saves one", async () => {
    artifacts = []
    const { rerender } = render(<ArtifactsPane sessionId={SESSION} refresh={0} />)
    expect(await screen.findByText(/Nothing yet/)).toBeTruthy()
    artifacts = [
      { id: "new", title: "New", kind: "html", versions: [{ version: 1, bytes: 3, at: "x" }] },
    ]
    contents["new@1"] = "<p/>"
    rerender(<ArtifactsPane sessionId={SESSION} refresh={1} />)
    expect(await screen.findByTitle("Artifact: New, version 1")).toBeTruthy()
  })
})

describe("in a chat", () => {
  it("has an Artifacts button that opens the panel, and a coding session does not", async () => {
    const base = {
      mode: "plan" as const,
      state: "idle" as const,
      pendingApprovals: 0,
      createdAt: "2026-11-01T09:00:00Z",
    }
    useStore.setState({
      sessions: {
        [SESSION]: { id: SESSION, cwd: "C:/x/chats/c", project: "c", kind: "chat", ...base },
      },
      selectedSession: SESSION,
      transcripts: {},
      panes: [],
      pending: {},
    })
    const { unmount } = render(<Workspace />)
    const panels = screen.getByRole("group", { name: "Side panels" })
    expect(
      within(panels)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Artifacts", "Sources"])
    await userEvent.click(within(panels).getByRole("button", { name: "Artifacts" }))
    expect(await screen.findByTitle("Artifact: Logo, version 1")).toBeTruthy()
    unmount()
    useStore.setState({
      sessions: { s2: { id: "s2", cwd: "C:/dev/shop", project: "shop", ...base, mode: "default" } },
      selectedSession: "s2",
    })
    render(<Workspace />)
    expect(screen.queryByRole("button", { name: "Artifacts" })).toBeNull()
  })

  it("shows what a chat saved as a card in the reply, and Open shows it beside the chat (Stitch, R8)", async () => {
    let t = emptyTranscript()
    t = reduceHistory(t, {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu-a",
            name: "mcp__companion__save_artifact",
            input: { title: "Logo", kind: "svg", content: "<svg/>" },
          },
        ],
      },
    })
    t = reduceHistory(t, {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu-a", content: "Saved Logo, version 1" }],
      },
    })
    useStore.setState({
      sessions: {
        [SESSION]: {
          id: SESSION,
          cwd: "C:/x/chats/c",
          project: "c",
          kind: "chat",
          mode: "plan",
          state: "idle",
          pendingApprovals: 0,
          createdAt: "2026-11-01T09:00:00Z",
        },
      },
      selectedSession: SESSION,
      transcripts: { [SESSION]: t },
      panes: [],
      pending: {},
    })
    render(<Workspace />)
    const card = screen.getByRole("group", { name: "Artifact: Logo" })
    expect(within(card).getByText(/A picture \(SVG\)/)).toBeTruthy()
    await userEvent.click(within(card).getByRole("button", { name: "Open" }))
    expect(screen.getByRole("button", { name: "Artifacts" }).getAttribute("aria-pressed")).toBe(
      "true",
    )
    expect(await screen.findByTitle("Artifact: Logo, version 1")).toBeTruthy()
  })
})
