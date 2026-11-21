/**
 * D-087, the interruption budget (Frontier build, Wave 4). With a batch time set in Settings, the phone's non-urgent
 * notices (a turn finished, the daily digest, a note from Claude) are kept and sent as one summary every so many
 * minutes. Approvals never come through here: the broker delivers each to the phone at once, as before. Neither do
 * errors and warnings (stuck, repeating itself, paused, a spent risk budget, drift from the goal), which are sent at
 * once by their own lines. With no batch time each notice goes at once, as before.
 */
export interface Notice {
  /** How the phone shows it when it goes on its own; a summary is a note. */
  kind?: "stop" | "notify" | "info"
  title: string
  body: string
  project: string
}

export class NoticeBatcher {
  #held: Notice[] = []
  #since: number
  #timer: NodeJS.Timeout | undefined

  constructor(
    private readonly o: {
      /** Minutes between summaries; undefined or 0 sends each at once. */
      minutes: () => number | undefined
      /** Sends one notice, or the summary of several. */
      send: (n: Notice) => Promise<void>
      now?: () => number
    },
  ) {
    this.#since = this.#now()
  }

  #now(): number {
    return (this.o.now ?? Date.now)()
  }

  /** A non-urgent notice: at once with no batch time, otherwise kept for the next summary. */
  add(n: Notice): void {
    const minutes = this.o.minutes()
    if (!minutes) {
      void this.o.send(n).catch(() => undefined)
      return
    }
    if (!this.#held.length) this.#since = this.#now()
    this.#held.push(n)
  }

  held(): number {
    return this.#held.length
  }

  /** Sends the summary when its time has come (or now, when asked), and starts the next. */
  async flush(force = false): Promise<void> {
    if (!this.#held.length) return
    const minutes = this.o.minutes()
    if (!force && minutes && this.#now() - this.#since < minutes * 60_000) return
    const held = this.#held
    this.#held = []
    this.#since = this.#now()
    if (held.length === 1) return await this.o.send(held[0]!).catch(() => undefined)
    const projects = [...new Set(held.map((n) => n.project))]
    const body = held
      .slice(0, 20)
      .map((n) => `${n.project}: ${n.title}${n.body ? `, ${n.body.replace(/\s+/g, " ").slice(0, 160)}` : ""}`)
      .join("\n")
    await this.o
      .send({ title: `${held.length} updates`, body: held.length > 20 ? `${body}\nand ${held.length - 20} more` : body, project: projects.length === 1 ? projects[0]! : "Codehouse" })
      .catch(() => undefined)
  }

  /** Looks every minute; what is held when the batch time is turned off goes at once. */
  start(): void {
    this.#timer = setInterval(() => void this.flush(!this.o.minutes()).catch(() => undefined), 60_000)
    this.#timer.unref?.()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
  }
}
