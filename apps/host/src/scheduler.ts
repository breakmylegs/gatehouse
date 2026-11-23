/**
 * E-049, a resource-aware scheduler (Expansion E4). Codehouse's own heavy jobs (claim checks, held-out checks, mutation
 * runs, profiles, bisects and the other actions it runs itself) wait in a priority queue until memory and CPU allow,
 * and each waiting job says why. Like the memory governor (C-004), it holds nothing unless the governor is switched on
 * in Settings (owner, 16 Nov: hardware should not stop work by default); then a job waits while the commit charge is at
 * or over the governor's point, or the CPU is at or over 90% busy.
 *
 * It never delays approvals, the kill switch or Stop: approvals and Stop do not pass through it, the kill switch
 * cancels every waiting job at once, and Stop cancels the waiting jobs of its session.
 */
import os from "node:os"

export type JobKind = "session" | "routine" | "job"

export interface Waiting {
  id: number
  label: string
  kind: JobKind
  priority: number
  sessionId?: string
  since: string
  reason: string
}

export interface SchedulerDeps {
  /** The commit charge (percent) and how busy the CPU is (percent), when they can be read. */
  probe: () => Promise<{ memory?: number; cpu?: number }>
  /** The limits; undefined when the scheduler holds nothing (the memory governor is off). */
  limits: () => { memory: number; cpu: number } | undefined
  killed: () => boolean
  pollMs?: number
}

interface Item extends Waiting {
  start: () => void
  cancel: (why: string) => void
}

export class SchedulerCancelled extends Error {}

export class Scheduler {
  readonly #d: SchedulerDeps
  readonly #queue: Item[] = []
  #next = 1
  #timer: NodeJS.Timeout | undefined

  constructor(d: SchedulerDeps) {
    this.#d = d
  }

  /** Runs a job now when resources allow, or when they next do; higher priority first, then in order. */
  run<T>(o: { label: string; kind?: JobKind; priority?: number; sessionId?: string }, job: () => Promise<T>): Promise<T> {
    // With no limits (the memory governor off) the first look starts it at once, reading nothing.
    return new Promise<T>((resolve, reject) => {
      const item: Item = {
        id: this.#next++,
        label: o.label,
        kind: o.kind ?? "job",
        priority: o.priority ?? 5,
        ...(o.sessionId ? { sessionId: o.sessionId } : {}),
        since: new Date().toISOString(),
        reason: "waiting for its turn",
        start: () => void job().then(resolve, reject),
        cancel: (why) => reject(new SchedulerCancelled(why)),
      }
      this.#queue.push(item)
      this.#queue.sort((a, b) => b.priority - a.priority || a.id - b.id)
      void this.#tick()
    })
  }

  /** What is waiting, and why. */
  waiting(): Waiting[] {
    return this.#queue.map(({ start: _s, cancel: _c, ...w }) => w)
  }

  /** Stop: the waiting jobs of a session are cancelled. */
  cancelSession(sessionId: string, why = "the session was stopped"): number {
    return this.#cancel((i) => i.sessionId === sessionId, why)
  }

  /** The kill switch: every waiting job is cancelled. */
  cancelAll(why = "the kill switch is engaged"): number {
    return this.#cancel(() => true, why)
  }

  #cancel(which: (i: Item) => boolean, why: string): number {
    const gone = this.#queue.filter(which)
    for (const i of gone) {
      this.#queue.splice(this.#queue.indexOf(i), 1)
      i.cancel(why)
    }
    return gone.length
  }

  async #tick(): Promise<void> {
    if (this.#d.killed()) {
      this.cancelAll()
      return
    }
    const head = this.#queue[0]
    if (!head) return
    const limits = this.#d.limits()
    const p = limits ? await this.#d.probe().catch(() => ({}) as { memory?: number; cpu?: number }) : {}
    const memFull = limits && p.memory !== undefined && p.memory >= limits.memory
    const cpuFull = limits && p.cpu !== undefined && p.cpu >= limits.cpu
    if (!memFull && !cpuFull) {
      // One at a time, so the next reading sees what this one uses.
      this.#queue.shift()
      head.start()
    } else {
      const reason = memFull ? `waiting for memory: ${p.memory}% committed, ${limits!.memory}% is the point` : `waiting for the CPU: ${p.cpu}% busy`
      for (const i of this.#queue) i.reason = reason
    }
    clearTimeout(this.#timer)
    if (this.#queue.length) {
      this.#timer = setTimeout(() => void this.#tick(), this.#d.pollMs ?? 2000)
      this.#timer.unref()
    }
  }

  stop(): void {
    clearTimeout(this.#timer)
  }
}

/** How busy the CPU has been since the last call, as a percentage (os.loadavg says nothing on Windows). */
export function cpuSampler(): () => number {
  const take = () => os.cpus().reduce((t, c) => ({ idle: t.idle + c.times.idle, all: t.all + c.times.idle + c.times.user + c.times.sys + c.times.irq + c.times.nice }), { idle: 0, all: 0 })
  let last = take()
  return () => {
    const now = take()
    const all = now.all - last.all
    const idle = now.idle - last.idle
    last = now
    return all > 0 ? Math.round((100 * (all - idle)) / all) : 0
  }
}
