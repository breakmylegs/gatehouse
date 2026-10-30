// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Sessions } from "../src/surfaces/Sessions"
import { useStore } from "../src/store"

const sent: Array<Record<string, unknown>> = []
let projectsFolder: string | undefined = "C:\\dev"

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      if (cmd.type === "create_session")
        return {
          ok: true,
          data: { sessionId: "s9", info: { cwd: `${String(cmd.cwd)}-2` } },
        }
      return { ok: true }
    }),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) =>
    url === "/api/settings"
      ? { ok: true, status: 200, data: { saved: projectsFolder ? { projectsFolder } : {} } }
      : { ok: false, status: 404, error: "no route" },
  ),
}))

beforeEach(() => {
  sent.length = 0
  projectsFolder = "C:\\dev"
  useStore.setState({ sessions: {}, transcripts: {}, activity: {}, route: "sessions" })
})
afterEach(cleanup)

describe("starting a new project from what you want to build", () => {
  it("names the folder from the idea, creates it fresh and sends the idea as the first prompt", async () => {
    render(<Sessions />)
    const idea = await screen.findByRole("textbox", { name: "What do you want to build?" })
    fireEvent.change(idea, {
      target: { value: "Build me an HTML page that acts like a simple version of excel" },
    })
    expect(screen.getByText("C:\\dev\\html-excel")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Start the project" }))
    await waitFor(() => expect(sent.map((c) => c.type)).toEqual(["create_session", "prompt"]))
    expect(sent[0]).toMatchObject({ cwd: "C:\\dev\\html-excel", freshFolder: true })
    expect(sent[1]).toEqual({
      type: "prompt",
      sessionId: "s9",
      text: "Build me an HTML page that acts like a simple version of excel",
    })
    expect(useStore.getState().transcripts.s9?.items[0]).toMatchObject({ kind: "user" })
    expect(useStore.getState().route).toBe("workspace")
  })

  it("lets you change the name, kept safe for a folder", async () => {
    render(<Sessions />)
    fireEvent.change(await screen.findByRole("textbox", { name: "What do you want to build?" }), {
      target: { value: "a game" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Change the name" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), {
      target: { value: "My Snake Game!" },
    })
    expect(screen.getByText("C:\\dev\\my-snake-game")).toBeTruthy()
  })

  it("asks for a folder as before when no projects folder is set, and says where to set one", async () => {
    projectsFolder = undefined
    render(<Sessions />)
    expect(await screen.findByText(/choose where new projects go in Settings/)).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "What do you want to build?" })).toBeNull()
  })

  it("uses a folder you typed instead, as an ordinary session", async () => {
    render(<Sessions />)
    await screen.findByRole("textbox", { name: "What do you want to build?" })
    fireEvent.change(screen.getByRole("textbox", { name: /^Folder/ }), {
      target: { value: "C:\\dev\\existing" },
    })
    expect(screen.queryByRole("textbox", { name: "What do you want to build?" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    await waitFor(() => expect(sent[0]).toMatchObject({ cwd: "C:\\dev\\existing" }))
    expect(sent[0]?.freshFolder).toBeUndefined()
  })
})
