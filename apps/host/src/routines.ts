import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { folderExample, isFullFolder, writeFileAtomic } from "@gatehouse/shared/node" // Mac fork: folders
import type { Trigger } from "./routine-triggers.js"

/**
 * B34: local routines. A routine is a prompt for a folder, started as a normal session on the days and at the time you
 * choose, while Codehouse is open. It starts through the same path as any session, so the kill switch, the sign-in
 * and organisation check, the session limit and every rule apply; with Extreme approval its turn and spending limits
 * do too. Kept in %LOCALAPPDATA%\Gatehouse\routines.json, read tolerantly.
 *
 * A routine may instead start on a new commit in its folder, or when files in it change (routine-triggers.ts). Those
 * are kept apart, under `triggered`, so a version from before them keeps them as they are and never runs them on a
 * schedule.
 */
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
export type Day = (typeof DAYS)[number]

export interface Routine {
  id: string
  name: string
  folder: string
  prompt: string
  /** "HH:MM", local time. */
  time: string
  days: Day[]
  extreme?: boolean
  enabled: boolean
  /** Started by a new commit or by files changing, not by the clock; time and days are then not used. */
  trigger?: Trigger
  /** G23: each run works in a new git worktree of its folder, so it never touches your checkout. */
  worktree?: boolean
  /** G32: it may be started from the paired phone, by its name only, signed with the passkey. */
  phone?: boolean
  /** The local day ("YYYY-MM-DD") it last ran, so it runs once a day at most. */
  lastRun?: string
}

/** G23: one time a routine ran, for the review inbox in Settings. */
export interface RoutineRun {
  routineId: string
  name: string
  sessionId: string
  at: string
  /** The worktree's branch, when it ran in one. */
  branch?: string
}

const MAX_RUNS = 50

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_ROUTINES = 50

export class RoutineError extends Error {}

/** A routine as given, checked: anything wrong is refused with a reason in words. */
export function checkRoutine(r: Partial<Routine>): Omit<Routine, "id" | "lastRun"> {
  const name = String(r.name ?? "").trim()
  const folder = String(r.folder ?? "").trim()
  const prompt = String(r.prompt ?? "").trim()
  if (!name || name.length > 60)
    throw new RoutineError("A routine needs a name of up to 60 characters.")
  if (!isFullFolder(folder)) // Mac fork: a Mac's /Users/... too
    throw new RoutineError(`A routine needs a full folder path, such as ${folderExample("shop")}.`)
  if (!prompt || prompt.length > 8000)
    throw new RoutineError("A routine needs a prompt of up to 8,000 characters.")
  const kind = (r.trigger as { kind?: unknown } | undefined)?.kind
  if (r.trigger !== undefined && kind !== "commit" && kind !== "files")
    throw new RoutineError("A routine starts on a schedule, a new commit, or files changing.")
  if (kind === "commit" || kind === "files")
    return {
      name,
      folder,
      prompt,
      time: TIME.test(String(r.time ?? "")) ? String(r.time) : "00:00",
      days: [],
      ...(r.extreme ? { extreme: true } : {}),
      ...(r.worktree === true ? { worktree: true } : {}),
      ...(r.phone === true ? { phone: true } : {}),
      enabled: r.enabled !== false,
      trigger: { kind },
    }
  if (!TIME.test(String(r.time ?? "")))
    throw new RoutineError("A routine needs a time, such as 07:30.")
  const days = [
    ...new Set((r.days ?? []).filter((d): d is Day => (DAYS as readonly string[]).includes(d))),
  ]
  if (!days.length) throw new RoutineError("A routine needs at least one day.")
  return {
    name,
    folder,
    prompt,
    time: String(r.time),
    days,
    ...(r.extreme ? { extreme: true } : {}),
    ...(r.worktree === true ? { worktree: true } : {}),
    ...(r.phone === true ? { phone: true } : {}),
    enabled: r.enabled !== false,
  }
}

/** How a routine's session starts: in its folder, in Manual mode, with Extreme approval and a new worktree if set. */
export function routineSessionOptions(r: Routine): {
  cwd: string
  mode: "default"
  extreme?: true
  worktree?: Record<string, never>
} {
  return {
    cwd: r.folder,
    mode: "default",
    ...(r.extreme ? { extreme: true as const } : {}),
    // G23: a run in a worktree of its own never touches your checkout.
    ...(r.worktree ? { worktree: {} } : {}),
  }
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** Whether a routine is due now: on one of its days, at or after its time today, and not run today. */
export function isDue(r: Routine, now: Date): boolean {
  if (!r.enabled || r.trigger) return false
  if (!r.days.includes(DAYS[now.getDay()]!)) return false
  if (r.lastRun === localDay(now)) return false
  // Within the hour after its time: a laptop asleep at 07:30 and woken at 07:40 still runs it, one woken at noon does not.
  const [h, m] = r.time.split(":").map(Number) as [number, number]
  const minutes = now.getHours() * 60 + now.getMinutes() - (h * 60 + m)
  return minutes >= 0 && minutes < 60
}

export class RoutineStore {
  readonly #file: string
  #all: Routine[] = []
  #runs: RoutineRun[] = []
  #extra: Record<string, unknown> = {}

  constructor(file: string) {
    this.#file = file
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      const { routines, triggered, runs, ...rest } = raw
      this.#extra = rest
      for (const x of (Array.isArray(runs) ? runs : []) as Array<Partial<RoutineRun>>)
        if (
          typeof x.routineId === "string" &&
          typeof x.sessionId === "string" &&
          typeof x.at === "string"
        )
          this.#runs.push({
            routineId: x.routineId,
            name: typeof x.name === "string" ? x.name : "",
            sessionId: x.sessionId,
            at: x.at,
            ...(typeof x.branch === "string" ? { branch: x.branch } : {}),
          })
      for (const list of [routines, triggered])
        for (const x of (Array.isArray(list) ? list : []) as Array<Partial<Routine>>) {
          try {
            const ok = checkRoutine(x)
            if (typeof x.id === "string")
              this.#all.push({
                id: x.id,
                ...ok,
                ...(typeof x.lastRun === "string" ? { lastRun: x.lastRun } : {}),
              })
          } catch {
            // one a newer version wrote, or a broken one: left out, not lost on the next save
          }
        }
    } catch {
      // none yet
    }
  }

  list(): Routine[] {
    return this.#all.map((r) => ({ ...r }))
  }

  async #save(): Promise<void> {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true })
    await writeFileAtomic(
      this.#file,
      JSON.stringify(
        {
          ...this.#extra,
          version: 1,
          routines: this.#all.filter((r) => !r.trigger),
          triggered: this.#all.filter((r) => r.trigger),
          runs: this.#runs,
        },
        null,
        2,
      ) + "\n",
    )
  }

  async put(r: Partial<Routine>): Promise<Routine> {
    const ok = checkRoutine(r)
    const at = this.#all.findIndex((x) => x.id === r.id)
    if (at < 0 && this.#all.length >= MAX_ROUTINES)
      throw new RoutineError(`Up to ${MAX_ROUTINES} routines.`)
    const next: Routine = {
      id: at >= 0 ? this.#all[at]!.id : crypto.randomUUID(),
      ...ok,
      ...(at >= 0 && this.#all[at]!.lastRun ? { lastRun: this.#all[at]!.lastRun } : {}),
    }
    if (at >= 0) this.#all[at] = next
    else this.#all.push(next)
    await this.#save()
    return next
  }

  async remove(id: string): Promise<boolean> {
    const before = this.#all.length
    this.#all = this.#all.filter((r) => r.id !== id)
    if (this.#all.length === before) return false
    await this.#save()
    return true
  }

  /** G23: the runs, newest first, for the review inbox. */
  runs(): RoutineRun[] {
    return [...this.#runs].reverse()
  }

  /** G23: notes a run's session, keeping the latest MAX_RUNS. */
  async noteRun(run: RoutineRun): Promise<void> {
    this.#runs = [...this.#runs, run].slice(-MAX_RUNS)
    await this.#save()
  }

  async ran(id: string, now: Date): Promise<void> {
    const r = this.#all.find((x) => x.id === id)
    if (!r) return
    r.lastRun = localDay(now)
    await this.#save()
  }
}

/** Looks every 30 seconds and starts what is due. Never starts one twice on a day, whatever happens to the start. */
export interface RoutineSchedulerDeps {
  store: RoutineStore
  /** Starts the routine's session and sends its prompt; throws when it cannot start. */
  start: (r: Routine) => Promise<unknown>
  log: (line: string) => void
  now?: () => Date
}

export class RoutineScheduler {
  readonly #d: RoutineSchedulerDeps
  #timer: NodeJS.Timeout | undefined
  #busy = false

  constructor(d: RoutineSchedulerDeps) {
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
  }

  async check(): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    try {
      const now = (this.#d.now ?? (() => new Date()))()
      for (const r of this.#d.store.list().filter((x) => isDue(x, now))) {
        // Marked first: a start that fails (the kill switch, signed out) is not tried again and again.
        await this.#d.store.ran(r.id, now)
        try {
          await this.#d.start(r)
        } catch (e) {
          this.#d.log(`routine ${r.name} did not start: ${(e as Error).message}`)
        }
      }
    } finally {
      this.#busy = false
    }
  }
}
