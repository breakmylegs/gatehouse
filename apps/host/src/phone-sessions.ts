/**
 * Sessions on the phone, first part (backlog G32 and O18, owner's decision of 30 Oct): the open sessions as the phone
 * may see them, and the latest of what was said in each. Read only: nothing here lets the phone change anything. The
 * snapshot is redacted here (invariant 12) and sealed to each phone's own key by the relay service (invariant 9), so
 * the Relay holds ciphertext only. It is shared a moment after a session changes (at most every 15 seconds) and once a
 * minute, so a Relay that restarted, which keeps it only in memory, has it again soon.
 */
import type { SessionInfo } from "@gatehouse/shared"
import type { PhoneSessions } from "@gatehouse/shared/phone-protocol"
import { latestSaid } from "./about-session.js"

type Message = { type: string; message: unknown }

/** The most sessions shown, and the most of each one's conversation. */
export const MAX_PHONE_SESSIONS = 12
export const PHONE_EXCERPT_CHARS = 1500

export interface PhoneSessionsDeps {
  list: () => SessionInfo[]
  messages: (sdkSessionId: string, cwd: string) => Promise<Message[]>
  redact: (text: string) => string
  /** G32: the routines you allowed to be started from the phone, by name. */
  templates?: () => Array<{ id: string; name: string }>
  now?: () => Date
}

/** The snapshot: open sessions, newest first, each redacted, with a short excerpt of what was said. */
export async function buildPhoneSessions(d: PhoneSessionsDeps): Promise<PhoneSessions> {
  const open = d
    .list()
    .filter((s) => s.state !== "ended" && !s.archived && !s.evaluation)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_PHONE_SESSIONS)
  const sessions = await Promise.all(
    open.map(async (s) => {
      const said = s.sdkSessionId
        ? latestSaid(await d.messages(s.sdkSessionId, s.cwd).catch(() => []), PHONE_EXCERPT_CHARS)
        : ""
      return {
        id: s.id,
        project: d.redact(s.project),
        ...(s.title ? { title: d.redact(s.title) } : {}),
        state: s.paused ? "paused" : s.state,
        waiting: s.pendingApprovals,
        latest: d.redact(said),
      }
    }),
  )
  const templates = (d.templates?.() ?? []).map((t) => ({ id: t.id, name: d.redact(t.name) }))
  return {
    at: (d.now ?? (() => new Date()))().toISOString(),
    sessions,
    ...(templates.length ? { templates } : {}),
  }
}

/**
 * Shares the snapshot when told something changed, never more than once in MIN_GAP_MS, and every EVERY_MS anyway.
 * A failure is logged and tried again next time; it never touches a session.
 */
export class PhoneSessionsSharer {
  readonly #build: () => Promise<PhoneSessions>
  readonly #share: (s: PhoneSessions) => Promise<void>
  readonly #log: (line: string) => void
  readonly #minGapMs: number
  readonly #wanted: () => boolean
  #last = 0
  #timer: NodeJS.Timeout | undefined
  #beat: NodeJS.Timeout | undefined
  #busy = false

  constructor(o: {
    build: () => Promise<PhoneSessions>
    share: (s: PhoneSessions) => Promise<void>
    log: (line: string) => void
    minGapMs?: number
    /** Whether any phone is paired: without one nothing is read or sent. */
    wanted?: () => boolean
  }) {
    this.#build = o.build
    this.#share = o.share
    this.#log = o.log
    this.#minGapMs = o.minGapMs ?? 15_000
    this.#wanted = o.wanted ?? (() => true)
  }

  /** Something changed: share soon. */
  poke(): void {
    if (this.#timer) return
    const wait = Math.max(0, this.#last + this.#minGapMs - Date.now())
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.shareNow()
    }, wait)
    this.#timer.unref?.()
  }

  async shareNow(): Promise<void> {
    if (this.#busy || !this.#wanted()) return
    this.#busy = true
    this.#last = Date.now()
    try {
      await this.#share(await this.#build())
    } catch (e) {
      this.#log(`sessions not shared with the phone: ${(e as Error).message}`)
    } finally {
      this.#busy = false
    }
  }

  start(everyMs = 60_000): void {
    if (this.#beat) return
    this.#beat = setInterval(() => void this.shareNow(), everyMs)
    this.#beat.unref?.()
  }

  stop(): void {
    clearInterval(this.#beat)
    clearTimeout(this.#timer)
    this.#beat = undefined
    this.#timer = undefined
  }
}
