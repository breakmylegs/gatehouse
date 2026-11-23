// E-060: a change whose revert conflicts is reported as not reversible; one that reverts cleanly with its tests passing
// is reversible; your working tree is untouched.
import { exec, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { verifyBackout, type BackoutRun } from "../src/backout.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-backout-"))
  dirs.push(root)
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: root, encoding: "utf8" }).trim()
  g("init", "-q", "-b", "main")
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x", scripts: { test: "node check.js" } }))
  fs.writeFileSync(path.join(root, "check.js"), "process.exit(require('fs').readFileSync('total.js','utf8').includes('broken') ? 1 : 0)\n")
  fs.writeFileSync(path.join(root, "total.js"), "v1\n")
  g("add", "-A")
  g("commit", "-qm", "start")
  const base = g("rev-parse", "HEAD")
  return { root, base, g }
}
const run: BackoutRun = (command, cwd) => new Promise((resolve) => exec(command, { cwd }, (e, out) => resolve({ ran: true, exitCode: e ? ((e as { code?: number }).code ?? 1) : 0, output: String(out) })))

describe("backout plan verification", () => {
  it("proves a clean revert whose tests pass, and leaves your tree as it was", { timeout: 120_000 }, async () => {
    const { root, base, g } = repo()
    fs.writeFileSync(path.join(root, "total.js"), "v2\n")
    g("commit", "-qam", "change")
    fs.writeFileSync(path.join(root, "notes.txt"), "mine\n")
    const head = g("rev-parse", "HEAD")
    const r = await verifyBackout(root, base, run)
    expect(r).toMatchObject({ reversible: true, revert: "clean", tests: "pass" })
    expect(g("rev-parse", "HEAD")).toBe(head)
    expect(fs.readFileSync(path.join(root, "total.js"), "utf8")).toBe("v2\n")
    expect(fs.existsSync(path.join(root, "notes.txt"))).toBe(true)
    expect(g("worktree", "list").split("\n")).toHaveLength(1)
  })

  it("reports a change whose revert conflicts as not reversible", { timeout: 120_000 }, async () => {
    const { root, base, g } = repo()
    // The change sets the line to v2; later work on top changes the same line again.
    fs.writeFileSync(path.join(root, "total.js"), "v2\n")
    g("commit", "-qam", "the change")
    const change = g("rev-parse", "HEAD")
    fs.writeFileSync(path.join(root, "total.js"), "v3\n")
    g("commit", "-qam", "later work on the same line")
    const r = await verifyBackout(root, base, run, change)
    expect(r).toMatchObject({ reversible: false, revert: "conflicts", tests: "not run", detail: expect.stringMatching(/^the revert conflicts in total\.js/) })
    // Your tree is untouched and no worktree is left, even after a conflict.
    expect(fs.readFileSync(path.join(root, "total.js"), "utf8")).toBe("v3\n")
    expect(g("status", "--porcelain")).toBe("")
    expect(g("worktree", "list").split("\n")).toHaveLength(1)
  })

  it("reports a revert after which the tests fail as not reversible", { timeout: 120_000 }, async () => {
    const { root, base, g } = repo()
    // The change fixes the tests' own fixture; backing it out brings back what fails.
    fs.writeFileSync(path.join(root, "total.js"), "broken\n")
    g("commit", "-qam", "break it before the change")
    const mid = g("rev-parse", "HEAD")
    fs.writeFileSync(path.join(root, "total.js"), "fixed\n")
    g("commit", "-qam", "the change fixes it")
    const r = await verifyBackout(root, mid, run)
    expect(r).toMatchObject({ reversible: false, revert: "clean", tests: "fail", detail: expect.stringMatching(/tests fail after it/) })
    void base
  })

  it("says so when there is nothing to revert", async () => {
    const { root, base } = repo()
    expect(await verifyBackout(root, base, run)).toMatchObject({ reversible: true, revert: "nothing to revert" })
  })
})
