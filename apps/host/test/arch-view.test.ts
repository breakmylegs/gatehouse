// D-042 and D-043: the C4 diagrams drawn from the import graph, a new module since the approved version marked as
// drift; a new import cycle and a new edge across a layer boundary raised as alerts.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { approve, c4Diagrams, cyclesOf, driftOf, modulesOf, readApproved } from "../src/arch-view.js"
import type { ArchGraph } from "../src/architecture.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-c4-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const file = (layer: string | undefined, internal: string[], imports: string[] = []) => ({ size: 1, mtimeMs: 1, imports, internal, ...(layer ? { layer } : {}) })

const before: ArchGraph = {
  v: 1,
  files: {
    "src/domain/order.ts": file("domain", []),
    "src/app/checkout.ts": file("application", ["src/domain/order.ts"], ["zod"]),
    "src/infra/db.ts": file("infrastructure", ["src/domain/order.ts"], ["pg"]),
  },
}
const after: ArchGraph = {
  v: 1,
  files: {
    ...before.files,
    // A new module, and the domain now reaching into it and the application layer: a cycle and a crossing.
    "src/reports/sales.ts": file(undefined, ["src/domain/order.ts"]),
    "src/domain/order.ts": file("domain", ["src/reports/sales.ts", "src/app/checkout.ts"]),
  },
}

describe("living C4 diagrams and drift alerts (D-042, D-043)", () => {
  it("draws the diagrams and marks a new module as drift", async () => {
    await approve(root, modulesOf(before))
    const approved = readApproved(root)!
    expect(Object.keys(approved.modules)).toEqual(["src/domain", "src/app", "src/infra"])
    const now = modulesOf(after)
    const drift = driftOf(now, approved)
    expect(drift.newModules).toEqual(["src/reports"])
    const d = c4Diagrams("shop", now, drift)
    expect(d.context).toContain('System_Ext(pkg_pg, "pg", "package")')
    expect(d.container).toMatch(/Container\(c_domain, "domain"/)
    expect(d.component).toContain('Component(m_src_reports, "src/reports (new)"')
    expect(d.component).toContain("UpdateElementStyle(m_src_reports")
    expect(c4Diagrams("shop", modulesOf(before), driftOf(modulesOf(before), approved)).component).not.toContain("(new)")
  })

  it("raises a new cycle and a new edge across a layer boundary", () => {
    const drift = driftOf(modulesOf(after), modulesOf(before))
    expect(drift.newCrossings).toEqual(["src/domain -> src/app"])
    expect(drift.newCycles).toEqual([["src/app", "src/domain", "src/reports"]])
    expect(cyclesOf(modulesOf(before))).toEqual([])
    // Nothing approved yet: nothing is drift.
    expect(driftOf(modulesOf(after), undefined)).toEqual({ newModules: [], newCrossings: [], newCycles: [] })
  })
})
