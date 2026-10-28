// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Library } from "../src/surfaces/Library"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
const data = () => ({
  path: "C:/x/rules.user.yaml",
  errors: [],
  packs: [
    {
      id: "node-dev",
      title: "Node and npm, building and testing",
      description: "Build and test.",
      on: false,
      rules: [
        {
          id: "node-dev-scripts",
          section: "allow",
          rule: { id: "node-dev-scripts", commands: ["npm run build"] },
          off: false,
        },
      ],
      cases: [{ tool: "Bash", input: { command: "npm run build" }, expect: "allow" }],
    },
  ],
  base: [
    {
      id: "secrets-files",
      section: "floor",
      rule: { id: "secrets-files", tools: ["Read"] },
      off: false,
      fixed: true,
    },
    {
      id: "safe-shell",
      section: "allow",
      rule: { id: "safe-shell", commands: ["git status*"] },
      off: false,
      fixed: false,
    },
  ],
  user: { version: 1 },
})

vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (method === "GET" && url === "/api/library") return { ok: true, status: 200, data: data() }
    if (url === "/api/library/preview")
      return { ok: true, status: 200, data: { total: 3, changes: [] } }
    if (method === "PUT" && url === "/api/library")
      return { ok: true, status: 200, data: { changed: [] } }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

beforeEach(() => {
  calls.length = 0
})
afterEach(cleanup)

describe("the rule library", () => {
  it("switches a pack on and a built-in rule off, then saves exactly that", async () => {
    render(<Library />)
    fireEvent.click(await screen.findByRole("checkbox", { name: /switch on node and npm/i }))
    fireEvent.click(screen.getByRole("button", { name: "Switch off" }))
    expect(screen.getByText("You have changes that are not saved.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }))
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true))
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      version: 1,
      packs: ["node-dev"],
      disabled: ["safe-shell"],
    })
  })

  it("never offers to switch off the floor", async () => {
    render(<Library />)
    const row = (await screen.findByText("secrets-files")).closest("tr") as HTMLElement
    expect(within(row).getByText("Always applies")).toBeTruthy()
    expect(within(row).queryByRole("button", { name: "Switch off" })).toBeNull()
  })

  it("copies a rule into your own rules under a my- name, and you can keep it", async () => {
    render(<Library />)
    const row = (await screen.findByText("safe-shell")).closest("tr") as HTMLElement
    fireEvent.click(within(row).getByRole("button", { name: "Copy to my rules" }))
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe(
      "my-safe-shell",
    )
    fireEvent.click(screen.getByRole("button", { name: "Keep this rule" }))
    expect(screen.getByText("my-safe-shell")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Preview what changes" }))
    expect(await screen.findByText(/0 of 3 past decisions/)).toBeTruthy()
  })

  it("refuses a rule of yours that matches nothing in particular", async () => {
    render(<Library />)
    fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "my-x" } })
    fireEvent.click(screen.getByRole("button", { name: "Keep this rule" }))
    expect(screen.getByRole("alert").textContent).toMatch(
      /at least one tool, command or file pattern/,
    )
  })
})
