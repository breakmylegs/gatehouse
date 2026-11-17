// E-086: the writing rules correct Codehouse's own prose and only check an agent's: UK spelling in the word's own
// case, dashes to commas (a number range keeps a hyphen), product-name variants, banned terms flagged and never
// replaced; code and web addresses are untouched; a project adds to this computer's rules and cannot take them away.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DEFAULT_WRITING_RULES, checkLastCommit, checkText, correctText, mergeRules, readRules } from "../src/writing-rules.js"

describe("writing rules (E-086)", () => {
  it("corrects spelling in its case, dashes, and terms, leaving code, addresses and line-start bullets", () => {
    const rules = mergeRules({ terms: [{ use: "Codehouse", not: ["CodeHouse", "Code House"] }] })
    const r = correctText("Color and COLOR: organize it—now. Pages 3–5. Code House\n– a bullet\nSee `color` at https://x.test/color", rules)
    expect(r.text).toBe("Colour and COLOUR: organise it, now. Pages 3-5. Codehouse\n– a bullet\nSee `color` at https://x.test/color")
    expect(r.changes).toEqual(expect.arrayContaining([{ from: "Color", to: "Colour", count: 1 }, { from: "Code House", to: "Codehouse", count: 1 }]))
    expect(correctText("a — b", { ...DEFAULT_WRITING_RULES, noDashes: false }).text).toBe("a — b")
  })

  it("checks an agent's text without rewriting it: banned terms, dashes and spellings, each once", () => {
    const rules = mergeRules({ banned: ["leverage"] })
    expect(checkText("fix: leverage the cache — color it", rules)).toEqual([
      'uses the banned term "leverage"',
      "has a dash (write a comma or a hyphen)",
      'writes "color" for "colour"',
    ])
    expect(checkText("fix(web): the colour of the rail", rules)).toEqual([])
  })

  it("adds a project's rules to this computer's: lists join, and a project cannot switch a check off", () => {
    const merged = mergeRules({ ukSpelling: false, banned: ["a"] }, { ukSpelling: true, noDashes: false, banned: ["b"] })
    expect(merged).toMatchObject({ ukSpelling: true, noDashes: true, banned: ["a", "b"] })
    expect(readRules({ ukSpelling: "yes", terms: [{ use: "X", not: ["x", 3] }, { not: [] }], banned: "no", extra: 1 })).toEqual({ terms: [{ use: "X", not: ["x"] }] })
  })

  it("flags an agent's commit message with a banned term from the project's rules", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "gh-writing-"))
    try {
      const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, windowsHide: true })
      git("init", "-q")
      fs.mkdirSync(path.join(repo, ".codehouse"))
      fs.writeFileSync(path.join(repo, ".codehouse", "writing-rules.json"), JSON.stringify({ banned: ["synergy"] }))
      git("-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "feat: add synergy")
      expect(await checkLastCommit(repo, {})).toEqual(['uses the banned term "synergy"'])
      expect(await checkLastCommit(path.join(repo, "missing"), {})).toEqual([])
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
