/**
 * Sessions on the phone (backlog G32 and O18, owner's decision of 30 Oct): the open sessions as the phone may see
 * them, what each is doing now and the latest of its conversation. Read only: nothing here lets the phone change
 * anything. The snapshot is redacted here (invariant 12) and sealed to each phone's own key by the relay service
 * (invariant 9), so the Relay holds ciphertext only. It is shared a moment after a session changes and once a minute,
 * so a Relay that restarted, which keeps it only in memory, has it again soon.
 *
 * Owner, 11 Nov ("a way to actually see the sessions remotely and send prompts and see the ongoing status"): each
 * session's conversation is kept here from its live stream, seeded once from its transcript, so the phone can be told
 * every few seconds without reading transcripts again each time.
 */
import type { SessionInfo } from "@gatehouse/shared"
import { nextActivity, targetOf, toolWords, type Activity } from "@gatehouse/shared/activity"
import type { PhoneActivity, PhoneEntry, PhoneSessions } from "@gatehouse/shared/phone-protocol"
import { latestSaid } from "./about-session.js"
import { messageText } from "./history.js"

type Message = { type: string; message: unknown }

/** The most sessions shown, and the most of the old one-line excerpt (kept for phone apps from before 11 Nov). */
export const MAX_PHONE_SESSIONS = 12
export const PHONE_EXCERPT_CHARS = 600
/** The most steps kept for each session, and the most characters of one step. */
export const PHONE_TAIL = 200
export const PHONE_ENTRY_CHARS = 1200
/** The conversation sent for a session you may be watching (working, waiting on you, or among the newest three). */
export const PHONE_RECENT_CHARS = 8000
/** And for the others. */
export const PHONE_RECENT_QUIET_CHARS = 1200
/** The whole snapshot stays under this, so sealed it fits the Relay's 64 KB body limit, a Relay from before too. */
export const PHONE_SNAPSHOT_BYTES = 44_000

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const cut = (t: string) => (t.length > PHONE_ENTRY_CHARS ? `${t.slice(0, PHONE_ENTRY_CHARS - 1)}…` : t)

/** The steps in one message: what you said, what Claude said, and each tool it used with its target. */
export function entriesOf(m: Message): PhoneEntry[] {
  if (m.type === "user") {
    const text = messageText(m).trim()
    return text ? [{ who: "you", text: cut(text) }] : []
  }
  if (m.type !== "assistant") return []
  const content = obj(m.message).content
  if (!Array.isArray(content)) return []
  const out: PhoneEntry[] = []
  for (const c of content) {
    const b = obj(c)
    if (b.type === "text" && typeof b.text === "string" && b.text.trim())
      out.push({ who: "claude", text: cut(b.text.trim()) })
    else if (b.type === "tool_use") {
      const target = targetOf(obj(b.input))
      const name = String(b.name ?? "a tool")
      // Bash: npm test, Edit: src\app.ts; a server's tool by its own name.
      out.push({ who: "tool", text: `${name.startsWith("mcp__") ? toolWords(name) : name}${target ? `: ${target}` : ""}` })
    }
  }
  return out
}

type Kept = PhoneEntry & { uuid?: string; prompted?: true }

/**
 * Each session's latest steps and what it is doing now, from its stream. Only the steps are kept, never tool results
 * or tool input, so a long session costs little memory.
 */
export class PhoneLive {
  readonly #tails = new Map<string, Kept[]>()
  readonly #seeded = new Set<string>()
  readonly #activity = new Map<string, Activity>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /** One message from a session's stream. True when what the phone shows changed. */
  message(id: string, msg: unknown): boolean {
    const before = this.#activity.get(id)
    const after = nextActivity(before, msg, this.#now())
    let changed = false
    if (after !== before) {
      if (after) this.#activity.set(id, after)
      else this.#activity.delete(id)
      changed =
        !after ||
        !before ||
        after.phase !== before.phase ||
        ("tool" in after ? after.tool : "") !== ("tool" in before ? before.tool : "") ||
        ("target" in after ? after.target : undefined) !== ("target" in before ? before.target : undefined)
    }
    const m = obj(msg)
    // A subagent's own messages show as the Task call that started it, as on the desktop.
    if (typeof m.parent_tool_use_id === "string") return changed
    if (m.type !== "user" && m.type !== "assistant") return changed
    const steps = entriesOf(m as Message)
    if (!steps.length) return changed
    const tail = this.#tail(id)
    // Your message, already shown when you sent it, coming back from the SDK.
    const last = tail.at(-1)
    if (m.type === "user" && last?.prompted && steps.length === 1 && last.text === steps[0]!.text) tail.pop()
    const uuid = typeof m.uuid === "string" ? m.uuid : undefined
    for (const s of steps) tail.push({ ...s, ...(uuid ? { uuid } : {}) })
    this.#trim(id)
    return true
  }

  /** You sent the session a message: it shows at once, and the session is waiting for Claude to start. */
  prompted(id: string, text: string): void {
    const t = text.trim()
    if (t) this.#tail(id).push({ who: "you", text: cut(t), prompted: true })
    this.#trim(id)
    this.#activity.set(id, { phase: "sent", since: this.#now() })
  }

  isSeeded(id: string): boolean {
    return this.#seeded.has(id)
  }

  /** The session's conversation so far, read once from its transcript; what the stream added since is kept. */
  seed(id: string, messages: Message[]): void {
    if (this.#seeded.has(id)) return
    this.#seeded.add(id)
    const known = new Set<string>()
    const steps: Kept[] = []
    for (const m of messages) {
      const raw = m as unknown as Record<string, unknown>
      const uuid = typeof raw.uuid === "string" ? raw.uuid : undefined
      if (uuid) known.add(uuid)
      if (typeof raw.parent_tool_use_id === "string") continue
      for (const s of entriesOf(m)) steps.push({ ...s, ...(uuid ? { uuid } : {}) })
    }
    const said = new Set(steps.slice(-20).filter((s) => s.who === "you").map((s) => s.text))
    const live = (this.#tails.get(id) ?? []).filter(
      (s) => !(s.uuid && known.has(s.uuid)) && !(s.prompted && said.has(s.text)),
    )
    this.#tails.set(id, [...steps, ...live])
    this.#trim(id)
  }

  entries(id: string): PhoneEntry[] {
    return (this.#tails.get(id) ?? []).map((s) => ({ who: s.who, text: s.text }))
  }

  activity(id: string): Activity | undefined {
    return this.#activity.get(id)
  }

  /** Only these sessions are kept; the rest are read again if they come back. */
  retain(ids: Set<string>): void {
    for (const id of [...this.#tails.keys(), ...this.#seeded, ...this.#activity.keys()])
      if (!ids.has(id)) {
        this.#tails.delete(id)
        this.#seeded.delete(id)
        this.#activity.delete(id)
      }
  }

  #tail(id: string): Kept[] {
    let t = this.#tails.get(id)
    if (!t) this.#tails.set(id, (t = []))
    return t
  }

  #trim(id: string): void {
    const t = this.#tails.get(id)
    if (t && t.length > PHONE_TAIL) t.splice(0, t.length - PHONE_TAIL)
  }
}

export interface PhoneSessionsDeps {
  list: () => SessionInfo[]
  messages: (sdkSessionId: string, cwd: string) => Promise<Message[]>
  redact: (text: string) => string
  /** G32: the routines you allowed to be started from the phone, by name. */
  templates?: () => Array<{ id: string; name: string }>
  /** The conversations and activity kept from the stream; without it each is read from its transcript. */
  live?: PhoneLive
  now?: () => Date
}

/** "You:" and "Claude:" lines, oldest first, at most max characters: the excerpt phone apps from before 11 Nov show. */
function excerptOf(entries: PhoneEntry[], max: number): string {
  return latestSaid(
    entries
      .filter((e) => e.who !== "tool")
      .map((e) =>
        e.who === "you"
          ? { type: "user", message: { content: e.text } }
          : { type: "assistant", message: { content: [{ type: "text", text: e.text }] } },
      ),
    max,
  )
}

/** The latest steps that fit in max characters, oldest first. */
function latestSteps(entries: PhoneEntry[], max: number): PhoneEntry[] {
  const out: PhoneEntry[] = []
  let room = max
  for (let i = entries.length - 1; i >= 0 && room > 0; i--) {
    const e = entries[i]!
    if (e.text.length > room) {
      if (!out.length) out.push({ who: e.who, text: `…${e.text.slice(e.text.length - room)}` })
      break
    }
    out.push(e)
    room -= e.text.length
  }
  return out.reverse()
}

function activityOf(a: Activity | undefined, redact: (t: string) => string): PhoneActivity | undefined {
  if (!a) return undefined
  return {
    phase: a.phase,
    since: new Date(a.since).toISOString(),
    ...("tool" in a ? { tool: a.tool } : {}),
    ...("target" in a && a.target ? { target: redact(a.target) } : {}),
    ...(a.phase === "preparing" ? { chars: a.chars } : {}),
  }
}

const bytes = (s: PhoneSessions) => Buffer.byteLength(JSON.stringify(s), "utf8")

/** Takes the oldest steps off the longest conversations until the snapshot fits the Relay. */
function fit(snapshot: PhoneSessions): PhoneSessions {
  while (bytes(snapshot) > PHONE_SNAPSHOT_BYTES) {
    const longest = snapshot.sessions
      .filter((s) => s.recent?.length)
      .sort((a, b) => JSON.stringify(b.recent).length - JSON.stringify(a.recent).length)[0]
    if (longest) longest.recent!.splice(0, Math.max(1, Math.ceil(longest.recent!.length / 4)))
    else {
      const wordy = snapshot.sessions.find((s) => s.latest)
      if (!wordy) break
      wordy.latest = ""
    }
  }
  return snapshot
}

/** The snapshot: open sessions, newest first, each redacted, with what it is doing and its latest steps. */
export async function buildPhoneSessions(d: PhoneSessionsDeps): Promise<PhoneSessions> {
  const open = d
    .list()
    .filter((s) => s.state !== "ended" && !s.archived && !s.evaluation)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_PHONE_SESSIONS)
  d.live?.retain(new Set(open.map((s) => s.id)))
  const read = (s: SessionInfo) =>
    s.sdkSessionId ? d.messages(s.sdkSessionId, s.cwd).catch(() => []) : Promise.resolve([])
  const sessions = await Promise.all(
    open.map(async (s, i) => {
      let entries: PhoneEntry[]
      if (d.live) {
        if (!d.live.isSeeded(s.id) && s.sdkSessionId) d.live.seed(s.id, await read(s))
        entries = d.live.entries(s.id)
      } else entries = (await read(s)).flatMap((m) => entriesOf(m))
      const watched = i < 3 || s.state === "running" || s.state === "waiting"
      const recent = latestSteps(entries, watched ? PHONE_RECENT_CHARS : PHONE_RECENT_QUIET_CHARS).map((e) => ({
        who: e.who,
        text: d.redact(e.text),
      }))
      const activity =
        s.state === "running" || s.state === "waiting" ? activityOf(d.live?.activity(s.id), d.redact) : undefined
      return {
        id: s.id,
        project: d.redact(s.project),
        ...(s.title ? { title: d.redact(s.title) } : {}),
        state: s.paused ? "paused" : s.state,
        mode: s.extreme ? "extreme" : s.mode,
        waiting: s.pendingApprovals,
        latest: d.redact(excerptOf(entries, PHONE_EXCERPT_CHARS)),
        ...(activity ? { activity } : {}),
        ...(recent.length ? { recent } : {}),
      }
    }),
  )
  const templates = (d.templates?.() ?? []).map((t) => ({ id: t.id, name: d.redact(t.name) }))
  return fit({
    at: (d.now ?? (() => new Date()))().toISOString(),
    sessions,
    ...(templates.length ? { templates } : {}),
  })
}

/**
 * Shares the snapshot when told something changed, never more than once in MIN_GAP_MS, and every EVERY_MS anyway.
 * A change while a share is under way is shared after it. A failure is logged and tried again next time; it never
 * touches a session.
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
  #again = false

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
    if (this.#busy) {
      this.#again = true
      return
    }
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
    this.#again = false
    this.#last = Date.now()
    try {
      await this.#share(await this.#build())
    } catch (e) {
      this.#log(`sessions not shared with the phone: ${(e as Error).message}`)
    } finally {
      this.#busy = false
    }
    if (this.#again) this.poke()
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
