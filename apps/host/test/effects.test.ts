// Backlog G20: what a call would delete or throw away, counted and named, and whether git can bring it back.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { commandsOf, effectsOf } from "../src/effects.js"

let repo: string
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true })
const write = (rel: string, text = "x\n") => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
  fs.writeFileSync(path.join(repo, rel), text)
}

beforeEach(() => {
  repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-effects-")))
  git("init", "--quiet", "-b", "main")
  git("config", "user.email", "test@example.com")
  git("config", "user.name", "Test")
  write("src/a.ts")
  write("src/b.ts")
  write("docs/readme.md")
  git("add", ".")
  git("commit", "--quiet", "-m", "first")
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

const bash = (command: string) => effectsOf("Bash", { command }, repo)

describe("what a call would delete", { timeout: 60_000 }, () => {
  it("splits a command line into its commands, quotes taken off", () => {
    expect(commandsOf(`cd src && rm -rf "my dir" ; echo 'a b'|wc`)).toEqual([
      ["cd", "src"],
      ["rm", "-rf", "my dir"],
      ["echo", "a b"],
      ["wc"],
    ])
  })

  it("counts and names the files a delete removes, and says git can bring back committed ones", async () => {
    const e = await bash("rm -rf src")
    expect(e).toMatchObject({ kind: "delete", count: 2, reversible: true, more: false })
    expect(e!.paths.sort()).toEqual(["src/a.ts", "src/b.ts"])
    expect(e!.undo).toMatch(/git restore/)
  })

  it("says a delete cannot be undone when a file is not committed, changed since, or outside git", async () => {
    write("src/new.ts")
    expect(await bash("rm src/*.ts")).toMatchObject({ count: 3, reversible: false })
    git("checkout", "--quiet", "--", ".")
    fs.rmSync(path.join(repo, "src/new.ts"))
    write("src/a.ts", "changed\n")
    const e = await bash("rm src/a.ts")
    expect(e).toMatchObject({ count: 1, reversible: false })
    expect(e!.undo).toMatch(/1 file is not committed/)
  })

  it("reads PowerShell and cmd deletes too", async () => {
    expect(
      await effectsOf("PowerShell", { command: "Remove-Item -Recurse -Force -Path docs" }, repo),
    ).toMatchObject({ kind: "delete", count: 1, paths: ["docs/readme.md"], reversible: true })
    expect(await effectsOf("PowerShell", { command: "del /s /q src" }, repo)).toMatchObject({
      count: 2,
    })
  })

  it("takes a path it cannot read as one that cannot be undone", async () => {
    for (const c of [
      "rm -rf $HOME/x",
      "rm -rf ~/x",
      "rm -rf src/**/a.ts",
      "Remove-Item -Path src -Filter *.ts",
    ])
      expect(await bash(c), c).toMatchObject({ reversible: false, more: true })
  })

  it("names the work not committed that git reset --hard, restore or clean would throw away", async () => {
    write("src/a.ts", "mine\n")
    write("scratch.txt")
    const reset = await bash("git reset --hard")
    expect(reset).toMatchObject({
      kind: "discard",
      count: 1,
      paths: ["src/a.ts"],
      reversible: false,
    })
    expect(await bash("git checkout -- docs")).toBeUndefined()
    expect(await bash("git restore src/a.ts")).toMatchObject({ count: 1 })
    expect(await bash("git clean -fd")).toMatchObject({ kind: "discard", paths: ["scratch.txt"] })
  })

  it("takes the shell's rmdir, which removes only empty folders, as losing nothing, even of a path it cannot read", async () => {
    // Owner, 9 Nov: Extreme approval asked about this, as a delete it could not undo.
    expect(await bash('mkdir -p data/ae && rmdir "$TEMP/ae" 2>/dev/null; ls data/ae')).toBeUndefined()
    expect(await bash("rmdir -p --ignore-fail-on-non-empty a/b/c")).toBeUndefined()
    // An option it does not know, and PowerShell's rmdir (Remove-Item), are deletes like any other.
    expect(await bash("rmdir --force $HOME/x")).toMatchObject({ reversible: false })
    expect(
      await effectsOf("PowerShell", { command: "rmdir -Recurse $env:TEMP/x" }, repo),
    ).toMatchObject({ reversible: false })
    // And rmdir beside rm is still a delete for rm's part.
    expect(await bash("rmdir a && rm -rf $HOME/x")).toMatchObject({ reversible: false })
  })

  it("leaves alone a command that deletes and discards nothing", async () => {
    expect(await bash("git status && ls -la")).toBeUndefined()
    expect(await bash("git restore --staged src/a.ts")).toBeUndefined()
    expect(await effectsOf("Write", { file_path: "x", content: "" }, repo)).toBeUndefined()
  })

  it("errs toward cannot be undone when git does not answer", async () => {
    const broken = async () => {
      throw new Error("git is not there")
    }
    expect(await effectsOf("Bash", { command: "rm src/a.ts" }, repo, broken)).toMatchObject({
      reversible: false,
    })
  })
})
