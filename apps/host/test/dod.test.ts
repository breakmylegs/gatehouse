// E-057: a project's definition of done: a change with no docs shows the unmet item; what only a person can check is
// ticked by hand; every claim of done shows the status.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "../src/codehouse-action.js"
import { DodTicks, dodItems, dodStatus, dodText, readDod } from "../src/dod.js"
import { buildStack, type Stack } from "./stack.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-dod-"))
  dirs.push(root)
  fs.mkdirSync(path.join(root, ".codehouse"))
  fs.writeFileSync(path.join(root, ".codehouse", "dod.yml"), 'items:\n  - { text: Tests added, changed: "**/*.test.ts" }\n  - { text: Docs updated, changed: "docs/**" }\n  - Reviewed by a person\n')
  return root
}
const run = async () => ({ ran: true, exitCode: 0 })

describe("the definition of done", () => {
  it("shows the unmet docs item for a change with no docs", async () => {
    const root = project()
    const dod = readDod(root)!
    const items = await dodItems(root, dod, new Set(), { changed: new Set(["src/cart.ts", "src/cart.test.ts"]), run })
    const s = dodStatus(items)
    expect(s).toEqual({ met: 1, total: 3, unmet: ["Docs updated", "Reviewed by a person (to tick)"] })
    expect(dodText(s)).toBe("Definition of done: 1 of 3 met; not met: Docs updated, Reviewed by a person (to tick).")
  })

  it("counts an item ticked by hand as met, for that session only", async () => {
    const root = project()
    const ticks = new DodTicks()
    ticks.tick("s1", "Reviewed by a person", true)
    const changed = new Set(["src/cart.test.ts", "docs/cart.md"])
    expect(dodStatus(await dodItems(root, readDod(root)!, ticks.of("s1"), { changed, run }))).toEqual({ met: 3, total: 3, unmet: [] })
    expect(dodStatus(await dodItems(root, readDod(root)!, ticks.of("s2"), { changed, run })).met).toBe(2)
    ticks.tick("s1", "Reviewed by a person", false)
    expect(dodStatus(await dodItems(root, readDod(root)!, ticks.of("s1"), { changed, run })).met).toBe(2)
    // A ticked item that Codehouse can check itself is still checked, not taken on trust.
    ticks.tick("s1", "Docs updated", true)
    expect(dodStatus(await dodItems(root, readDod(root)!, ticks.of("s1"), { changed: new Set(["src/cart.test.ts"]), run })).unmet).toContain("Docs updated")
    expect(dodText({ met: 3, total: 3, unmet: [] })).toBe("Definition of done: all 3 met.")
  })

  it("reads a plain list too, and nothing when there is none", () => {
    const root = project()
    fs.writeFileSync(path.join(root, ".codehouse", "dod.yml"), "- Changelog entry\n- { text: Lint, run: npm run lint }\n")
    expect(readDod(root)?.checklist).toEqual([{ text: "Changelog entry" }, { text: "Lint", run: "npm run lint" }])
    fs.rmSync(path.join(root, ".codehouse", "dod.yml"))
    expect(readDod(root)).toBeUndefined()
  })
})

describe("on a real session", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800, codehouseAction: async (): Promise<ActionResult> => ({ ran: true, exitCode: 0, output: "", timedOut: false, killed: false, ms: 5 }) })
    s.deps.dodFor = async () => ({ met: 1, total: 2, unmet: ["Docs updated"] })
  }, 60000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  it("shows the definition of done on a claim of done", async () => {
    s.sdk.turn = async (api) => {
      await api.callTool("Bash", { command: "npm test" }, { selfApproved: false })
      api.say("All tests pass now.")
    }
    const session = await s.manager.start({ cwd: s.repo })
    const events: Array<Record<string, unknown>> = []
    session.on("event", (e) => e.type === "claim_checked" && events.push(e.data))
    session.prompt("go")
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), { timeout: 10_000 })
    expect(session.info().claims?.at(-1)).toMatchObject({ dod: { met: 1, total: 2, unmet: ["Docs updated"] }, why: expect.stringMatching(/Definition of done: 1 of 2 met; not met: Docs updated\./) })
  })
})
