import { randomUUID } from "node:crypto"
import { DAYS, type Day } from "./routines.js"

/**
 * T-122 (t3code review, O31): a session drafts a routine, and you save it. A session never makes, changes or starts a
 * routine (the routine-trigger rule, threat T58): its draft waits under Settings, Routines, where you read it and
 * save it through the same form as your own, or dismiss it. Drafts live while Codehouse runs, at most 20.
 */
export interface RoutineDraft {
  id: string
  /** The session that drafted it, and its folder, where the routine would run. */
  sessionId: string
  folder: string
  name: string
  prompt: string
  time: string
  days: Day[]
  at: string
}

const MAX = 20

export class RoutineDrafts {
  #list: RoutineDraft[] = []

  add(d: { sessionId: string; folder: string; name: string; prompt: string; time?: string; days?: string[] }): RoutineDraft {
    const name = d.name.replace(/\s+/g, " ").trim().slice(0, 80)
    const prompt = d.prompt.trim().slice(0, 8000)
    if (!name || !prompt) throw new Error("A routine needs a name and a prompt.")
    const time = d.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.time) ? d.time : "08:00"
    const days = (d.days ?? []).filter((x): x is Day => (DAYS as readonly string[]).includes(x))
    const draft: RoutineDraft = {
      id: randomUUID(),
      sessionId: d.sessionId,
      folder: d.folder,
      name,
      prompt,
      time,
      days: days.length ? [...new Set(days)] : ["mon", "tue", "wed", "thu", "fri"],
      at: new Date().toISOString(),
    }
    this.#list = [draft, ...this.#list].slice(0, MAX)
    return draft
  }

  list(): RoutineDraft[] {
    return [...this.#list]
  }

  remove(id: string): boolean {
    const n = this.#list.length
    this.#list = this.#list.filter((d) => d.id !== id)
    return this.#list.length < n
  }
}
