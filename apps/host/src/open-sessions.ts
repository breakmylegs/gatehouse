import fs from "node:fs"
import { Effort, type SessionInfo } from "@gatehouse/shared/ws-protocol"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { StartSessionOptions } from "./sessions.js"

/** A session that was open, kept so JCVC brings it back after a restart or an update (owner, 30 Oct). */
export interface OpenSession {
  id: string
  cwd: string
  kind?: "chat"
  /** The Claude Code conversation to resume. Absent for a session nothing was said in yet. */
  sdkSessionId?: string
  mode: "default" | "plan" | "acceptEdits" | "auto"
  model?: string
  effort?: Effort
  extreme: boolean
  /** A turn was running, or waiting on you, when this was last written. */
  running: boolean
  createdAt: string
}

const MODES = new Set(["default", "plan", "acceptEdits", "auto"])
const ID = /^[0-9a-f-]{36}$/
const WRITE_AFTER_MS = 250

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)

/** An entry as JCVC can use it, or undefined. Anything it does not know stays in the file for whoever wrote it. */
function read(e: Record<string, unknown>): OpenSession | undefined {
  const id = str(e.id)
  const cwd = str(e.cwd)
  if (!id || !ID.test(id) || !cwd) return undefined
  const sdk = str(e.sdkSessionId)
  const model = str(e.model)
  const effort = Effort.safeParse(e.effort).success ? (e.effort as Effort) : undefined
  return {
    id,
    cwd,
    ...(e.kind === "chat" ? { kind: "chat" as const } : {}),
    ...(sdk ? { sdkSessionId: sdk } : {}),
    // Invariant 3: only the allowed modes come back; anything else starts in Manual.
    mode: MODES.has(String(e.mode)) ? (e.mode as OpenSession["mode"]) : "default",
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    extreme: e.extreme === true,
    running: e.running === true,
    createdAt: str(e.createdAt) ?? new Date(0).toISOString(),
  }
}

/**
 * The sessions open now, in %LOCALAPPDATA%\Gatehouse\open-sessions.json. Written a moment after each change, so
 * even a crash or a forced close leaves it current. When JCVC closes it stops writing first, so the sessions it
 * then closes come back next time. A session you close, or one that fails, leaves the list.
 */
export class OpenSessionsStore {
  readonly #file: string
  readonly #entries = new Map<string, Record<string, unknown>>()
  #frozen = false
  #timer: NodeJS.Timeout | undefined
  #write: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.#file = file
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
      const list = (raw as { sessions?: unknown } | null)?.sessions
      if (Array.isArray(list))
        for (const e of list)
          if (e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string")
            this.#entries.set((e as { id: string }).id, e as Record<string, unknown>)
    } catch {
      // none yet, or unreadable: nothing to bring back
    }
  }

  /** The sessions to bring back, oldest first, so they return in the order they were opened. */
  list(): OpenSession[] {
    return [...this.#entries.values()]
      .map(read)
      .filter((e): e is OpenSession => e !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** A session's latest state, from the manager's session events. */
  note(info: SessionInfo): void {
    if (this.#frozen) return
    if (info.state === "ended" || info.state === "error") this.#entries.delete(info.id)
    else
      this.#entries.set(info.id, {
        ...this.#entries.get(info.id),
        id: info.id,
        cwd: info.cwd,
        ...(info.kind === "chat" ? { kind: "chat" } : {}),
        ...(info.sdkSessionId ? { sdkSessionId: info.sdkSessionId } : {}),
        mode: info.mode,
        ...(info.model ? { model: info.model } : {}),
        ...(info.effort ? { effort: info.effort } : {}),
        extreme: info.extreme === true,
        running: info.state === "running" || info.state === "waiting",
        createdAt: info.createdAt,
      })
    this.#later()
  }

  /** One that could not be brought back: it is not tried again. */
  forget(id: string): void {
    if (this.#frozen) return
    this.#entries.delete(id)
    this.#later()
  }

  /** JCVC is closing: from here on nothing changes, and what is on disk is what comes back. */
  async freeze(): Promise<void> {
    if (this.#frozen) return
    clearTimeout(this.#timer)
    this.#timer = undefined
    await this.#flush()
    this.#frozen = true
  }

  /** Writes what is pending now. */
  async flush(): Promise<void> {
    clearTimeout(this.#timer)
    this.#timer = undefined
    await this.#flush()
  }

  #later(): void {
    if (this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#flush()
    }, WRITE_AFTER_MS)
  }

  #flush(): Promise<void> {
    const text =
      JSON.stringify({ version: 1, sessions: [...this.#entries.values()] }, null, 2) + "\n"
    this.#write = this.#write.then(() => writeFileAtomic(this.#file, text)).catch(() => undefined)
    return this.#write
  }
}

export interface RestoreDeps {
  start: (o: StartSessionOptions) => Promise<unknown>
  killed: () => boolean
  /** Records that a session came back, and with what settings (invariant 13). */
  audit: (o: OpenSession) => Promise<unknown>
  log: (line: string) => void
}

/**
 * Brings back the sessions that were open when JCVC last closed, each with its id, conversation and settings. One
 * at a time, so the Claude Code processes start gently. One that cannot come back is dropped from the list; it is
 * still under Earlier sessions. With the kill switch engaged nothing starts, and the list waits for next time.
 */
export async function restoreOpenSessions(
  store: OpenSessionsStore,
  d: RestoreDeps,
): Promise<number> {
  const list = store.list()
  if (list.length === 0) return 0
  if (d.killed()) {
    d.log(`kill switch engaged: ${list.length} open session(s) wait until it is re-armed`)
    return 0
  }
  let n = 0
  for (const o of list) {
    try {
      await d.start({
        cwd: o.cwd,
        ...(o.kind ? { kind: o.kind } : {}),
        mode: o.mode,
        ...(o.model ? { model: o.model } : {}),
        ...(o.effort ? { effort: o.effort } : {}),
        extreme: o.extreme,
        ...(o.sdkSessionId ? { resume: o.sdkSessionId } : {}),
        restore: { id: o.id, createdAt: o.createdAt, wasRunning: o.running },
      })
      n++
      await d.audit(o).catch(() => undefined)
    } catch (e) {
      d.log(`session ${o.id} was not brought back: ${(e as Error).message}`)
      store.forget(o.id)
    }
  }
  return n
}
