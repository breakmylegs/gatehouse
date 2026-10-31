import fs from "node:fs"
import { writeFileAtomic } from "@gatehouse/shared/node"

/** What you set on a session: kept by its Claude Code session id, so it holds across restarts and resumes. */
export interface SessionMeta {
  title?: string
  pinned?: boolean
  archived?: boolean
}

/** What a session last ran with, so Resume starts it the same way (owner, 31 Oct). */
export interface SessionSettings {
  model?: string
  effort?: string
  mode?: "default" | "plan" | "acceptEdits" | "auto"
  extreme?: boolean
  resources?: "low" | "medium" | "high"
}

const MODES = ["default", "plan", "acceptEdits", "auto"] as const
const LEVELS = ["low", "medium", "high"] as const
const EFFORT = /^[a-z]{2,10}$/

export const MAX_TITLE = 120
const MAX_ENTRIES = 2000

/**
 * Titles, pins and archives for sessions, in %LOCALAPPDATA%\Gatehouse\sessions.json. Read tolerantly (an entry it
 * does not understand is kept as it is, because an older or newer JCVC may read the same file), written whole and
 * atomically. A broken file starts empty rather than stopping JCVC.
 */
export class SessionMetaStore {
  readonly #file: string
  #all: Record<string, Record<string, unknown>> = {}
  #write: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.#file = file
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
      const sessions = (raw as { sessions?: unknown } | null)?.sessions
      if (sessions && typeof sessions === "object" && !Array.isArray(sessions))
        this.#all = sessions as Record<string, Record<string, unknown>>
    } catch {
      // none yet, or unreadable: start empty
    }
  }

  get(id: string | undefined): SessionMeta {
    const e = id ? this.#all[id] : undefined
    if (!e) return {}
    return {
      ...(typeof e.title === "string" && e.title ? { title: e.title } : {}),
      ...(e.pinned === true ? { pinned: true } : {}),
      ...(e.archived === true ? { archived: true } : {}),
    }
  }

  /** The settings a session last ran with. Only modes JCVC allows come back (invariant 3); the rest is checked again at start. */
  settings(id: string | undefined): SessionSettings {
    const raw = id ? this.#all[id]?.settings : undefined
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
    const o = raw as Record<string, unknown>
    return {
      ...(typeof o.model === "string" && o.model.length <= 100 ? { model: o.model } : {}),
      ...(typeof o.effort === "string" && EFFORT.test(o.effort) ? { effort: o.effort } : {}),
      ...((MODES as readonly unknown[]).includes(o.mode)
        ? { mode: o.mode as SessionSettings["mode"] }
        : {}),
      ...(typeof o.extreme === "boolean" ? { extreme: o.extreme } : {}),
      ...((LEVELS as readonly unknown[]).includes(o.resources)
        ? { resources: o.resources as SessionSettings["resources"] }
        : {}),
    }
  }

  /** Keeps what a session runs with, written only when it changed. */
  keepSettings(id: string, s: SessionSettings): void {
    const e = this.#all[id] ?? {}
    // Anything a newer version keeps beside them stays.
    const next = { ...(typeof e.settings === "object" && e.settings ? e.settings : {}), ...s }
    if (JSON.stringify(e.settings) === JSON.stringify(next)) return
    this.#all[id] = { ...e, settings: next, changedAt: new Date().toISOString() }
    this.#trim()
    const snapshot = JSON.stringify({ version: 1, sessions: this.#all }, null, 2) + "\n"
    this.#write = this.#write.then(() => writeFileAtomic(this.#file, snapshot)).catch(() => undefined)
  }

  /** Changes some of a session's settings. A null title removes it. Resolves once it is on disk. */
  async set(
    id: string,
    change: { title?: string | null; pinned?: boolean; archived?: boolean },
  ): Promise<SessionMeta> {
    const e = { ...(this.#all[id] ?? {}) }
    if (change.title !== undefined) {
      const t = change.title?.trim().slice(0, MAX_TITLE)
      if (t) e.title = t
      else delete e.title
    }
    for (const k of ["pinned", "archived"] as const)
      if (change[k] !== undefined) {
        if (change[k]) e[k] = true
        else delete e[k]
      }
    if (Object.keys(e).length) this.#all[id] = { ...e, changedAt: new Date().toISOString() }
    else delete this.#all[id]
    this.#trim()
    const snapshot = JSON.stringify({ version: 1, sessions: this.#all }, null, 2) + "\n"
    this.#write = this.#write.then(() => writeFileAtomic(this.#file, snapshot))
    await this.#write
    return this.get(id)
  }

  /** The oldest changes go first once there are too many, so the file never grows without end. */
  #trim(): void {
    const ids = Object.keys(this.#all)
    if (ids.length <= MAX_ENTRIES) return
    const by = (id: string) => String(this.#all[id]?.changedAt ?? "")
    for (const id of ids
      .sort((a, b) => by(a).localeCompare(by(b)))
      .slice(0, ids.length - MAX_ENTRIES))
      delete this.#all[id]
  }
}
