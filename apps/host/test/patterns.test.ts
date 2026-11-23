// E-076: each pattern card links to at least two real examples; a topic with fewer is not carded.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { cardsMarkdown, patternCards } from "../src/patterns.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const FILES: Record<string, string> = {
  "src/errors.ts": "export class BillingError extends Error {}\nexport class TaxError extends Error {}\n",
  "src/billing/invoice.ts": "import { logger } from '../log'\nexport function total() {\n  logger.info('total')\n  if (!x) throw new BillingError('no lines')\n  const rate = process.env.TAX_RATE\n}\n",
  "src/billing/tax.ts": "export class RateError extends Error {}\nlogger.warn('rate')\nconst region = process.env.REGION ?? 'uk'\nconsole.log('debug')\n",
  "src/server.ts": "logger.error('down')\nconst port = process.env.PORT\n",
  "test/invoice.test.ts": "import { describe, it, expect } from 'vitest'\ndescribe('invoice', () => { it('adds', () => expect(1).toBe(1)) })\nconsole.log('in a test')\nconsole.log('again')\nconsole.log('and again')\nconsole.log('more')\n",
  "test/tax.test.ts": "import { it, expect } from 'vitest'\nit('taxes', () => {})\n",
  "node_modules/lib/index.js": "console.log('x')\nconsole.log('y')\nconsole.log('z')\nconsole.log('w')\n",
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-patterns-"))
  dirs.push(root)
  for (const [f, t] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true })
    fs.writeFileSync(path.join(root, f), t)
  }
  return root
}

describe("pattern cards", () => {
  it("makes a card for each topic, each with at least two real examples from different files", () => {
    const root = project()
    const cards = patternCards(root, Object.keys(FILES))
    expect(cards.map((c) => c.topic)).toEqual(["Errors", "Logging", "Configuration", "Tests"])
    for (const c of cards) {
      expect(c.examples.length, c.topic).toBeGreaterThanOrEqual(2)
      expect(new Set(c.examples.map((e) => e.file)).size).toBe(c.examples.length)
      // Each example is the real line in the real file.
      for (const e of c.examples) expect(fs.readFileSync(path.join(root, e.file), "utf8").split("\n")[e.line - 1]!.trim()).toBe(e.text)
    }
    const by = Object.fromEntries(cards.map((c) => [c.topic, c]))
    expect(by.Errors!.summary).toMatch(/its own error classes/)
    // The logger wins: console calls in tests and dependencies do not decide the code's pattern.
    expect(by.Logging!.summary).toMatch(/a logger object/)
    expect(by.Logging!.examples.map((e) => e.file).sort()).toEqual(["src/billing/invoice.ts", "src/billing/tax.ts", "src/server.ts"])
    expect(by.Configuration!.summary).toMatch(/environment variables/)
    expect(by.Tests!.summary).toMatch(/Vitest/)
    expect(by.Tests!.examples.map((e) => e.file).sort()).toEqual(["test/invoice.test.ts", "test/tax.test.ts"])
  })

  it("does not card a topic with only one example, and writes the cards for agents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-patterns-"))
    dirs.push(root)
    fs.mkdirSync(path.join(root, "src"))
    fs.writeFileSync(path.join(root, "src", "a.ts"), "logger.info('one')\nlogger.info('two')\n")
    fs.writeFileSync(path.join(root, "src", "b.ts"), "export const x = 1\n")
    // Two calls in one file are one place, so no Logging card.
    expect(patternCards(root, ["src/a.ts", "src/b.ts"])).toEqual([])
    const md = cardsMarkdown("shop", patternCards(project(), Object.keys(FILES)))
    expect(md).toMatch(/^# How shop does things/)
    expect(md).toMatch(/## Logging\n\nThis repository logs with a logger object/)
    expect(md).toContain("- `src/server.ts:1`: `logger.error('down')`")
  })
})
