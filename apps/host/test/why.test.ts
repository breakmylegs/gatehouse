// D-081: why is this code like this. The answer for a line cites its commit, that commit's Codehouse note and any ADR
// that bears on it (decided in the same session, naming the commit, or covering the file); a line not committed, or a
// commit made outside Codehouse, says so.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { whyLine } from "../src/why.js"

let root: string
let first: string
let second: string
const git = (...a: string[]) =>
  execFileSync("git", ["-C", root, "-c", "user.name=Pat", "-c", "user.email=pat@example.invalid", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8", windowsHide: true }).trim()
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-why-")))
  git("init", "-q")
  write("src/pay.ts", "export const fee = 2\nexport const cap = 10\n")
  git("add", ".")
  git("commit", "-q", "-m", "Fees as a flat amount")
  first = git("rev-parse", "HEAD")
  write("src/pay.ts", "export const fee = 2\nexport const cap = 25\n")
  git("commit", "-q", "-am", "Raise the cap for business accounts")
  second = git("rev-parse", "HEAD")
  git("notes", "--ref=codehouse", "add", "-m", JSON.stringify({ codehouse: 1, session: "s-77", auditSeq: 412, auditHash: "a".repeat(64), at: "2026-11-18T10:00:00Z", evidence: "e".repeat(64) }), second)
  write("docs/adr/0001-cap.md", "---\nstatus: accepted\nsession: s-77\nrecord: 400\n---\n\n# 0001. Cap for business accounts\n\nChosen option: \"25\".\n")
  write("docs/adr/0002-fees.md", `---\nstatus: accepted\n---\n\n# 0002. Flat fees\n\nSee commit ${first.slice(0, 7)}.\n`)
  write("docs/adr/0003-money.md", "---\nstatus: accepted\npaths: [\"src/pay.ts\"]\n---\n\n# 0003. Money in pence\n")
  write("docs/adr/0004-other.md", "---\nstatus: accepted\npaths: [\"src/other/**\"]\n---\n\n# 0004. Unrelated\n")
  git("add", ".")
  git("commit", "-q", "-m", "Decisions")
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe("why is this code like this (D-081)", () => {
  it("cites the commit, its Codehouse note and the ADRs that bear on the line", async () => {
    const w = await whyLine(root, "src/pay.ts", 2)
    expect(w.commit).toMatchObject({ sha: second, subject: "Raise the cap for business accounts", author: "Pat" })
    expect(w.note).toMatchObject({ session: "s-77", auditSeq: 412 })
    expect(w.adrs.map((a) => [a.file, a.because])).toEqual([
      ["docs/adr/0001-cap.md", "same session"],
      ["docs/adr/0003-money.md", "covers the file"],
    ])
    // Every sentence cites something, and the three kinds are all cited.
    expect(w.answer.every((a) => a.cites.length > 0)).toBe(true)
    const cites = w.answer.map((a) => a.cites)
    expect(cites).toContain(`commit ${second}`)
    expect(cites).toContain(`refs/notes/codehouse on ${second.slice(0, 7)}`)
    expect(cites).toContain("docs/adr/0001-cap.md")
    expect(cites).toContain(`evidence ${"e".repeat(64)}`)
  })

  it("finds an ADR that names the commit, and says when a commit has no Codehouse note", async () => {
    const w = await whyLine(root, "src/pay.ts", 1)
    expect(w.commit?.sha).toBe(first)
    expect(w.note).toBeUndefined()
    expect(w.answer.some((a) => /no Codehouse note/.test(a.text))).toBe(true)
    expect(w.adrs.map((a) => [a.file, a.because])).toEqual([
      ["docs/adr/0002-fees.md", "names the commit"],
      ["docs/adr/0003-money.md", "covers the file"],
    ])
  })

  it("says a line is not committed yet, and a line past the end cannot be answered", async () => {
    write("src/pay.ts", "export const fee = 3\nexport const cap = 25\n")
    expect(await whyLine(root, "src/pay.ts", 1)).toMatchObject({ uncommitted: true, adrs: [] })
    expect((await whyLine(root, "src/pay.ts", 99)).answer[0]!.text).toMatch(/cannot say/)
  })
})
