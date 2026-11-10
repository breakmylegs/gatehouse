// @vitest-environment jsdom
// Chat projects on screen (owner's plan, W1-07): the Projects page, choosing a project for a chat, and the marker on
// a knowledge file Claude read.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"
import { NewChat } from "../src/surfaces/NewChat"
import { Projects } from "../src/surfaces/Projects"
import { Workspace } from "../src/surfaces/Workspace"

interface Fake {
  name: string
  instructions: string
  files: Array<{ name: string; size: number }>
}
let backend: Fake[] = []
const calls: Array<{ method: string; url: string; body?: unknown }> = []
const sent: Array<Record<string, unknown>> = []

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return cmd.type === "create_session" ? { ok: true, data: { sessionId: "c1" } } : { ok: true }
    }),
  }
})
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[]
    itemContent: (i: number, d: unknown) => React.ReactNode
  }) => (
    <div>
      {data.map((d, i) => (
        <div key={i}>{itemContent(i, d)}</div>
      ))}
    </div>
  ),
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: Record<string, unknown>) => {
    calls.push({ method, url, ...(body ? { body } : {}) })
    const m = /^\/api\/projects(?:\/([^/]+))?(?:\/(instructions|files)(?:\/(.+))?)?$/.exec(url)
    if (!m) return { ok: false, status: 404, error: "no route" }
    const [, rawName, part, rawFile] = m
    const name = rawName ? decodeURIComponent(rawName) : undefined
    const p = backend.find((x) => x.name === name)
    if (!name && method === "GET")
      return {
        ok: true,
        status: 200,
        data: {
          projects: backend.map((x) => ({
            name: x.name,
            hasInstructions: x.instructions !== "",
            files: x.files.length,
          })),
        },
      }
    if (!name && method === "POST") {
      backend.push({ name: String(body?.name).trim(), instructions: "", files: [] })
      return { ok: true, status: 200, data: {} }
    }
    if (!p) return { ok: false, status: 404, error: "There is no such project." }
    if (!part && method === "GET") return { ok: true, status: 200, data: { project: p } }
    if (!part && method === "DELETE") {
      backend = backend.filter((x) => x !== p)
      return { ok: true, status: 200, data: {} }
    }
    if (part === "instructions") {
      p.instructions = String(body?.text)
      return { ok: true, status: 200, data: {} }
    }
    if (part === "files" && method === "POST") {
      p.files.push({ name: String(body?.name), size: 3 })
      return { ok: true, status: 200, data: {} }
    }
    if (part === "files" && method === "DELETE") {
      p.files = p.files.filter((f) => f.name !== decodeURIComponent(rawFile ?? ""))
      return { ok: true, status: 200, data: {} }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

beforeEach(() => {
  backend = [{ name: "Home", instructions: "Use metric.", files: [{ name: "plan.md", size: 12 }] }]
  calls.length = 0
  sent.length = 0
  useStore.setState({
    route: "projects",
    sessions: { code1: { id: "code1", cwd: "C:/dev/shop", project: "shop", mode: "default", state: "idle", pendingApprovals: 0, createdAt: "2026-11-06T09:00:00Z" } as never },
    transcripts: {},
    panes: [],
    newChatProject: undefined,
  })
})
afterEach(cleanup)

describe("the Projects page", () => {
  it("lists projects, shows one's instructions and files, and saves edited instructions when you leave the box", async () => {
    render(<Projects />)
    await userEvent.click(await screen.findByRole("button", { name: /^Home/ }))
    const box = (await screen.findByRole("textbox", {
      name: /Instructions for every chat/,
    })) as HTMLTextAreaElement
    expect(box.value).toBe("Use metric.")
    expect(screen.getByText("plan.md")).toBeTruthy()
    fireEvent.change(box, { target: { value: "Use metric. Be brief." } })
    expect(calls.some((c) => c.method === "PUT")).toBe(false)
    fireEvent.blur(box)
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT")).toMatchObject({
        url: "/api/projects/Home/instructions",
        body: { text: "Use metric. Be brief." },
      }),
    )
    // Leaving it unchanged saves nothing more.
    const puts = calls.filter((c) => c.method === "PUT").length
    fireEvent.blur(box)
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(puts)
  })

  it("makes a project, adds a file, and removes one", async () => {
    render(<Projects />)
    await userEvent.type(await screen.findByRole("textbox", { name: "New project" }), "Garden")
    await userEvent.click(screen.getByRole("button", { name: "Make the project" }))
    await screen.findByRole("heading", { name: "Garden" })
    expect(backend.map((p) => p.name)).toContain("Garden")
    const file = new File(["hello"], "beds.md", { type: "text/markdown" })
    fireEvent.change(screen.getByLabelText("Choose knowledge files"), { target: { files: [file] } })
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/files"))?.body).toEqual({
        name: "beds.md",
        base64: btoa("hello"),
      }),
    )
    await userEvent.click(await screen.findByRole("button", { name: "Remove beds.md" }))
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url === "/api/projects/Garden/files/beds.md"),
      ).toBe(true),
    )
  })

  it("asks before removing a project, and starts a chat in it", async () => {
    render(<Projects />)
    await userEvent.click(await screen.findByRole("button", { name: /^Home/ }))
    await userEvent.click(await screen.findByRole("button", { name: "Remove this project" }))
    expect(calls.some((c) => c.method === "DELETE")).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }))
    expect(backend).toHaveLength(1)
    await userEvent.click(screen.getByRole("button", { name: "Start a chat in this project" }))
    expect(useStore.getState()).toMatchObject({ route: "chat", newChatProject: "Home" })
  })
})

describe("starting a chat in a project", () => {
  it("offers the projects, starts in the one chosen on the Projects page, and sends it with the chat's own instructions", async () => {
    useStore.setState({ route: "chat", newChatProject: "Home" })
    render(<NewChat />)
    const pick = (await screen.findByRole("combobox", { name: /^Project/ })) as HTMLSelectElement
    expect(pick.value).toBe("Home")
    // The choice is used once: it is not still waiting for the next visit.
    expect(useStore.getState().newChatProject).toBeUndefined()
    fireEvent.change(screen.getByRole("textbox", { name: "What do you want to know?" }), {
      target: { value: "Where do the beds go?" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: /Instructions for this chat/ }), {
      target: { value: "Keep it to three lines." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    await waitFor(() => expect(sent.find((c) => c.type === "create_session")).toBeTruthy())
    expect(sent.find((c) => c.type === "create_session")).toMatchObject({
      kind: "chat",
      chatProject: "Home",
      instructions: "Keep it to three lines.",
    })
  })

  it("sends neither when there is no project and no instructions, and shows no project choice with none made", async () => {
    backend = []
    useStore.setState({ route: "chat" })
    render(<NewChat />)
    await screen.findByRole("textbox", { name: "What do you want to know?" })
    expect(screen.queryByRole("combobox", { name: /^Project/ })).toBeNull()
    fireEvent.change(screen.getByRole("textbox", { name: "What do you want to know?" }), {
      target: { value: "Hello" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    await waitFor(() => expect(sent.find((c) => c.type === "create_session")).toBeTruthy())
    const made = sent.find((c) => c.type === "create_session")!
    expect(made).not.toHaveProperty("chatProject")
    expect(made).not.toHaveProperty("instructions")
  })
})

describe("what a project chat read", () => {
  const chat = (extra: Record<string, unknown> = {}) => ({
    id: "c1",
    cwd: "C:/Users/x/AppData/Local/Gatehouse/chats/hello",
    project: "hello",
    kind: "chat" as const,
    mode: "plan" as const,
    state: "idle" as const,
    pendingApprovals: 0,
    createdAt: "2026-10-31T10:00:00Z",
    ...extra,
  })

  it("marks a Read of a knowledge file, and names the project in the header", () => {
    useStore.setState({
      sessions: { c1: chat({ chatProject: "Home" }) as never },
      selectedSession: "c1",
      route: "workspace",
    })
    const reads = (path: string, id: string) => ({
      type: "assistant",
      message: { content: [{ type: "tool_use", id, name: "Read", input: { file_path: path } }] },
    })
    useStore.getState().handleEvent({
      type: "sdk_message",
      sessionId: "c1",
      message: reads(
        "C:\\Users\\x\\AppData\\Local\\Gatehouse\\chats\\hello\\knowledge\\plan.md",
        "t1",
      ),
    })
    useStore.getState().handleEvent({
      type: "sdk_message",
      sessionId: "c1",
      message: reads("C:\\Users\\x\\notes.md", "t2"),
    })
    render(<Workspace />)
    expect(screen.getByText(/A chat in the project Home/)).toBeTruthy()
    // The two reads sit in one collapsed group; open it.
    fireEvent.click(document.querySelector(".tool-group-line")!)
    const marks = screen.getAllByText("Project knowledge")
    expect(marks).toHaveLength(1)
    expect(within(marks[0]!.closest("details")!).getAllByText(/plan\.md/).length).toBeGreaterThan(0)
  })
})
