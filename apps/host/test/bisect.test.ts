// E-044: git bisect in a scratch worktree finds the seeded bad commit; your working tree, its uncommitted change and
// what node_modules points to are untouched; the worktree is gone afterwards.
import { exec, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bisect, safeRef, type BisectRun } from "../src/bisect.js"

let root = ""
const shas: string[] = []
const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: root, encoding: "utf8" }).trim()

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-bisect-repo-"))
  g("init", "-q")
  // The check fails once total.js says "bad".
  fs.writeFileSync(path.join(root, "check.js"), "process.exit(require('fs').readFileSync('total.js', 'utf8').includes('bad') ? 1 : 0)\n")
  for (let i = 1; i <= 8; i++) {
    fs.writeFileSync(path.join(root, "total.js"), i >= 5 ? `// version ${i}, bad\n` : `// version ${i}\n`)
    g("add", "-A")
    g("commit", "-qm", `change ${i}`)
    shas.push(g("rev-parse", "HEAD"))
  }
  // Something node_modules holds, linked into the worktree; and an uncommitted change of yours.
  fs.mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true })
  fs.writeFileSync(path.join(root, "node_modules", "dep", "index.js"), "module.exports = 1\n")
  fs.writeFileSync(path.join(root, "notes.txt"), "work in progress\n")
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const run: BisectRun = (command, cwd) => new Promise((resolve) => exec(command, { cwd }, (e, out, err) => resolve({ ran: true, exitCode: e ? ((e as { code?: number }).code ?? 1) : 0, output: `${String(out)}${String(err)}` })))

describe("the bisect assistant", () => {
  it("finds the seeded bad commit", { timeout: 120_000 }, async () => {
    const statusBefore = g("status", "--porcelain")
    const headBefore = g("rev-parse", "HEAD")
    const r = await bisect(root, shas[0]!, shas[7]!, "node check.js", run)
    expect(r.notFound).toBeUndefined()
    expect(r.first).toMatchObject({ sha: shas[4], subject: "change 5" })
    expect(r.steps).toBeGreaterThan(0)
    // Your working tree is untouched: the same HEAD, the same uncommitted change, no bisect in progress.
    expect(g("rev-parse", "HEAD")).toBe(headBefore)
    expect(g("status", "--porcelain")).toBe(statusBefore)
    expect(fs.readFileSync(path.join(root, "notes.txt"), "utf8")).toBe("work in progress\n")
    expect(() => g("bisect", "log")).toThrow()
    // What node_modules held is still there, and the worktree is gone.
    expect(fs.readFileSync(path.join(root, "node_modules", "dep", "index.js"), "utf8")).toBe("module.exports = 1\n")
    expect(g("worktree", "list").split("\n")).toHaveLength(1)
    expect(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("codeh-bisect-") && !f.startsWith("codeh-bisect-repo-"))).toEqual([])
  })

  it("refuses names that could carry a command, and says when the check was not run", async () => {
    expect(safeRef("main~3")).toBe(true)
    expect(safeRef("HEAD; rm -rf /")).toBe(false)
    expect(safeRef("--exec=x")).toBe(false)
    expect(await bisect(root, "main && echo x", "HEAD", "node check.js", run)).toMatchObject({ notFound: expect.stringMatching(/plain names or hashes/) })
    const refused: BisectRun = async (command, cwd) => (command.startsWith("git bisect run") ? { ran: false, exitCode: null, output: "", refused: "the rules denied it" } : run(command, cwd))
    expect(await bisect(root, shas[0]!, shas[7]!, "node check.js", refused)).toMatchObject({ notFound: "the check was not run: the rules denied it" })
    expect(fs.existsSync(path.join(root, "node_modules", "dep", "index.js"))).toBe(true)
    expect(g("worktree", "list").split("\n")).toHaveLength(1)
  })
})
