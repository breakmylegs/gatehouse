// @vitest-environment jsdom
// B17: where each provider keeps your words, which providers a project allows, and Start a chat offering only those.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { boundaryLine, BoundaryCards } from "../src/components/BoundaryCards"
import { NewChat } from "../src/surfaces/NewChat"
import { Projects } from "../src/surfaces/Projects"
import { useStore } from "../src/store"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
let projects: Array<{ name: string; providers?: string[] }> = []
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url === "/api/projects") return { ok: true, status: 200, data: { projects } }
    if (url === "/api/projects/Client%20A")
      return {
        ok: true,
        status: 200,
        data: { project: { name: "Client A", instructions: "", files: [], ...projects[0] } },
      }
    if (url.startsWith("/api/projects/") && url.endsWith("/providers"))
      return { ok: true, status: 200, data: { ok: true } }
    if (url === "/api/providers")
      return {
        ok: true,
        status: 200,
        data: { enabled: true, label: "Ollama", check: { ok: true, models: ["tiny"], left: [] } },
      }
    if (url === "/api/providers/boundary")
      return {
        ok: true,
        status: 200,
        data: { enabled: true, boundaries: { claude: (body as { boundary: unknown }).boundary } },
      }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

beforeEach(() => {
  calls.length = 0
  projects = []
  useStore.setState({ sessions: { code1: { id: "code1", cwd: "C:/dev/shop", project: "shop", mode: "default", state: "idle", pendingApprovals: 0, createdAt: "2026-11-06T09:00:00Z" } as never } })
})
afterEach(cleanup)

describe("where your words go", () => {
  it("says each provider's card in one line, and what is not known as not known", () => {
    expect(boundaryLine(undefined)).toBe("Not recorded yet.")
    expect(
      boundaryLine({
        keeps: "30 days",
        training: "no",
        region: "EU",
        checkedAt: "2026-11-03",
        source: "IT",
      }),
    ).toBe(
      "Keeps: 30 days, trains on it: no, region: EU, zero data retention: not known, checked 2026-11-03 (IT)",
    )
  })

  it("saves a provider's card, and hands the settings page the new providers block", async () => {
    const saved: unknown[] = []
    render(<BoundaryCards boundaries={undefined} onSaved={(v) => saved.push(v)} />)
    const card = screen.getByLabelText(/Where your words go: Claude/)
    fireEvent.change(within(card).getByRole("textbox", { name: /What it keeps/ }), {
      target: { value: "30 days" },
    })
    fireEvent.change(within(card).getByRole("combobox", { name: /Trains its models/ }), {
      target: { value: "no" },
    })
    fireEvent.click(within(card).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(calls.at(-1)).toEqual({
      method: "PUT",
      url: "/api/providers/boundary",
      body: { provider: "claude", boundary: { keeps: "30 days", training: "no" } },
    })
  })
})

describe("starting a chat in a project", () => {
  const options = () =>
    (screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement).querySelectorAll(
      "option",
    )

  it("offers only the providers the project allows, and picks one it allows", async () => {
    projects = [{ name: "Client A", providers: ["local"] }, { name: "Open" }]
    render(<NewChat />)
    const project = await screen.findByRole("combobox", { name: /project/i })
    await waitFor(() => expect([...options()].some((o) => o.value === "local:tiny")).toBe(true))
    const all = options().length
    fireEvent.change(project, { target: { value: "Client A" } })
    await waitFor(() => expect([...options()].map((o) => o.value)).toEqual(["local:tiny"]))
    expect((screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement).value).toBe(
      "local:tiny",
    )
    fireEvent.change(project, { target: { value: "Open" } })
    await waitFor(() => expect(options().length).toBe(all))
  })
})

describe("a model on this computer (B19)", () => {
  it("can start a chat only after you have seen its licence, once", async () => {
    localStorage.clear()
    projects = [{ name: "Client A", providers: ["local"] }]
    render(<NewChat />)
    fireEvent.change(await screen.findByRole("combobox", { name: /project/i }), {
      target: { value: "Client A" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: /want to know/i }), {
      target: { value: "Summarise this" },
    })
    const gate = await screen.findByRole("group", { name: "The licence for tiny" })
    expect(gate.textContent).toMatch(/shows no licence/)
    const start = screen.getByRole("button", { name: "Ask" })
    expect(start).toBeDisabled()
    fireEvent.click(within(gate).getByRole("checkbox", { name: /I have read the licence/ }))
    expect(start).toBeEnabled()
    expect(localStorage.getItem("gatehouse.licence.tiny")).toBe("1")
  })
})

describe("a project's providers", () => {
  it("are every provider until you untick one, keep at least one, and are saved as you change them", async () => {
    projects = [{ name: "Client A" }]
    render(<Projects />)
    fireEvent.click(await screen.findByRole("button", { name: /Client A/ }))
    const group = await screen.findByRole("group", { name: /Who this project's chats may use/ })
    const claude = within(group).getByRole("checkbox", { name: "Claude" })
    const local = within(group).getByRole("checkbox", { name: /Models on this computer/ })
    expect([(claude as HTMLInputElement).checked, (local as HTMLInputElement).checked]).toEqual([
      true,
      true,
    ])
    fireEvent.click(claude)
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        method: "PUT",
        url: "/api/projects/Client%20A/providers",
        body: { providers: ["local"] },
      }),
    )
    // The last one left cannot be unticked: a project with no provider could have no chats.
    await waitFor(() => expect(local).toBeDisabled())
    fireEvent.click(claude)
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ providers: null }))
  })
})
