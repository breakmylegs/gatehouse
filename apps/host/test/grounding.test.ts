// E-083: an ungrounded sentence is highlighted (found, with its line) and appears in the export's list; one with a
// file, a source, a citation or an evidence pack does not.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { registerExportRoutes } from "../src/export-api.js"
import { grounding } from "../src/grounding.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-ground-"))
  dirs.push(root)
  fs.mkdirSync(path.join(root, "src"))
  fs.writeFileSync(path.join(root, "src", "billing.ts"), "export {}\n")
  return root
}

const DRAFT = [
  "# Billing review",
  "",
  "The invoice total is rounded once, in src/billing.ts:12, before tax is added.",
  "Refunds settle within three working days for every card scheme we support.",
  "The provider's limits are documented on their site [1].",
  "The change passed every sealed check, as its evidence pack shows.",
  "See [the runbook](docs/runbook.md) for the rollout steps and their owners.",
  "Is this enough for the auditors to accept it?",
  "Short line.",
  "The retry rule also lives in src/retry.ts, which this project does not have yet.",
  "",
  "```",
  "This code block says things that are not claims at all, ever.",
  "```",
  "",
  "| Area | Claim in a table cell, not checked here |",
  "",
  "## Sources",
  "",
  "1. The payment provider's published limits for refunds, chapter four.",
].join("\n")

describe("evidence-grounded documents", () => {
  it("finds each ungrounded sentence with its line, and passes those with a source", () => {
    const g = grounding(DRAFT, { root: project() })
    expect(g.ungrounded).toEqual([
      { line: 4, sentence: "Refunds settle within three working days for every card scheme we support." },
      { line: 10, sentence: "The retry rule also lives in src/retry.ts, which this project does not have yet." },
    ])
    expect(g.checked).toBe(6)
    expect(g.grounded).toBe(4)
  })

  it("does not count a citation the draft's sources do not resolve", () => {
    expect(grounding("The provider's limits are documented somewhere [7].").ungrounded).toHaveLength(1)
    expect(grounding("The provider's limits are documented somewhere [^7].\n\n[^7]: Their handbook, page 4.").ungrounded).toHaveLength(0)
  })

  it("lists the ungrounded sentences in the export preview, before anything is saved", async () => {
    const root = project()
    const app = Fastify()
    const records: unknown[] = []
    registerExportRoutes(app, { audit: { record: async (r: unknown) => (records.push(r), true) } as never, config: () => ({}) as never, sessionCwd: () => root })
    const r = (await app.inject({ method: "POST", url: "/api/export/redact", payload: { text: DRAFT, format: "md", title: "Billing review", preview: true, session: "s1" } })).json() as { ungrounded: Array<{ line: number; sentence: string }> }
    expect(r.ungrounded.map((u) => u.line)).toEqual([4, 10])
    expect(records).toEqual([])
    await app.close()
  })
})
