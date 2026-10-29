import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  auditDir,
  configPath,
  createCheckpoint,
  gatehouseDataDir,
  listCheckpoints,
  loadConfig,
  unknownConfigKeys,
  safeSegment,
} from "../src/node/index.js"

let root: string
let n = 0
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-node-"))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim()

function repo(withCommit = true): string {
  const dir = path.join(root, `r${n++}`)
  fs.mkdirSync(dir)
  git(dir, "init", "-q")
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n")
  fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n")
  if (withCommit) {
    git(dir, "add", ".")
    git(dir, "commit", "-q", "-m", "init")
  }
  return dir
}

describe("data directory and config", () => {
  it("uses LOCALAPPDATA, with overrides for tests", () => {
    expect(gatehouseDataDir({ LOCALAPPDATA: "C:/L" })).toBe(path.join("C:/L", "Gatehouse"))
    expect(gatehouseDataDir({ GATEHOUSE_DATA_DIR: "D:/x" })).toBe("D:/x")
    expect(auditDir({ LOCALAPPDATA: "C:/L" })).toBe(path.join("C:/L", "Gatehouse", "audit"))
    expect(auditDir({ GATEHOUSE_AUDIT_DIR: "E:/a" })).toBe("E:/a")
    expect(gatehouseDataDir({}).endsWith("Gatehouse")).toBe(true)
  })

  it("gives defaults when there is no config file and rejects an invalid one", () => {
    const env = { GATEHOUSE_DATA_DIR: path.join(root, "data") }
    expect(loadConfig(env)).toMatchObject({ redactTerms: [], hardTimeoutMs: 1_800_000 })
    fs.mkdirSync(env.GATEHOUSE_DATA_DIR)
    fs.writeFileSync(
      configPath(env),
      JSON.stringify({ redactTerms: ["Acme"], expectedOrg: "ACN - Premium" }),
    )
    expect(loadConfig(env)).toMatchObject({ redactTerms: ["Acme"], expectedOrg: "ACN - Premium" })
    fs.writeFileSync(configPath(env), JSON.stringify({ redactTerms: "x" }))
    expect(() => loadConfig(env)).toThrow()
    // A setting from a newer version is kept, not refused, so undoing an update never breaks the settings.
    fs.writeFileSync(
      configPath(env),
      JSON.stringify({ unknownKey: 1, push: { ntfy: undefined, later: 2 } }),
    )
    expect(loadConfig(env)).toMatchObject({ unknownKey: 1, push: { later: 2 } })
    expect(unknownConfigKeys({ unknownKey: 1, push: { later: 2 } }).sort()).toEqual([
      "push.later",
      "unknownKey",
    ])
    expect(unknownConfigKeys({ redactTerms: [] })).toEqual([])
    expect(configPath({ GATEHOUSE_CONFIG: "Z:/c.json" })).toBe("Z:/c.json")
  })
})

describe("settings for quiet hours and updates", () => {
  it("accepts real times for quiet hours and the digest", () => {
    const env = { GATEHOUSE_CONFIG: path.join(root, "qh.json") }
    fs.writeFileSync(
      env.GATEHOUSE_CONFIG,
      JSON.stringify({
        quietHours: { start: "22:00", end: "07:30", tz: "Europe/London" },
        digestTime: "08:15",
      }),
    )
    expect(loadConfig(env).quietHours).toEqual({
      start: "22:00",
      end: "07:30",
      tz: "Europe/London",
    })
    for (const bad of ["24:00", "7:00", "07:60", "0d:00"]) {
      fs.writeFileSync(
        env.GATEHOUSE_CONFIG,
        JSON.stringify({ quietHours: { start: bad, end: "07:00", tz: "Europe/London" } }),
      )
      expect(() => loadConfig(env), bad).toThrow()
    }
  })

  it("checks for updates every 30 minutes unless told otherwise, and only at the offered intervals", () => {
    const env = { GATEHOUSE_CONFIG: path.join(root, "up.json") }
    fs.rmSync(env.GATEHOUSE_CONFIG, { force: true })
    expect(loadConfig(env).updates).toEqual({
      checkEveryMinutes: 30,
      skipped: [],
      downloadInBackground: true,
    })
    fs.writeFileSync(
      env.GATEHOUSE_CONFIG,
      JSON.stringify({ updates: { checkEveryMinutes: 0, skipped: ["1.0.7"] } }),
    )
    expect(loadConfig(env).updates).toMatchObject({ checkEveryMinutes: 0, skipped: ["1.0.7"] })
    fs.writeFileSync(env.GATEHOUSE_CONFIG, JSON.stringify({ updates: { checkEveryMinutes: 1 } }))
    expect(() => loadConfig(env)).toThrow()
  })
})

describe("createCheckpoint", () => {
  it("records changes, untracked files and a deletion without touching the working tree, index or HEAD", async () => {
    const dir = repo()
    fs.writeFileSync(path.join(dir, "a.txt"), "two\n")
    fs.writeFileSync(path.join(dir, "new.txt"), "untracked\n")
    fs.writeFileSync(path.join(dir, "ignored.txt"), "ignored\n")
    const headBefore = git(dir, "rev-parse", "HEAD")
    const statusBefore = git(dir, "status", "--porcelain")
    const cp = await createCheckpoint({
      cwd: dir,
      sessionId: "sess 1",
      label: "before the risky bit",
    })
    expect(cp.ref).toMatch(/^refs\/gatehouse\/checkpoints\/sess-1\/\d{8}T\d{9}Z$/)
    expect(cp.base).toBe(headBefore)
    expect(git(dir, "rev-parse", "HEAD")).toBe(headBefore)
    expect(git(dir, "status", "--porcelain")).toBe(statusBefore)
    expect(git(dir, "show", `${cp.commit}:a.txt`)).toBe("two")
    expect(git(dir, "show", `${cp.commit}:new.txt`)).toBe("untracked")
    expect(() => git(dir, "show", `${cp.commit}:ignored.txt`)).toThrow()
    expect(git(dir, "log", "-1", "--format=%s", cp.commit)).toBe(
      "gatehouse checkpoint: before the risky bit",
    )
    expect(git(dir, "rev-parse", cp.ref)).toBe(cp.commit)
  })

  it("never captures files matching the exclude globs", async () => {
    const dir = repo()
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=1\n")
    fs.mkdirSync(path.join(dir, "sub"))
    fs.writeFileSync(path.join(dir, "sub", "Server.PEM"), "key\n")
    fs.writeFileSync(path.join(dir, "ok.txt"), "fine\n")
    const cp = await createCheckpoint({
      cwd: dir,
      sessionId: "s",
      label: "x",
      excludeGlobs: ["**/.env", "**/*.pem"],
    })
    const files = git(dir, "ls-tree", "-r", "--name-only", cp.commit).split("\n")
    expect(files).toContain("ok.txt")
    expect(files).not.toContain(".env")
    expect(files).not.toContain("sub/Server.PEM")
  })

  it("works in a repository with no commits and from a sub-folder", async () => {
    const dir = repo(false)
    fs.mkdirSync(path.join(dir, "deep"))
    const cp = await createCheckpoint({
      cwd: path.join(dir, "deep"),
      sessionId: "s",
      label: "first",
    })
    expect(cp.base).toBeUndefined()
    expect(git(dir, "ls-tree", "-r", "--name-only", cp.commit)).toContain("a.txt")
  })

  it("keeps two checkpoints taken in the same millisecond apart, and lists them newest first", async () => {
    const dir = repo()
    const fixed = () => new Date("2026-01-01T00:00:00.000Z")
    const a = await createCheckpoint({ cwd: dir, sessionId: "s", label: "a", now: fixed })
    const b = await createCheckpoint({ cwd: dir, sessionId: "s", label: "b", now: fixed })
    expect(a.ref).not.toBe(b.ref)
    const list = await listCheckpoints(dir, "s")
    expect(list.map((c) => c.label).sort()).toEqual(["a", "b"])
    expect((await listCheckpoints(dir)).length).toBe(2)
    expect(await listCheckpoints(dir, "other")).toEqual([])
  })

  it("cleans odd labels and session ids, and fails clearly outside a repository", async () => {
    const dir = repo()
    const cp = await createCheckpoint({
      cwd: dir,
      sessionId: "../../evil",
      label: "line1\nline2\u0007  x",
    })
    expect(cp.ref.startsWith("refs/gatehouse/checkpoints/evil/")).toBe(true)
    expect(cp.label).toBe("line1 line2 x")
    expect(safeSegment("")).toBe("session")
    expect(safeSegment("a/b c")).toBe("a-b-c")
    const plain = fs.mkdtempSync(path.join(root, "plain-"))
    await expect(createCheckpoint({ cwd: plain, sessionId: "s", label: "x" })).rejects.toThrow(
      /git rev-parse failed/,
    )
  })
})
