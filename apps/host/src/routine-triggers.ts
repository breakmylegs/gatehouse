import fs from "node:fs"
import path from "node:path"

/**
 * B34, the later part: routines started by a new commit in their folder, or by files in it changing, as well as by the
 * clock. Each start goes through the same path as a scheduled one (recorded first, then a normal session, so the kill
 * switch, the sign-in and organisation check, the session limit and every rule apply).
 *
 * A routine's own session changes files and may commit, which must not start it again and again. So:
 * - what changes while its session is working, and for a while after, is not counted, and the commit it ends on is
 *   taken as seen;
 * - it starts at most once in TRIGGER_GAP_MS, and at most TRIGGER_DAY_CAP times a day;
 * - the first look at a folder only notes where it is: a routine never starts because Codehouse opened.
 * Changes in .git, node_modules and .codehouse do not count. Git is read from its files; no program is run.
 */
export type Trigger = { kind: "commit" } | { kind: "files" }

export const TRIGGER_GAP_MS = 15 * 60_000
export const TRIGGER_DAY_CAP = 12
const IGNORED = /^(\.git|node_modules|\.codehouse)([\\/]|$)/i
const HASH = /^[0-9a-f]{40,64}$/
const QUIET_MS = 90_000

/** The .git folder for a working folder (a worktree's .git file points to its own), or undefined. */
function gitDir(folder: string): string | undefined {
  const dot = path.join(folder, ".git")
  try {
    const st = fs.statSync(dot)
    if (st.isDirectory()) return dot
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dot, "utf8"))
    return m ? path.resolve(folder, m[1]!.trim()) : undefined
  } catch {
    return undefined
  }
}

/** The commit a folder's HEAD is on, read from git's files, or undefined when it is not a repository. */
export function headCommit(folder: string): string | undefined {
  const dir = gitDir(folder)
  if (!dir) return undefined
  try {
    const head = fs.readFileSync(path.join(dir, "HEAD"), "utf8").trim()
    if (HASH.test(head)) return head
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1]
    if (!ref || ref.includes("..")) return undefined
    // A worktree keeps its branches in the main repository's folder.
    let common = dir
    try {
      common = path.resolve(dir, fs.readFileSync(path.join(dir, "commondir"), "utf8").trim())
    } catch {
      // not a worktree
    }
    for (const d of [dir, common]) {
      try {
        const v = fs.readFileSync(path.join(d, ref), "utf8").trim()
        if (HASH.test(v)) return v
      } catch {
        // not a loose ref here
      }
    }
    const packed = fs.readFileSync(path.join(common, "packed-refs"), "utf8")
    for (const line of packed.split(/\r?\n/)) {
      const [hash, name] = line.split(" ")
      if (name === ref && hash && HASH.test(hash)) return hash
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Watches a folder and everything in it; returns how to stop. Nothing is watched when it cannot be. */
export function watchFolder(folder: string, onChange: () => void): () => void {
  try {
    const w = fs.watch(folder, { recursive: true }, (_e, name) => {
      if (name && IGNORED.test(String(name))) return
      onChange()
    })
    w.on("error", () => undefined)
    return () => w.close()
  } catch {
    return () => undefined
  }
}

export interface Triggered {
  id: string
  name: string
  folder: string
  enabled: boolean
  trigger?: Trigger
}

export interface TriggerDeps<R extends Triggered> {
  list: () => R[]
  /** Starts the routine's session; its id, or nothing. Throws when it cannot start. */
  start: (r: R) => Promise<string | void>
  /** Whether that session is working (a turn running, or waiting on you). */
  working: (sessionId: string) => boolean
  log: (line: string) => void
  now?: () => Date
  head?: (folder: string) => string | undefined
  watch?: (folder: string, onChange: () => void) => () => void
}

const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export class TriggerWatcher<R extends Triggered> {
  readonly #d: TriggerDeps<R>
  readonly #seen = new Map<string, string | undefined>()
  readonly #pending = new Set<string>()
  readonly #watching = new Map<string, { folder: string; stop: () => void }>()
  readonly #session = new Map<string, string>()
  readonly #last = new Map<string, number>()
  /** Until when changes are its own session's: while it works, and QUIET_MS after the last look that saw it working. */
  readonly #quietUntil = new Map<string, number>()
  readonly #count = new Map<string, { day: string; n: number }>()
  #timer: NodeJS.Timeout | undefined
  #busy = false

  constructor(d: TriggerDeps<R>) {
    this.#d = d
  }

  start(everyMs = 30_000): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.check(), everyMs)
    this.#timer.unref()
  }

  stop(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
    for (const w of this.#watching.values()) w.stop()
    this.#watching.clear()
  }

  #at(): number {
    return (this.#d.now ?? (() => new Date()))().getTime()
  }

  #own(id: string, at = this.#at()): boolean {
    const s = this.#session.get(id)
    if (s !== undefined && this.#d.working(s)) {
      this.#quietUntil.set(id, at + QUIET_MS)
      return true
    }
    return at < (this.#quietUntil.get(id) ?? 0)
  }

  async check(): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    try {
      const now = (this.#d.now ?? (() => new Date()))()
      const head = this.#d.head ?? headCommit
      const watch = this.#d.watch ?? watchFolder
      const routines = this.#d.list().filter((r) => r.enabled && r.trigger)
      // Watches only what still has a files trigger, for the folder it names now.
      const want = new Map(
        routines.filter((r) => r.trigger?.kind === "files").map((r) => [r.id, r.folder]),
      )
      for (const [id, w] of this.#watching)
        if (want.get(id) !== w.folder) {
          w.stop()
          this.#watching.delete(id)
        }
      for (const [id, folder] of want)
        if (!this.#watching.has(id))
          this.#watching.set(id, {
            folder,
            stop: watch(folder, () => {
              if (!this.#own(id)) this.#pending.add(id)
            }),
          })
      for (const r of routines) {
        if (r.trigger?.kind === "commit") {
          const h = head(r.folder)
          const known = this.#seen.has(r.id)
          const was = this.#seen.get(r.id)
          this.#seen.set(r.id, h)
          // The first look only notes it; what its own session commits is taken as seen.
          if (known && h && h !== was && !this.#own(r.id, now.getTime())) this.#pending.add(r.id)
        }
        if (!this.#pending.has(r.id) || this.#own(r.id, now.getTime())) continue
        if (now.getTime() - (this.#last.get(r.id) ?? 0) < TRIGGER_GAP_MS) continue
        const c = this.#count.get(r.id)
        const today = c?.day === day(now) ? c.n : 0
        this.#pending.delete(r.id)
        if (today >= TRIGGER_DAY_CAP) {
          this.#d.log(`routine ${r.name} was not started: it already ran ${today} times today`)
          continue
        }
        this.#last.set(r.id, now.getTime())
        this.#count.set(r.id, { day: day(now), n: today + 1 })
        try {
          const s = await this.#d.start(r)
          if (s) this.#session.set(r.id, s)
        } catch (e) {
          this.#d.log(`routine ${r.name} did not start: ${(e as Error).message}`)
        }
      }
    } finally {
      this.#busy = false
    }
  }
}
