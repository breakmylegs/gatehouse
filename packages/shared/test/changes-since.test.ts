import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  changesSince,
  createCheckpoint,
  listCheckpoints,
  restoreFiles,
} from "../src/node/checkpoint.js"

const repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-changes-")))
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: repo,
    encoding: "utf8",
  })
const write = (f: string, text: string) => fs.writeFileSync(path.join(repo, f), text)
const read = (f: string) => fs.readFileSync(path.join(repo, f), "utf8")
const SECRETS = ["**/.env"]
let ref = ""

beforeAll(async () => {
  git("init", "-q")
  // The same line endings on every machine, whatever its own git settings say.
  git("config", "core.autocrlf", "false")
  write("a.txt", "one\ntwo\n")
  write("b.txt", "keep me\n")
  git("add", ".")
  git("commit", "-q", "-m", "init")
  ref = (
    await createCheckpoint({ cwd: repo, sessionId: "s1", label: "start", excludeGlobs: SECRETS })
  ).ref
  // What the session then did.
  write("a.txt", "one\nTWO\n")
  fs.rmSync(path.join(repo, "b.txt"))
  write("c.txt", "new\n")
  write(".env", "SECRET=1\n")
})
afterAll(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10 }))

describe("what changed since a checkpoint", () => {
  it("lists each file with its kind of change, its line counts and its diff, and never a secret", async () => {
    const r = await changesSince(repo, ref, SECRETS)
    expect(r.files.map((f) => [f.path, f.change, f.added, f.removed])).toEqual([
      ["a.txt", "modified", 1, 1],
      ["b.txt", "deleted", 0, 1],
      ["c.txt", "added", 1, 0],
    ])
    const a = r.files.find((f) => f.path === "a.txt")
    expect(a?.diff).toContain("-two")
    expect(a?.diff).toContain("+TWO")
    expect(JSON.stringify(r)).not.toContain("SECRET")
  })
})

describe("undoing some files", () => {
  it("puts back only the files named, after a safety checkpoint", async () => {
    const before = (await listCheckpoints(repo, "s1")).length
    const r = await restoreFiles({
      cwd: repo,
      ref,
      paths: ["a.txt", "c.txt"],
      sessionId: "s1",
      confirm: true,
      excludeGlobs: SECRETS,
    })
    expect(read("a.txt")).toBe("one\ntwo\n")
    expect(fs.existsSync(path.join(repo, "c.txt"))).toBe(false)
    // Not named, so not touched.
    expect(fs.existsSync(path.join(repo, "b.txt"))).toBe(false)
    expect(fs.existsSync(path.join(repo, ".env"))).toBe(true)
    expect(r).toMatchObject({ restored: ["a.txt"], deleted: ["c.txt"] })
    expect((await listCheckpoints(repo, "s1")).length).toBe(before + 1)
  })

  it("refuses a file that did not change, and anything without confirmation", async () => {
    await expect(
      restoreFiles({ cwd: repo, ref, paths: ["a.txt"], sessionId: "s1", confirm: true }),
    ).rejects.toThrow(/Only files that changed/)
    await expect(
      restoreFiles({ cwd: repo, ref, paths: ["b.txt"], sessionId: "s1", confirm: false }),
    ).rejects.toThrow(/confirmation/)
    await expect(
      restoreFiles({ cwd: repo, ref, paths: ["../outside.txt"], sessionId: "s1", confirm: true }),
    ).rejects.toThrow(/Only files that changed/)
  })
})
