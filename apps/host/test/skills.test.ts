// E-073: repeated undos in one area surface it as a suggested topic; the record stays local and can be deleted.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { areaOf, asksToExplain, SkillLog } from "../src/skills.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const ROOT = path.join(os.tmpdir(), "shop")

describe("skill growth tracker", () => {
  it("names the language and area of a file", () => {
    expect(areaOf(ROOT, path.join(ROOT, "src", "billing", "tax", "vat.ts"))).toEqual({ language: "TypeScript", area: "shop/src/billing" })
    expect(areaOf(ROOT, "scripts/deploy.ps1")).toEqual({ language: "PowerShell", area: "shop/scripts" })
    expect(areaOf(ROOT, "README.md")).toEqual({ language: "Markdown", area: "shop/(top)" })
  })

  it("suggests an area where you keep undoing, and not one where undos are rare", () => {
    const log = new SkillLog()
    const sql = areaOf(ROOT, "db/migrations/001.sql")
    const ui = areaOf(ROOT, "src/ui/button.tsx")
    for (let i = 0; i < 3; i++) log.note("undo", sql)
    log.note("accept", sql)
    for (let i = 0; i < 20; i++) log.note("accept", ui)
    log.note("undo", ui)
    log.note("undo", ui)
    log.note("undo", ui)
    expect(log.suggestions()).toEqual([{ language: "SQL", area: "shop/db/migrations", reason: "SQL in shop/db/migrations: you undid 3 change(s) here, against 1 accepted." }])
    // Two undos are not yet a pattern.
    const few = new SkillLog()
    few.note("undo", sql)
    few.note("undo", sql)
    expect(few.suggestions()).toEqual([])
  })

  it("suggests an area you keep asking about, and knows a request for an explanation", () => {
    const log = new SkillLog()
    for (let i = 0; i < 3; i++) log.note("explain", areaOf(ROOT, "src/auth/token.ts"))
    expect(log.suggestions()[0]!.reason).toMatch(/asked for 3 explanation/)
    expect(asksToExplain("Explain how the token refresh works")).toBe(true)
    expect(asksToExplain("why does this test fail?")).toBe(true)
    expect(asksToExplain("Add a refresh token")).toBe(false)
  })

  it("keeps its record in its own file, only counts and names, and deletes it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-skills-"))
    dirs.push(dir)
    const file = path.join(dir, "skills.json")
    const log = new SkillLog(file)
    log.note("undo", areaOf(ROOT, "src/a.ts"))
    await new Promise((r) => setTimeout(r, 50))
    expect(new SkillLog(file).areas()).toEqual([expect.objectContaining({ area: "shop/src", undos: 1 })])
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).areas["TypeScript|shop/src"]).sort()).toEqual(["accepts", "area", "explains", "language", "last", "undos"])
    expect(await log.delete()).toBe(1)
    expect(new SkillLog(file).areas()).toEqual([])
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/skills.ts"), "utf8")
    expect([...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["@gatehouse/shared/node", "node:fs", "node:path"])
  })
})
