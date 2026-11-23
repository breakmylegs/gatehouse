// E-069: a new model appears in the register with its card, its classification and its first and last use.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { AiRegister } from "../src/ai-register.js"
import type { Boundaries } from "../src/boundary.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const boundaries: Boundaries = {
  claude: { keeps: "30 days", training: "no", checkedAt: "2026-11-01" },
  models: { "claude-opus-5-5": { keeps: "none", zdr: "yes", region: "EU", checkedAt: "2026-11-10" } },
}
const classifications = { default: "internal" as const, projects: { shop: "confidential" as const } }

describe("AI system register", () => {
  it("enters a new model with its card, and only once", () => {
    let t = new Date("2026-11-20T09:00:00Z")
    const reg = new AiRegister(undefined, () => t)
    const fresh = reg.turn("shop", { modelUsage: { "claude-opus-5-5": {}, "claude-haiku-5-5": {} } }, { local: false, purpose: "code session", boundaries, classifications })
    expect(fresh.map((e) => e.model).sort()).toEqual(["claude-haiku-5-5", "claude-opus-5-5"])
    const opus = reg.list("shop").find((e) => e.model === "claude-opus-5-5")!
    expect(opus).toMatchObject({ provider: "Anthropic (Claude)", purpose: "code session", classification: "confidential", card: { zdr: "yes", region: "EU" }, cardOf: "claude-opus-5-5", firstUse: "2026-11-20T09:00:00.000Z", turns: 1 })
    // A model with no card of its own goes by its provider's.
    expect(reg.list("shop").find((e) => e.model === "claude-haiku-5-5")).toMatchObject({ card: { keeps: "30 days" }, cardOf: "Claude" })
    t = new Date("2026-11-22T09:00:00Z")
    expect(reg.turn("shop", { modelUsage: { "claude-opus-5-5": {} } }, { local: false, purpose: "code session", boundaries, classifications })).toEqual([])
    expect(reg.list("shop").find((e) => e.model === "claude-opus-5-5")).toMatchObject({ firstUse: "2026-11-20T09:00:00.000Z", lastUse: "2026-11-22T09:00:00.000Z", turns: 2 })
  })

  it("says when a model has no card, and keeps projects and purposes apart", () => {
    const reg = new AiRegister(undefined, () => new Date("2026-11-20T09:00:00Z"))
    reg.turn("blog", {}, { local: true, localLabel: "Ollama", purpose: "chat", model: "llama-4" })
    expect(reg.list("blog")).toEqual([expect.objectContaining({ provider: "On this computer (Ollama)", model: "llama-4", purpose: "chat", classification: "internal", card: null })])
    expect(reg.list("blog")[0]).not.toHaveProperty("cardOf")
    expect(reg.list("shop")).toEqual([])
    expect(reg.markdown("blog")).toMatch(/\| blog \| On this computer \(Ollama\) \| llama-4 \| chat \| internal \| no card \| 2026-11-20 \| 2026-11-20 \|/)
  })

  it("keeps the register in its own file and reads it back", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-aireg-"))
    dirs.push(dir)
    const file = path.join(dir, "ai-register.json")
    const reg = new AiRegister(file, () => new Date("2026-11-20T09:00:00Z"))
    reg.turn("shop", { modelUsage: { "claude-opus-5-5": {} } }, { local: false, purpose: "code session", boundaries, classifications })
    await reg.flush()
    expect(new AiRegister(file).markdown()).toBe(reg.markdown())
    expect(new AiRegister(file).markdown()).toMatch(/its own card; keeps: none; region: EU; zero retention: yes; checked 2026-11-10/)
  })
})
