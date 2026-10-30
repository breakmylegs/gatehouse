// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PlusMenu } from "../src/components/PlusMenu"
import { readInit } from "../src/lib/sessionMeta"

const calls: Array<{ url: string; body?: unknown }> = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string, body?: unknown) => {
    calls.push({ url, body })
    if (url === "/api/files/pick-files")
      return { ok: true, status: 200, data: { paths: ["C:/x/shot.png", "C:/x/.env"] } }
    if (url === "/api/files/attach")
      return {
        ok: true,
        status: 200,
        data: {
          files: [
            { path: "C:/x/shot.png", rel: ".jcvc/attachments/abc123-shot.png" },
            {
              path: "C:/x/.env",
              error: "That file is blocked by the policy and was not attached.",
            },
          ],
        },
      }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

beforeEach(() => {
  calls.length = 0
})
afterEach(cleanup)

const init = {
  type: "system",
  subtype: "init",
  slash_commands: ["compact", "review", "statusline"],
  terminal_slash_commands: ["statusline"],
  skills: ["pdf"],
  mcp_servers: [{ name: "companion", status: "connected", source: "sdk" }],
  plugins: [{ name: "impeccable", path: "x", version: "4.5.0" }],
  model: "claude-opus-5-5",
}

describe("what a session says about itself", () => {
  it("reads commands, skills, connectors and plugins, leaving out terminal-only commands", () => {
    expect(readInit(init)).toEqual({
      slashCommands: ["compact", "review"],
      skills: ["pdf"],
      connectors: [{ name: "companion", status: "connected" }],
      plugins: [{ name: "impeccable", version: "4.5.0" }],
      model: "claude-opus-5-5",
    })
    expect(readInit({ type: "assistant" })).toBeUndefined()
  })
})

describe("the plus menu", () => {
  it("adds files as @ mentions of their place in the folder, and says which were refused", async () => {
    const onInsert = vi.fn()
    render(<PlusMenu sessionId="s1" meta={readInit(init)} onInsert={onInsert} />)
    fireEvent.click(screen.getByRole("button", { name: /add files, a folder/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /add files or photos/i }))
    await waitFor(() =>
      expect(onInsert).toHaveBeenCalledWith("@.jcvc/attachments/abc123-shot.png "),
    )
    expect(calls.find((c) => c.url === "/api/files/attach")?.body).toEqual({
      session: "s1",
      paths: ["C:/x/shot.png", "C:/x/.env"],
    })
  })

  it("lists the session's commands and inserts one", () => {
    const onInsert = vi.fn()
    render(<PlusMenu sessionId="s1" meta={readInit(init)} onInsert={onInsert} />)
    fireEvent.click(screen.getByRole("button", { name: /add files, a folder/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /slash commands and skills/i }))
    expect(screen.queryByRole("menuitem", { name: "/statusline" })).toBeNull()
    fireEvent.click(screen.getByRole("menuitem", { name: "/review" }))
    expect(onInsert).toHaveBeenCalledWith("/review ")
  })

  it("shows connectors and plugins", () => {
    render(<PlusMenu sessionId="s1" meta={readInit(init)} onInsert={() => undefined} />)
    fireEvent.click(screen.getByRole("button", { name: /add files, a folder/i }))
    fireEvent.click(screen.getByRole("menuitem", { name: /connectors/i }))
    expect(screen.getByText("companion")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /plugins/i }))
    expect(screen.getByText("impeccable")).toBeTruthy()
  })

  it("opens at the top again however it was closed", () => {
    render(<PlusMenu sessionId="s1" meta={readInit(init)} onInsert={() => undefined} />)
    const plus = screen.getByRole("button", { name: /add files, a folder/i })
    const top = () => screen.queryByRole("menuitem", { name: /add files or photos/i })
    // Clicking away.
    fireEvent.click(plus)
    fireEvent.click(screen.getByRole("menuitem", { name: /plugins/i }))
    fireEvent.mouseDown(document.body)
    fireEvent.click(plus)
    expect(top()).toBeTruthy()
    // Pressing + again.
    fireEvent.click(screen.getByRole("menuitem", { name: /plugins/i }))
    fireEvent.click(plus)
    fireEvent.click(plus)
    expect(top()).toBeTruthy()
  })
})
