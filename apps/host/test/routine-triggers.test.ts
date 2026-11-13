// B34, the later part: routines started by a new commit or by files changing, never by their own session's work.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  headCommit,
  TRIGGER_DAY_CAP,
  TRIGGER_GAP_MS,
  TriggerWatcher,
  type Triggered,
} from "../src/routine-triggers.js"
import { checkRoutine, isDue, RoutineStore } from "../src/routines.js"

// Mac fork: a full folder in this system's own form (C:\dev\shop is /dev/shop on a Mac).
const F = (p: string) => (process.platform === "win32" ? p : p.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/"))

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-triggers-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const A = "a".repeat(40)
const B = "b".repeat(40)
let n = 0

describe("the commit a folder is on", () => {
  it("is read from git's files: a branch, a packed branch, a detached head, and a worktree", () => {
    const repo = path.join(root, `r-${++n}`)
    fs.mkdirSync(path.join(repo, ".git", "refs", "heads"), { recursive: true })
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n")
    fs.writeFileSync(path.join(repo, ".git", "refs", "heads", "main"), `${A}\n`)
    expect(headCommit(repo)).toBe(A)
    fs.rmSync(path.join(repo, ".git", "refs", "heads", "main"))
    fs.writeFileSync(path.join(repo, ".git", "packed-refs"), `# pack-refs\n${B} refs/heads/main\n`)
    expect(headCommit(repo)).toBe(B)
    // A worktree: a .git file pointing at its own folder, branches in the main repository.
    const wt = path.join(root, `w-${n}`)
    const own = path.join(repo, ".git", "worktrees", "w")
    fs.mkdirSync(own, { recursive: true })
    fs.mkdirSync(wt)
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${own}\n`)
    fs.writeFileSync(path.join(own, "HEAD"), "ref: refs/heads/main\n")
    fs.writeFileSync(path.join(own, "commondir"), "../..\n")
    expect(headCommit(wt)).toBe(B)
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), `${A}\n`)
    expect(headCommit(repo)).toBe(A)
    expect(headCommit(path.join(root, "not-a-repo"))).toBeUndefined()
  })
})

/** A watcher over fake routines, a fake clock, HEADs and file changes. */
function rig(routines: Triggered[]) {
  let now = new Date(2026, 10, 4, 9, 0).getTime()
  const heads = new Map<string, string>()
  const changes = new Map<string, () => void>()
  const started: string[] = []
  const working = new Set<string>()
  const w = new TriggerWatcher({
    list: () => routines,
    start: async (r) => {
      started.push(r.id)
      return `s-${r.id}-${started.length}`
    },
    working: (id) => working.has(id),
    log: () => undefined,
    now: () => new Date(now),
    head: (f) => heads.get(f),
    watch: (f, on) => {
      changes.set(f, on)
      return () => changes.delete(f)
    },
  })
  return {
    w,
    started,
    heads,
    working,
    change: (f: string) => changes.get(f)?.(),
    watched: () => [...changes.keys()],
    later: (ms: number) => (now += ms),
  }
}

const commit: Triggered = {
  id: "c",
  name: "Review",
  folder: F("C:/r"),
  enabled: true,
  trigger: { kind: "commit" },
}
const files: Triggered = {
  id: "f",
  name: "Docs",
  folder: F("C:/f"),
  enabled: true,
  trigger: { kind: "files" },
}

describe("a routine started by a trigger", () => {
  it("starts on a new commit, but not on the first look when Codehouse opens", async () => {
    const r = rig([commit])
    r.heads.set(F("C:/r"), A)
    await r.w.check()
    expect(r.started).toEqual([])
    r.heads.set(F("C:/r"), B)
    await r.w.check()
    expect(r.started).toEqual(["c"])
  })

  it("starts when files change, and stops watching a routine that no longer has the trigger", async () => {
    const list = [files]
    const r = rig(list)
    await r.w.check()
    expect(r.watched()).toEqual([F("C:/f")])
    await r.w.check()
    expect(r.started).toEqual([])
    r.change(F("C:/f"))
    await r.w.check()
    expect(r.started).toEqual(["f"])
    list[0] = { ...files, enabled: false }
    await r.w.check()
    expect(r.watched()).toEqual([])
  })

  it("is not started again by its own session's changes or commits, nor for a while after", async () => {
    const r = rig([commit, files])
    r.heads.set(F("C:/r"), A)
    await r.w.check()
    r.heads.set(F("C:/r"), B)
    r.change(F("C:/f"))
    await r.w.check()
    expect(r.started).toEqual(["c", "f"])
    // Both sessions work: their commit and their file changes are their own.
    r.working.add("s-c-1").add("s-f-2")
    r.later(TRIGGER_GAP_MS + 1)
    r.heads.set(F("C:/r"), A)
    r.change(F("C:/f"))
    await r.w.check()
    r.working.clear()
    // Just after they finish, a late change is still theirs.
    r.change(F("C:/f"))
    r.later(30_000)
    await r.w.check()
    r.later(TRIGGER_GAP_MS)
    await r.w.check()
    expect(r.started).toEqual(["c", "f"])
  })

  it("starts at most once in the gap, and at most the day's cap", async () => {
    const r = rig([files])
    await r.w.check()
    r.change(F("C:/f"))
    await r.w.check()
    r.change(F("C:/f"))
    r.later(TRIGGER_GAP_MS - 1000)
    await r.w.check()
    expect(r.started).toHaveLength(1)
    r.later(1000)
    await r.w.check()
    expect(r.started).toHaveLength(2)
    for (let i = 0; i < TRIGGER_DAY_CAP + 3; i++) {
      r.later(TRIGGER_GAP_MS)
      r.change(F("C:/f"))
      await r.w.check()
    }
    expect(r.started).toHaveLength(TRIGGER_DAY_CAP)
  })
})

describe("routines with a trigger", () => {
  it("need no time or days, never run on the clock, and are kept apart so an older version keeps them", async () => {
    const t = checkRoutine({
      name: "On commit",
      folder: F("C:\\dev\\shop"),
      prompt: "Review the last commit.",
      trigger: { kind: "commit" },
    })
    expect(t).toMatchObject({ trigger: { kind: "commit" }, days: [] })
    expect(() =>
      checkRoutine({ name: "x", folder: F("C:\\x"), prompt: "p", trigger: { kind: "push" } as never }),
    ).toThrow(/schedule, a new commit, or files changing/)
    expect(
      isDue({ id: "1", ...t, days: ["wed"], time: "09:00" }, new Date(2026, 10, 4, 9, 5)),
    ).toBe(false)
    const file = path.join(root, `routines-${++n}.json`)
    const store = new RoutineStore(file)
    await store.put(t)
    await store.put({
      name: "Morning",
      folder: F("C:\\dev\\shop"),
      prompt: "p",
      time: "08:00",
      days: ["mon"],
    })
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Array<{ name: string }>>
    expect(raw.routines?.map((r) => r.name)).toEqual(["Morning"])
    expect(raw.triggered?.map((r) => r.name)).toEqual(["On commit"])
    expect(
      new RoutineStore(file)
        .list()
        .map((r) => r.name)
        .sort(),
    ).toEqual(["Morning", "On commit"])
  })
})
