// E-053: a playbook's checklist is verified against the change at the end; a run that misses the docs step lists it as
// unmet.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { playbookPrompt, readPlaybooks, verifyPlaybook } from "../src/playbooks.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-playbook-"))
  dirs.push(root)
  fs.mkdirSync(path.join(root, ".codehouse", "playbooks"), { recursive: true })
  fs.writeFileSync(
    path.join(root, ".codehouse", "playbooks", "endpoint.yml"),
    `name: Add an API endpoint
steps: [Write the handler, Add tests, Update the API docs]
checklist:
  - { text: Tests added, changed: "**/*.test.ts" }
  - { text: API docs updated, changed: "docs/api/**" }
  - { text: Changelog entry, contains: "## Unreleased" }
  - { text: Lint passes, run: "npm run lint" }
  - Reviewed by a person
`,
  )
  fs.writeFileSync(path.join(root, ".codehouse", "playbooks", "broken.yml"), "steps: [no name]\n")
  fs.mkdirSync(path.join(root, "src"))
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), "## Unreleased\n- New endpoint\n")
  return root
}

describe("verified playbooks", () => {
  it("reads the project's playbooks, leaving out one without a name", () => {
    const root = project()
    const [p] = readPlaybooks(root)
    expect(readPlaybooks(root)).toHaveLength(1)
    expect(p).toMatchObject({ id: "endpoint", name: "Add an API endpoint", steps: ["Write the handler", "Add tests", "Update the API docs"] })
    expect(p!.checklist.map((c) => c.text)).toEqual(["Tests added", "API docs updated", "Changelog entry", "Lint passes", "Reviewed by a person"])
    expect(playbookPrompt(p!)).toMatch(/Steps:\n1\. Write the handler[\s\S]*Codehouse will check this at the end:\n- Tests added/)
  })

  it("lists a missed docs step as unmet, and says which items only a person can check", async () => {
    const root = project()
    const [p] = readPlaybooks(root)
    const run = vi.fn(async () => ({ ran: true, exitCode: 0 }))
    const r = await verifyPlaybook(root, p!, { changed: new Set(["src/orders.ts", "src/orders.test.ts", "changelog.md"]), run })
    expect(r).toEqual([
      { text: "Tests added", status: "met", why: "checked" },
      { text: "API docs updated", status: "unmet", why: "nothing matching docs/api/** changed" },
      { text: "Changelog entry", status: "met", why: "checked" },
      { text: "Lint passes", status: "met", why: "checked" },
      { text: "Reviewed by a person", status: "person", why: "only a person can check this" },
    ])
    expect(run).toHaveBeenCalledWith("npm run lint", root)
  })

  it("meets the docs step when the docs changed, and fails a command that fails", async () => {
    const root = project()
    const [p] = readPlaybooks(root)
    const r = await verifyPlaybook(root, p!, { changed: new Set(["docs/api/orders.md", "src/orders.test.ts"]), run: async () => ({ ran: true, exitCode: 1 }) })
    expect(r.find((x) => x.text === "API docs updated")?.status).toBe("met")
    expect(r.find((x) => x.text === "Lint passes")).toMatchObject({ status: "unmet", why: "npm run lint failed (exit 1)" })
    expect(r.find((x) => x.text === "Changelog entry")).toMatchObject({ status: "unmet" })
  })
})
