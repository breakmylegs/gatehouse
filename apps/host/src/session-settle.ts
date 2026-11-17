/**
 * T-024 (t3code review): a session that has ended and not been touched for a while settles out of the sidebar by
 * itself: it is archived, as Archive does, so Earlier sessions (Show archived) still has it and Unarchive brings it back.
 * After three days unless Settings, Sessions, Settle finished sessions says otherwise (0 for never). A pinned session
 * never settles: pin one to keep it. Looked at every hour by the Host, so it happens whether or not the window is open.
 */
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"

export const DEFAULT_SETTLE_DAYS = 3
const DAY = 86_400_000
const LOOK_EVERY_MS = 60 * 60_000

type Settleable = Pick<SessionInfo, "id" | "state" | "createdAt" | "activeAt" | "pinned" | "archived" | "sdkSessionId" | "cwd">

/** The sessions due to settle now: ended, quiet for long enough, not pinned, not archived, and known to Claude Code. */
export function settleDue(list: readonly Settleable[], now: number, days: number): Settleable[] {
  if (!(days > 0)) return []
  return list.filter((s) => {
    if ((s.state !== "ended" && s.state !== "error") || s.pinned || s.archived || !s.sdkSessionId) return false
    const last = Date.parse(s.activeAt ?? s.createdAt)
    return Number.isFinite(last) && now - last >= days * DAY
  })
}

export interface SettlerDeps {
  list: () => readonly Settleable[]
  archive: (s: Settleable) => Promise<void>
  /** Settings: the days, 0 for never; absent for the default. */
  days: () => number | undefined
  log: (line: string) => void
  now?: () => number
}

export class SessionSettler {
  readonly #d: SettlerDeps
  #timer: NodeJS.Timeout | undefined

  constructor(d: SettlerDeps) {
    this.#d = d
  }

  async tick(): Promise<number> {
    const due = settleDue(this.#d.list(), (this.#d.now ?? Date.now)(), this.#d.days() ?? DEFAULT_SETTLE_DAYS)
    let n = 0
    for (const s of due) {
      try {
        await this.#d.archive(s)
        n++
      } catch (e) {
        this.#d.log(`settle: ${s.id} could not be archived: ${(e as Error).message}`)
      }
    }
    if (n) this.#d.log(`settle: archived ${n} finished session(s)`)
    return n
  }

  start(): void {
    if (this.#timer) return
    void this.tick()
    this.#timer = setInterval(() => void this.tick(), LOOK_EVERY_MS)
    this.#timer.unref?.()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }
}
