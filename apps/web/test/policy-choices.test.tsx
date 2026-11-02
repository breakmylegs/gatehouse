// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PolicyChoices } from "../src/surfaces/PolicyChoices"

let user: Record<string, unknown> = { version: 1 }
const puts: Array<Record<string, unknown>> = []
const tests: Array<Record<string, unknown>> = []
const tries: Array<{ rules: { packs?: string[] }; asks: Array<{ toolName: string }> }> = []
const toasts: Array<{ text: string; undo?: () => void }> = []
let verdict = { outcome: "escalate", ruleId: "package-install", reason: "Installs packages." }

vi.mock("sonner", () => {
  const t = Object.assign(
    (text: string, o?: { action?: { onClick: () => void } }) =>
      toasts.push({ text, ...(o?.action ? { undo: o.action.onClick } : {}) }),
    { error: (text: string) => toasts.push({ text: `error: ${text}` }) },
  )
  return { toast: t, Toaster: () => null }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: Record<string, unknown>) => {
    if (url === "/api/library" && method === "GET")
      return {
        ok: true,
        status: 200,
        data: {
          path: "C:\\x\\rules.user.yaml",
          errors: [],
          packs: [
            "edit-workspace",
            "git-read",
            "git-local",
            "node-dev",
            "python-dev",
            "dotnet-dev",
            "build-tools",
            "run-app",
            "packages",
            "web-read",
            "windows-safety",
          ].map((id) => ({ id, title: id, rules: [{ id: `${id}-rule` }] })),
          user,
        },
      }
    if (url === "/api/library" && method === "PUT") {
      puts.push(body as Record<string, unknown>)
      user = body as Record<string, unknown>
      return { ok: true, status: 200, data: { changed: [] } }
    }
    if (url === "/api/policy")
      return {
        ok: true,
        status: 200,
        data: { remember: [], rules: { workspaceRoots: ["C:/dev"] } },
      }
    if (url === "/api/suggestions") return { ok: true, status: 200, data: [] }
    // A stand-in engine: reads and searches go through; edits only with the edit-workspace pack; the rest ask.
    if (url === "/api/library/try") {
      const b = body as unknown as (typeof tries)[number]
      tries.push(b)
      const edits = b.rules.packs?.includes("edit-workspace") ?? false
      const verdicts = b.asks.map((a) => ({
        outcome:
          a.toolName === "Read" || a.toolName === "Grep" || (edits && /Edit|Write/.test(a.toolName))
            ? "allow"
            : "escalate",
        ruleId: "x",
        reason: "x",
      }))
      return { ok: true, status: 200, data: { verdicts } }
    }
    if (url === "/api/policy/test") {
      tests.push(body as Record<string, unknown>)
      return { ok: true, status: 200, data: verdict }
    }
    return { ok: false, status: 404, error: "no route" }
  }),
}))

beforeEach(() => {
  user = { version: 1 }
  puts.length = 0
  tests.length = 0
  tries.length = 0
  toasts.length = 0
})
afterEach(cleanup)

describe("the level cards (W1-17)", () => {
  it("show what each level does with everyday requests, as the engine answers, at most five of each", async () => {
    render(<PolicyChoices onAdvanced={() => undefined} />)
    const careful = await screen.findByRole("group", { name: "What Careful does" })
    const balanced = await screen.findByRole("group", { name: "What Balanced does" })
    await waitFor(() => expect(within(careful).queryByText("Working it out…")).toBeNull())
    expect(within(careful).getByText("Read a file in your project")).toBeTruthy()
    const carefulAsks = within(careful).getAllByRole("list")[1]!
    expect(within(carefulAsks).getByText("Change your code")).toBeTruthy()
    expect(within(carefulAsks).getAllByRole("listitem")).toHaveLength(5)
    await waitFor(() =>
      expect(
        within(within(balanced).getAllByRole("list")[0]!).getByText("Change your code"),
      ).toBeTruthy(),
    )
    // Each level was checked by its own rules, in a project inside your workspace folder.
    expect(tries.some((t) => t.rules.packs?.includes("edit-workspace"))).toBe(true)
    expect(tries.some((t) => !t.rules.packs?.includes("edit-workspace"))).toBe(true)
  })

  it("lets Try it answer for any level", async () => {
    render(<PolicyChoices onAdvanced={() => undefined} />)
    fireEvent.change(await screen.findByRole("combobox", { name: "Against which choices" }), {
      target: { value: "balanced" },
    })
    tries.length = 0
    fireEvent.change(screen.getByRole("textbox", { name: "The command" }), {
      target: { value: "npm install react" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Check" }))
    expect(await screen.findByText("Claude would ask you first.")).toBeTruthy()
    expect(tests).toHaveLength(0)
    const asked = tries.find((t) => t.asks.length === 1)
    expect(asked?.rules.packs).toContain("edit-workspace")
  })
})

describe("the plain Policy page", () => {
  it("shows a fresh install as Careful, and Balanced saves the packs behind it", async () => {
    render(<PolicyChoices onAdvanced={() => undefined} />)
    const careful = await screen.findByRole("radio", { name: /^Careful/ })
    expect(careful.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("radio", { name: /^Balanced/ }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]?.packs).toContain("edit-workspace")
    expect(puts[0]?.packs).not.toContain("packages")
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /^Balanced/ }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    )
    expect(toasts.at(-1)?.text).toBe("Saved: Balanced.")
  })

  it("saves one switch at once, says what it means, and Undo puts the rules back", async () => {
    render(<PolicyChoices onAdvanced={() => undefined} />)
    const row = await screen.findByRole("radiogroup", { name: "Install packages for your project" })
    fireEvent.click(within(row).getByRole("radio", { name: "Allowed" }))
    await waitFor(() => expect(puts[0]).toEqual({ version: 1, packs: ["packages"] }))
    const saved = toasts.at(-1)
    expect(saved?.text).toBe("Saved: Claude now installs packages for your project without asking.")
    saved?.undo?.()
    await waitFor(() => expect(puts[1]).toEqual({ version: 1 }))
  })

  it("answers what would happen, in words", async () => {
    render(<PolicyChoices onAdvanced={() => undefined} />)
    const box = await screen.findByRole("textbox", { name: "The command" })
    fireEvent.change(box, { target: { value: "npm install react" } })
    fireEvent.click(screen.getByRole("button", { name: "Check" }))
    expect(await screen.findByText("Claude would ask you first.")).toBeTruthy()
    expect(screen.getByText(/Because installing packages asks you/)).toBeTruthy()
    expect(tests[0]).toMatchObject({ toolName: "Bash", input: { command: "npm install react" } })
  })

  it("checks a file from its own project folder, so code, tests and docs rules apply", async () => {
    verdict = { outcome: "allow", ruleId: "edit-workspace-source", reason: "x" }
    render(<PolicyChoices onAdvanced={() => undefined} />)
    fireEvent.change(await screen.findByRole("combobox", { name: "What Claude wants to do" }), {
      target: { value: "write" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "The file" }), {
      target: { value: "C:\\dev\\shop\\src\\App.tsx" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Check" }))
    expect(await screen.findByText("Claude would do this without asking.")).toBeTruthy()
    expect(tests[0]).toMatchObject({ toolName: "Write", cwd: "C:\\dev\\shop" })
  })
})
