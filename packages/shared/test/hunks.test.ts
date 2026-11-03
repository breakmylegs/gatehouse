// B12: one change in a file is put back on its own, after a safety checkpoint, and only against the version shown.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createCheckpoint,
  hunksOf,
  listCheckpoints,
  revertHunk,
  textHash,
} from "../src/node/checkpoint.js"

// Every step here starts hidden git processes. Where each hidden start is slow (3 Nov: 1.5 to 3 s on the owner's
// laptop, against 0.2 s for a visible one), the usual minute is not enough.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 })

let repo: string
let ref: string
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: repo,
    encoding: "utf8",
  })
const write = (f: string, text: string) => fs.writeFileSync(path.join(repo, f), text)
const read = (f: string) => fs.readFileSync(path.join(repo, f), "utf8")
const SECRETS = ["**/.env"]
const BEFORE = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n"

beforeEach(async () => {
  repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-hunks-")))
  git("init", "-q")
  git("config", "core.autocrlf", "false")
  write("a.txt", BEFORE)
  git("add", ".")
  git("commit", "-q", "-m", "init")
  ref = (
    await createCheckpoint({ cwd: repo, sessionId: "s1", label: "start", excludeGlobs: SECRETS })
  ).ref
  // Three changes: a line changed, a line added, a line removed.
  write("a.txt", "one\nTWO\nthree\nfour\nfour and a half\nfive\nsix\neight\n")
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10 }))

const undo = (hunk: number, afterHash = textHash(read("a.txt"))) =>
  revertHunk({
    cwd: repo,
    ref,
    path: "a.txt",
    hunk,
    afterHash,
    sessionId: "s1",
    confirm: true,
    excludeGlobs: SECRETS,
  })

describe("the changes in a file", () => {
  it("are found one by one", () => {
    expect(hunksOf(BEFORE, read("a.txt"))).toHaveLength(3)
    expect(hunksOf("same\n", "same\n")).toEqual([])
  })
})

describe("undoing one change", () => {
  it("puts back a changed line and leaves the others", async () => {
    const r = await undo(0)
    expect(read("a.txt")).toBe("one\ntwo\nthree\nfour\nfour and a half\nfive\nsix\neight\n")
    expect(r.left).toBe(2)
  })

  it("takes out an added line", async () => {
    await undo(1)
    expect(read("a.txt")).toBe("one\nTWO\nthree\nfour\nfive\nsix\neight\n")
  })

  it("puts back a removed line", async () => {
    await undo(2)
    expect(read("a.txt")).toBe("one\nTWO\nthree\nfour\nfour and a half\nfive\nsix\nseven\neight\n")
  })

  it("all three, one after another, give the file as it was", async () => {
    for (let i = 0; i < 3; i++) await undo(0)
    expect(read("a.txt")).toBe(BEFORE)
  })

  it("puts back a first line that was removed, and takes out one added at the top", async () => {
    write("a.txt", BEFORE.replace("one\n", ""))
    await undo(0)
    expect(read("a.txt")).toBe(BEFORE)
    write("a.txt", "zero\n" + BEFORE)
    await undo(0)
    expect(read("a.txt")).toBe(BEFORE)
  })

  it("works on a last line with no newline", async () => {
    write("a.txt", BEFORE.replace("eight\n", "EIGHT"))
    await undo(0)
    expect(read("a.txt")).toBe(BEFORE)
  })

  it("saves a checkpoint first, so the undo can be undone", async () => {
    const before = (await listCheckpoints(repo, "s1")).length
    const r = await undo(0)
    expect((await listCheckpoints(repo, "s1")).length).toBe(before + 1)
    expect(r.safety.label).toContain("before undoing a change in a.txt")
  })

  it("refuses when the file changed since it was shown, a change that is not there, or no confirmation", async () => {
    await expect(undo(0, textHash("an older version"))).rejects.toThrow(
      /changed since it was shown/,
    )
    await expect(undo(7)).rejects.toThrow(/no such change/)
    await expect(
      revertHunk({
        cwd: repo,
        ref,
        path: "a.txt",
        hunk: 0,
        afterHash: textHash(read("a.txt")),
        sessionId: "s1",
        confirm: false,
      }),
    ).rejects.toThrow(/confirmation/)
    expect(read("a.txt")).toContain("TWO")
  })

  it("never touches a secret or a file the session did not change", async () => {
    write(".env", "SECRET=1\n")
    await expect(
      revertHunk({
        cwd: repo,
        ref,
        path: ".env",
        hunk: 0,
        afterHash: textHash("SECRET=1\n"),
        sessionId: "s1",
        confirm: true,
        excludeGlobs: SECRETS,
      }),
    ).rejects.toThrow(/not one this session changed/)
  })
})
