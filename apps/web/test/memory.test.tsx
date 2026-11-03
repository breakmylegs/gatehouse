// @vitest-environment jsdom
// The Memory page (owner's plan, W1-08): read, add, edit, forget, export and import.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryPage } from "../src/surfaces/Memory"

interface E {
  id: string
  topic: string
  text: string
  at: string
  by: "claude" | "you"
}
let everyone: E[] = []
let projects: Record<string, E[]> = {}
const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []
const saved: Array<{ name: string; text: string }> = []

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/exportMarkdown", () => ({
  download: (name: string, text: string) => saved.push({ name, text }),
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: Record<string, unknown>) => {
    calls.push({ method, url, ...(body ? { body } : {}) })
    if (url === "/api/memory" && method === "GET")
      return { ok: true, status: 200, data: { everyone, projects } }
    if (url === "/api/memory" && method === "POST") {
      const e: E = {
        id: "n1",
        topic: String(body?.topic),
        text: String(body?.text),
        at: "2026-11-01T00:00:00Z",
        by: "you",
      }
      if (body?.scope === "everyone") everyone = [...everyone, e]
      else projects[String(body?.scope)] = [...(projects[String(body?.scope)] ?? []), e]
      return { ok: true, status: 200, data: { entry: e } }
    }
    const m = /^\/api\/memory\/(.+)$/.exec(url)
    if (m && method === "PUT") {
      everyone = everyone.map((e) => (e.id === m[1] ? { ...e, ...body } : e))
      return { ok: true, status: 200, data: {} }
    }
    if (m && method === "DELETE") {
      everyone = everyone.filter((e) => e.id !== m[1])
      return { ok: true, status: 200, data: {} }
    }
    if (url === "/api/memory-export")
      return { ok: true, status: 200, data: { markdown: "## Global\n- [Units] metric\n" } }
    if (url === "/api/memory-import")
      return { ok: true, status: 200, data: { added: 2, skipped: 1 } }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

beforeEach(() => {
  everyone = [
    { id: "a1", topic: "Units", text: "Prefers metric.", at: "2026-10-31T00:00:00Z", by: "claude" },
    { id: "b2", topic: "Tea", text: "Likes it strong.", at: "2026-10-31T00:00:00Z", by: "you" },
  ]
  projects = {
    Home: [{ id: "c3", topic: "Beds", text: "Raised.", at: "2026-10-31T00:00:00Z", by: "claude" }],
  }
  calls.length = 0
  saved.length = 0
})
afterEach(cleanup)

describe("the Memory page", () => {
  it("shows what is kept, for every chat and for each project, and who kept it", async () => {
    render(<MemoryPage />)
    expect(await screen.findByText("Prefers metric.")).toBeTruthy()
    expect(screen.getByRole("region", { name: "For every chat" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Project: Home" })).toBeTruthy()
    expect(screen.getByText("Raised.")).toBeTruthy()
    // Who kept it, and how long ago (B24).
    expect(screen.getAllByText(/^Kept by Claude, /).length).toBe(2)
    expect(screen.getAllByText(/^Added by you, /)).toHaveLength(1)
  })

  it("edits an entry, saving only when you choose Save", async () => {
    render(<MemoryPage />)
    await userEvent.click(await screen.findByRole("button", { name: "Edit Units" }))
    const box = screen.getByRole("textbox", { name: "What is kept" })
    fireEvent.change(box, { target: { value: "Prefers metric, Celsius." } })
    expect(calls.some((c) => c.method === "PUT")).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")).toMatchObject({
        url: "/api/memory/a1",
        body: { topic: "Units", text: "Prefers metric, Celsius." },
      }),
    )
    expect(await screen.findByText("Prefers metric, Celsius.")).toBeTruthy()
  })

  it("cancels an edit without saving, and forgets an entry", async () => {
    render(<MemoryPage />)
    await userEvent.click(await screen.findByRole("button", { name: "Edit Units" }))
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(calls.some((c) => c.method === "PUT")).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Forget Tea" }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/memory/b2")).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText("Likes it strong.")).toBeNull())
  })

  it("keeps something of your own, for every chat or for a project", async () => {
    render(<MemoryPage />)
    await screen.findByText("Prefers metric.")
    const keep = screen.getByRole("button", { name: "Keep it" })
    expect(keep).toBeDisabled()
    await userEvent.type(screen.getByRole("textbox", { name: "Topic" }), "Garden")
    await userEvent.type(screen.getByRole("textbox", { name: "What to keep" }), "South facing.")
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "For" }), "Home")
    await userEvent.click(keep)
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        scope: "Home",
        topic: "Garden",
        text: "South facing.",
      }),
    )
  })

  it("exports to a Markdown file and imports one, saying how many it added", async () => {
    render(<MemoryPage />)
    await userEvent.click(await screen.findByRole("button", { name: "Export as Markdown" }))
    await waitFor(() =>
      expect(saved[0]).toEqual({
        name: "codehouse-memory.md",
        text: "## Global\n- [Units] metric\n",
      }),
    )
    const file = new File(["## Global\n- [New] a thing\n"], "m.md", { type: "text/markdown" })
    fireEvent.change(screen.getByLabelText("Choose a memory file"), { target: { files: [file] } })
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/memory-import")?.body).toEqual({
        markdown: "## Global\n- [New] a thing\n",
      }),
    )
  })
})
