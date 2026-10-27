import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "@gatehouse/shared/node"
import { localDay } from "./usage.js"

/**
 * Sends the daily digest once a day, after the chosen time. If the computer was asleep at that time it goes
 * out at the next check, and never twice for the same day. A failure to send is retried at the next check.
 */
export class DigestScheduler {
  #timer: NodeJS.Timeout | undefined
  #running = false

  constructor(
    private readonly deps: {
      /** "HH:MM" local time, or nothing for off. Read at each check, so a saved setting applies without a restart. */
      time: () => string | null | undefined
      send: () => Promise<boolean>
      stateFile: string
      now?: () => Date
      log?: (line: string) => void
    },
  ) {}

  #last(): string | undefined {
    try {
      return (JSON.parse(fs.readFileSync(this.deps.stateFile, "utf8")) as { last?: string }).last
    } catch {
      return undefined
    }
  }

  /** Returns true if a digest was sent now. */
  async check(): Promise<boolean> {
    const time = this.deps.time()
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false
    const now = (this.deps.now ?? (() => new Date()))()
    const today = localDay(now)
    if (this.#last() === today) return false
    const [h, m] = time.split(":").map(Number) as [number, number]
    if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false
    if (this.#running) return false
    this.#running = true
    try {
      const sent = await this.deps.send()
      if (!sent) return false
      fs.mkdirSync(path.dirname(this.deps.stateFile), { recursive: true })
      await writeFileAtomic(this.deps.stateFile, JSON.stringify({ last: today }) + "\n")
      return true
    } catch (e) {
      this.deps.log?.(`digest not sent (${(e as Error).message})`)
      return false
    } finally {
      this.#running = false
    }
  }

  start(everyMs = 60_000): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.check(), everyMs)
    this.#timer.unref?.()
    void this.check()
  }

  stop(): void {
    clearInterval(this.#timer)
    this.#timer = undefined
  }
}
