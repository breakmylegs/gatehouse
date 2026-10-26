import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  canonicalize,
  computePayloadHash,
  newNonce,
  phonePayload,
  sha256Hex,
  uuidv7,
  UUID_V7,
  type EscalationRequest,
} from "../src/index.js"
import {
  createCheckpoint,
  loadConfig,
  listCheckpoints,
  previewRestore,
  readState,
  restoreCheckpoint,
  statePath,
  writeFileAtomic,
  writeState,
} from "../src/node/index.js"

let root: string
let n = 0
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-phase3-"))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe("uuidv7", () => {
  it("is a valid version 7 id that embeds the time and sorts by creation time", () => {
    const a = uuidv7(1_700_000_000_000)
    const b = uuidv7(1_700_000_000_001)
    const c = uuidv7(1_800_000_000_000)
    for (const id of [a, b, c]) expect(id).toMatch(UUID_V7)
    expect([c, a, b].sort()).toEqual([a, b, c])
    expect(a.startsWith("018bcfe5-6800-7")).toBe(true)
  })
  it("makes different ids in the same millisecond", () => {
    const ids = new Set(Array.from({ length: 500 }, () => uuidv7(1_700_000_000_000)))
    expect(ids.size).toBe(500)
  })
})

describe("escalation request helpers", () => {
  const req: Omit<EscalationRequest, "payloadHash"> = {
    id: uuidv7(),
    nonce: newNonce(),
    kind: "permission",
    sessionId: "s",
    toolUseId: "t",
    toolName: "Bash",
    input: { command: "git push" },
    cwd: "C:/dev/app",
    project: "app",
    verdict: { outcome: "escalate", ruleId: "git-remote", reason: "r", risk: 80, decidedBy: "rules", policyHash: "h" },
    createdAt: "2026-10-26T10:00:00.000Z",
    expiresAt: "2026-10-26T10:10:00.000Z",
  }

  it("makes a 32 byte url-safe nonce each time", () => {
    const a = newNonce()
    expect(Buffer.from(a, "base64url")).toHaveLength(32)
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newNonce()).not.toBe(a)
  })

  it("hashes the canonical plaintext payload, and any change to it changes the hash", () => {
    const hash = computePayloadHash(req)
    expect(hash).toBe(sha256Hex(canonicalize(phonePayload(req))))
    expect(computePayloadHash({ ...req })).toBe(hash)
    expect(computePayloadHash({ ...req, input: { command: "git push --tags" } })).not.toBe(hash)
    expect(computePayloadHash({ ...req, nonce: newNonce() })).not.toBe(hash)
    expect(computePayloadHash({ ...req, expiresAt: "2026-10-26T10:11:00.000Z" })).not.toBe(hash)
  })

  it("leaves out the session and tool use ids and the policy hash from what the phone sees", () => {
    const keys = Object.keys(phonePayload(req)).sort()
    expect(keys).toEqual(["createdAt", "cwd", "expiresAt", "id", "input", "kind", "nonce", "project", "toolName", "verdict"])
  })
})

describe("persisted state (the kill switch survives restarts)", () => {
  const env = (name: string) => ({ GATEHOUSE_STATE: path.join(root, name, "state.json") })

  it("is not engaged when there is no file", () => {
    expect(readState(env("none")).killSwitch.engaged).toBe(false)
  })

  it("round trips an engaged switch", async () => {
    const e = env("rt")
    await writeState({ killSwitch: { engaged: true, since: "now", by: "desktop", reason: "test" } }, e)
    expect(readState(e).killSwitch).toEqual({ engaged: true, since: "now", by: "desktop", reason: "test" })
    await writeState({ killSwitch: { engaged: false } }, e)
    expect(readState(e).killSwitch.engaged).toBe(false)
    expect(statePath(e)).toBe(e.GATEHOUSE_STATE)
  })

  it("treats a damaged state file as ENGAGED, so damage can never re-arm the system", async () => {
    const e = env("bad")
    fs.mkdirSync(path.dirname(e.GATEHOUSE_STATE), { recursive: true })
    for (const text of ["not json", "[]", '{"killSwitch":{"engaged":"yes"}}', ""]) {
      fs.writeFileSync(e.GATEHOUSE_STATE, text)
      const s = readState(e)
      expect(s.killSwitch.engaged, text).toBe(true)
      expect(s.damaged).toBe(true)
    }
  })

  it("writes atomically and leaves no temporary files", async () => {
    const file = path.join(root, `atomic${n++}.txt`)
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeFileAtomic(file, `value ${i}\n`)))
    expect(fs.readFileSync(file, "utf8")).toMatch(/^value \d\n$/)
    expect(fs.readdirSync(root).filter((f) => f.startsWith(path.basename(file)) && f.endsWith(".tmp"))).toEqual([])
  })
})

describe("config", () => {
  it("has the spec's timeouts and checkpoint settings by default", () => {
    const c = loadConfig({ GATEHOUSE_DATA_DIR: path.join(root, "nodata") })
    expect(c).toMatchObject({
      phoneExpiryMs: 600_000,
      hardTimeoutMs: 1_800_000,
      checkpoints: { beforeEscalation: true, editBursts: true, burstWindowMs: 60_000 },
    })
  })
  it("accepts overrides and rejects nonsense", () => {
    const dir = path.join(root, `cfg${n++}`)
    fs.mkdirSync(dir)
    const e = { GATEHOUSE_DATA_DIR: dir }
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ hardTimeoutMs: 20_000, checkpoints: { beforeEscalation: false } }))
    expect(loadConfig(e)).toMatchObject({ hardTimeoutMs: 20_000, checkpoints: { beforeEscalation: false, editBursts: true } })
    for (const bad of [{ hardTimeoutMs: 5 }, { phoneExpiryMs: "soon" }, { checkpoints: { other: 1 } }]) {
      fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(bad))
      expect(() => loadConfig(e)).toThrow()
    }
  })
})

describe("checkpoint preview and restore", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    }).trim()
  // git restore writes files with the user's line-ending setting (core.autocrlf), so compare the content only.
  const rd = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n")
  const exclude = ["**/.env"]

  function repo(): string {
    const dir = path.join(root, `repo${n++}`)
    fs.mkdirSync(dir)
    git(dir, "init", "-q")
    fs.writeFileSync(path.join(dir, "a.txt"), "one\n")
    fs.writeFileSync(path.join(dir, "keep.txt"), "keep\n")
    fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n")
    git(dir, "add", ".")
    git(dir, "commit", "-q", "-m", "init")
    return dir
  }

  it("previews exactly what a restore would change, and changes nothing", async () => {
    const dir = repo()
    fs.writeFileSync(path.join(dir, "a.txt"), "two\n")
    const cp = await createCheckpoint({ cwd: dir, sessionId: "s", label: "mid", excludeGlobs: exclude })
    fs.writeFileSync(path.join(dir, "a.txt"), "three\n")
    fs.writeFileSync(path.join(dir, "made-since.txt"), "new\n")
    fs.rmSync(path.join(dir, "keep.txt"))
    const before = git(dir, "status", "--porcelain")
    const p = await previewRestore(dir, cp.ref, exclude)
    expect(p.changes.sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "a.txt", change: "modified" },
      { path: "keep.txt", change: "added" },
      { path: "made-since.txt", change: "deleted" },
    ])
    expect(p.diff).toContain("-three")
    expect(p.diff).toContain("+two")
    expect(p.truncated).toBe(false)
    expect(git(dir, "status", "--porcelain")).toBe(before)
    expect(rd(dir, "a.txt")).toBe("three\n")
  })

  it("refuses to restore without confirmation, and for references that are not Gatehouse checkpoints", async () => {
    const dir = repo()
    const cp = await createCheckpoint({ cwd: dir, sessionId: "s", label: "x" })
    await expect(restoreCheckpoint({ cwd: dir, ref: cp.ref, sessionId: "s", confirm: false })).rejects.toThrow(/confirmation/)
    for (const ref of ["HEAD", "refs/heads/master", "refs/gatehouse/checkpoints/../../heads/x", "refs/gatehouse/checkpoints/s/x y", cp.commit]) {
      await expect(previewRestore(dir, ref)).rejects.toThrow(/Not a Gatehouse checkpoint/)
      await expect(restoreCheckpoint({ cwd: dir, ref, sessionId: "s", confirm: true })).rejects.toThrow(/Not a Gatehouse checkpoint/)
    }
  })

  it("restores files, removes files made since, leaves secrets and ignored files alone, and keeps the index", async () => {
    const dir = repo()
    fs.writeFileSync(path.join(dir, "a.txt"), "two\n")
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=before\n")
    const cp = await createCheckpoint({ cwd: dir, sessionId: "s", label: "good state", excludeGlobs: exclude })
    fs.writeFileSync(path.join(dir, "a.txt"), "broken\n")
    fs.writeFileSync(path.join(dir, "made-since.txt"), "oops\n")
    fs.writeFileSync(path.join(dir, ".env"), "SECRET=changed\n")
    fs.writeFileSync(path.join(dir, "ignored.txt"), "ignored\n")
    fs.rmSync(path.join(dir, "keep.txt"))
    const indexBefore = git(dir, "ls-files", "--stage")

    const r = await restoreCheckpoint({ cwd: dir, ref: cp.ref, sessionId: "s", confirm: true, excludeGlobs: exclude })
    expect(rd(dir, "a.txt")).toBe("two\n")
    expect(rd(dir, "keep.txt")).toBe("keep\n")
    expect(fs.existsSync(path.join(dir, "made-since.txt"))).toBe(false)
    expect(rd(dir, ".env")).toBe("SECRET=changed\n")
    expect(rd(dir, "ignored.txt")).toBe("ignored\n")
    expect(git(dir, "ls-files", "--stage")).toBe(indexBefore)
    expect(r.restored.sort()).toEqual(["a.txt", "keep.txt"])
    expect(r.deleted).toEqual(["made-since.txt"])
    expect(r.safety.ref).toMatch(/refs\/gatehouse\/checkpoints\/s\//)
    expect((await listCheckpoints(dir, "s")).map((c) => c.label)).toContain("good state")
  })

  it("can be undone from the safety checkpoint it makes", async () => {
    const dir = repo()
    const cp = await createCheckpoint({ cwd: dir, sessionId: "s", label: "start", excludeGlobs: exclude })
    fs.writeFileSync(path.join(dir, "a.txt"), "later work\n")
    fs.writeFileSync(path.join(dir, "later.txt"), "later file\n")
    const r = await restoreCheckpoint({ cwd: dir, ref: cp.ref, sessionId: "s", confirm: true, excludeGlobs: exclude })
    expect(rd(dir, "a.txt")).toBe("one\n")
    expect(fs.existsSync(path.join(dir, "later.txt"))).toBe(false)
    await restoreCheckpoint({ cwd: dir, ref: r.safety.ref, sessionId: "s", confirm: true, excludeGlobs: exclude })
    expect(rd(dir, "a.txt")).toBe("later work\n")
    expect(rd(dir, "later.txt")).toBe("later file\n")
  })

  it("handles names with spaces and sub-folders, and a restore with nothing to do", async () => {
    const dir = repo()
    fs.mkdirSync(path.join(dir, "sub dir"))
    fs.writeFileSync(path.join(dir, "sub dir", "my file.txt"), "x\n")
    const cp = await createCheckpoint({ cwd: dir, sessionId: "s", label: "spaces", excludeGlobs: exclude })
    fs.writeFileSync(path.join(dir, "sub dir", "my file.txt"), "y\n")
    const p = await previewRestore(dir, cp.ref, exclude)
    expect(p.changes).toEqual([{ path: "sub dir/my file.txt", change: "modified" }])
    await restoreCheckpoint({ cwd: dir, ref: cp.ref, sessionId: "s", confirm: true, excludeGlobs: exclude })
    expect(rd(dir, "sub dir/my file.txt")).toBe("x\n")
    const again = await restoreCheckpoint({ cwd: dir, ref: cp.ref, sessionId: "s", confirm: true, excludeGlobs: exclude })
    expect(again.restored).toEqual([])
    expect(again.deleted).toEqual([])
  })
})
