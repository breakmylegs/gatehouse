// E-075: progress persists, and every step of the curriculum links to its material.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { curriculum, OnboardingProgress, starterTasks } from "../src/onboarding.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-onb-"))
  dirs.push(d)
  return d
}

const TOURS = [
  {
    tour: { name: "checkout", title: "The checkout", steps: [] },
    steps: [
      { title: "Old", symbol: "legacy", file: "src/old.ts", state: "gone" as const },
      { title: "Route", symbol: "createOrder", file: "src/routes/orders.ts", state: "ok" as const, at: { file: "src/routes/orders.ts", line: 12 } },
    ],
  },
  { tour: { name: "empty", title: "Broken", steps: [] }, steps: [{ title: "x", symbol: "x", file: "x.ts", state: "gone" as const }] },
]
const TERMS = [
  { word: "invoice", names: 14, example: { name: "createInvoice", file: "src/billing/invoice.ts" } },
  { word: "ghost", names: 3, example: { name: "ghostly", file: "src/missing.ts" } },
]
const EXISTS = new Set(["src/routes/orders.ts", "src/billing/invoice.ts", "src/billing/tax.ts"])

describe("the onboarding curriculum", () => {
  it("puts tours, terms, drills and starter tasks in order, each linked to its material", () => {
    const steps = curriculum({ tours: TOURS, terms: TERMS, starter: [{ title: "Fix the VAT rounding", file: "src/billing/tax.ts", line: 8, note: "A one-line change." }, { title: "Gone task", file: "src/nope.ts" }], exists: (f) => EXISTS.has(f) })
    expect(steps.map((s) => [s.kind, s.id])).toEqual([
      ["tour", "tour:checkout"],
      ["term", "term:invoice"],
      ["drills", "drills:checkout"],
      ["task", "task:fix-the-vat-rounding"],
    ])
    for (const s of steps) expect(EXISTS.has(s.link.file), s.id).toBe(true)
    expect(steps[0]!.link).toEqual({ file: "src/routes/orders.ts", line: 12, panel: "tours" })
    expect(steps[3]!.link).toEqual({ file: "src/billing/tax.ts", line: 8 })
  })

  it("without starter tasks, says how to add them, linking to where they go", () => {
    const steps = curriculum({ tours: [], terms: [], starter: [], exists: () => true })
    expect(steps).toEqual([expect.objectContaining({ id: "task:add-starter-tasks", link: { file: ".codehouse/onboarding.yml" } })])
  })

  it("reads the project's starter tasks", () => {
    const root = tmp()
    fs.mkdirSync(path.join(root, ".codehouse"))
    fs.writeFileSync(path.join(root, ".codehouse", "onboarding.yml"), "starter:\n  - title: Fix the VAT rounding\n    file: src\\billing\\tax.ts\n    line: 8\n  - note: no title\n")
    expect(starterTasks(root)).toEqual([{ title: "Fix the VAT rounding", file: "src/billing/tax.ts", line: 8 }])
    expect(starterTasks(tmp())).toEqual([])
  })

  it("keeps progress per project, and it survives a restart", async () => {
    const file = path.join(tmp(), "onboarding.json")
    const p = new OnboardingProgress(file)
    await p.mark("shop", "tour:checkout", true, new Date("2026-11-20T10:00:00Z"))
    await p.mark("shop", "term:invoice", true)
    await p.mark("blog", "tour:intro", true)
    await p.mark("shop", "term:invoice", false)
    const again = new OnboardingProgress(file)
    expect(again.done("shop")).toEqual({ "tour:checkout": "2026-11-20T10:00:00.000Z" })
    expect(Object.keys(again.done("blog"))).toEqual(["tour:intro"])
    expect(again.done("other")).toEqual({})
  })
})
