// E-068: a local-model session shows no remote region; a Claude session shows its region, or "not known".
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { NO_REMOTE, NOT_KNOWN, placeOf, ResidencyLog } from "../src/residency.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe("data residency evidence", () => {
  it("shows no remote region for a session with a model on this computer", () => {
    expect(placeOf({ sessionId: "a", project: "p", local: true, model: "llama-4", boundaries: { local: { region: "EU" } } })).toMatchObject({ region: NO_REMOTE })
    expect(placeOf({ sessionId: "a", project: "p", local: true, localLabel: "On this computer" })).toMatchObject({ region: NO_REMOTE })
    const log = new ResidencyLog(undefined, () => new Date("2026-11-20T10:00:00Z"))
    log.turn({ sessionId: "s1", project: "p", local: true, model: "llama-4", reached: [{ remote: "127.0.0.1", why: "this computer", allowed: true }] })
    const st = log.statement("p")
    expect(st).toMatch(/No session sent anything to a remote region/)
    expect(st).toMatch(/Region: none \(this computer\)/)
    expect(st).toMatch(/127\.0\.0\.1 \(this computer\)/)
  })

  it("shows a Claude session's region from its card, or not known", () => {
    const withCard = placeOf({ sessionId: "a", project: "p", local: false, model: "claude-opus-5-5", boundaries: { claude: { region: "US", checkedAt: "2026-11-01" }, models: { "claude-opus-5-5": { region: "EU", checkedAt: "2026-11-10" } } } })
    expect(withCard).toMatchObject({ endpoint: expect.stringMatching(/api\.anthropic\.com/), region: "EU", basis: expect.stringMatching(/claude-opus-5-5, checked 2026-11-10/) })
    expect(placeOf({ sessionId: "a", project: "p", local: false, model: "claude-haiku-5-5", boundaries: { claude: { region: "US" } } })).toMatchObject({ region: "US" })
    expect(placeOf({ sessionId: "a", project: "p", local: false, model: "claude-opus-5-5" })).toMatchObject({ region: NOT_KNOWN, basis: "no data-boundary card" })
    expect(placeOf({ sessionId: "a", project: "p", local: false, boundaries: { claude: { keeps: "30 days" } } })).toMatchObject({ region: NOT_KNOWN, basis: expect.stringMatching(/names no region/) })
    // Through a gateway to another provider: where its card says, or not known; never "this computer".
    expect(placeOf({ sessionId: "a", project: "p", local: true, localLabel: "Azure OpenAI" })).toMatchObject({ region: NOT_KNOWN, endpoint: expect.stringMatching(/Azure OpenAI, through your gateway/) })
  })

  it("makes a statement per project and period, and keeps it in its own file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-resid-"))
    dirs.push(dir)
    const file = path.join(dir, "residency.json")
    let t = new Date("2026-11-01T10:00:00Z")
    const log = new ResidencyLog(file, () => t)
    log.turn({ sessionId: "old", project: "shop", local: false, model: "claude-opus-5-5" })
    t = new Date("2026-11-20T10:00:00Z")
    log.turn({ sessionId: "new", project: "shop", local: false, model: "claude-opus-5-5", boundaries: { claude: { region: "EU" } }, reached: [{ remote: "160.79.104.10", why: "Anthropic", allowed: true }, { remote: "203.0.113.9", allowed: false }] })
    log.turn({ sessionId: "other", project: "blog", local: true })
    await log.flush()
    const st = new ResidencyLog(file).statement("shop", "2026-11-15", "2026-11-30")
    expect(st).toMatch(/Period: 2026-11-15 to 2026-11-30\. 1 session\(s\)\./)
    expect(st).toMatch(/Remote regions: EU\./)
    expect(st).toMatch(/203\.0\.113\.9 \(outside its list\)/)
    expect(st).not.toMatch(/Session old|Session other/)
    expect(new ResidencyLog(file).statement("shop")).toMatch(/Remote regions: not known, EU\. A region that is not known/)
  })
})
