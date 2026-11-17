/**
 * O42 (owner, 16 Nov): "For every session I want AI to produce a summary every 10 mins. The user doesnt see this unless
 * they want to. To see the summary there is a timeline button on the bar at the top." The Host notes what each session
 * does as it happens (your messages, what Claude writes, the tools it runs), and every ten minutes Claude sums up each
 * session that did something since its last summary: one short paragraph, kept with when it was written and the time
 * it covers. Like the recap: redacted before it is sent (invariant 12), never for a session on a model on this computer
 * (its words stay here), only for an account that passed the organisation check (invariant 14), recorded by size,
 * never by its words (invariant 13). Off in Settings, Sessions, Timeline, when you would rather it spent nothing.
 *
 * Kept in timelines/<session>.json in the data folder, read tolerantly, the last 500 summaries of each session.
 */
import fs from "node:fs"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { writeFileAtomic } from "@gatehouse/shared/node"
import type { HostAudit } from "./hostaudit.js"

export const TIMELINE_EVERY_MS = 10 * 60_000
const KEEP = 500
/** The most of one period's activity that is read, its latest part. */
const MAX_CHARS = 30_000

export interface TimelineNode {
  /** When it was written: the node's date and time. */
  at: string
  /** The start of the time it covers. */
  from: string
  summary: string
  /** How much happened, so the strip can show it without reading the words. */
  activity: { you: number; claude: number; tools: number }
}

export interface TimelineLine {
  who: "you" | "claude" | "tool"
  text: string
}

export type TimelineWriter = (input: { project: string; minutes: number; lines: TimelineLine[] }) => Promise<string>

export interface TimelineDeps {
  dir: string
  writer: TimelineWriter
  /** Settings: on unless turned off. */
  enabled: () => boolean
  session: (id: string) => { project: string; local?: boolean; evaluation?: boolean } | undefined
  orgOk: () => boolean
  redact: (text: string) => string
  audit: Pick<HostAudit, "record">
  policyHash: () => string
  log: (line: string) => void
  now?: () => number
  everyMs?: number
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** What an SDK message adds to the timeline: Claude's words, and each tool it called with a short look at its target. */
export function linesOf(message: Record<string, unknown>): TimelineLine[] {
  if (message.type !== "assistant") return []
  const content = obj(message.message).content
  if (!Array.isArray(content)) return []
  const out: TimelineLine[] = []
  for (const c of content.map(obj)) {
    if (c.type === "text" && typeof c.text === "string" && c.text.trim()) out.push({ who: "claude", text: c.text })
    else if (c.type === "tool_use" && typeof c.name === "string") {
      const input = obj(c.input)
      const target = [input.command, input.file_path, input.path, input.pattern, input.url, input.description].find(
        (v): v is string => typeof v === "string" && v.length > 0,
      )
      out.push({ who: "tool", text: `${c.name}${target ? `: ${target.slice(0, 160)}` : ""}` })
    }
  }
  return out
}

export class SessionTimeline {
  readonly #d: TimelineDeps
  readonly #pending = new Map<string, { from: number; lines: TimelineLine[] }>()
  #timer: NodeJS.Timeout | undefined
  #busy = false

  constructor(d: TimelineDeps) {
    this.#d = d
  }

  #now(): number {
    return (this.#d.now ?? Date.now)()
  }

  #file(id: string): string {
    return path.join(this.#d.dir, `${id.replace(/[^A-Za-z0-9-]/g, "_")}.json`)
  }

  /** Something the session did: kept until the next summary. */
  note(sessionId: string, line: TimelineLine): void {
    if (!line.text.trim()) return
    const p = this.#pending.get(sessionId) ?? { from: this.#now(), lines: [] }
    p.lines.push({ who: line.who, text: line.text })
    // Only the latest part of a busy period is read.
    let size = p.lines.reduce((n, l) => n + l.text.length, 0)
    while (size > MAX_CHARS && p.lines.length > 1) size -= p.lines.shift()!.text.length
    this.#pending.set(sessionId, p)
  }

  message(sessionId: string, message: Record<string, unknown>): void {
    for (const l of linesOf(message)) this.note(sessionId, l)
  }

  /** The summaries of a session so far, oldest first. */
  list(sessionId: string): TimelineNode[] {
    try {
      const j = JSON.parse(fs.readFileSync(this.#file(sessionId), "utf8")) as { nodes?: unknown }
      return (Array.isArray(j.nodes) ? j.nodes : []).filter(
        (n): n is TimelineNode =>
          !!n && typeof n === "object" && typeof (n as TimelineNode).at === "string" && typeof (n as TimelineNode).summary === "string",
      )
    } catch {
      return []
    }
  }

  /** Sums up every session that did something since its last summary. One look at a time. */
  async tick(): Promise<number> {
    if (this.#busy) return 0
    this.#busy = true
    let written = 0
    try {
      for (const [id, p] of [...this.#pending]) {
        this.#pending.delete(id)
        const s = this.#d.session(id)
        // Off, gone, an evaluation, a model on this computer, or an account that did not pass: nothing is sent.
        if (!this.#d.enabled() || !s || s.evaluation || s.local || !this.#d.orgOk()) continue
        const lines = p.lines.map((l) => ({ who: l.who, text: this.#d.redact(l.text) })).filter((l) => l.text.trim())
        if (!lines.length) continue
        const at = this.#now()
        let summary: string
        try {
          summary = await this.#d.writer({ project: this.#d.redact(s.project), minutes: Math.max(1, Math.round((at - p.from) / 60_000)), lines })
        } catch (e) {
          this.#d.log(`timeline: ${id}: the summary could not be written: ${(e as Error).message}`)
          continue
        }
        const node: TimelineNode = {
          at: new Date(at).toISOString(),
          from: new Date(p.from).toISOString(),
          summary: this.#d.redact(summary),
          activity: {
            you: lines.filter((l) => l.who === "you").length,
            claude: lines.filter((l) => l.who === "claude").length,
            tools: lines.filter((l) => l.who === "tool").length,
          },
        }
        fs.mkdirSync(this.#d.dir, { recursive: true })
        await writeFileAtomic(this.#file(id), JSON.stringify({ nodes: [...this.list(id), node].slice(-KEEP) }))
        written++
        void this.#d.audit
          .record({
            session: id,
            event: "timeline_summary_written",
            channel: "host",
            tool: "timeline",
            input: { lines: lines.length, chars: lines.reduce((n, l) => n + l.text.length, 0) },
            verdict: {
              outcome: "allow",
              ruleId: "timeline",
              reason: "Claude summed up the last ten minutes of this session for its timeline.",
              risk: 0,
              decidedBy: "rules",
              policyHash: this.#d.policyHash(),
            },
            latencyMs: 0,
          })
          .catch(() => false)
      }
    } finally {
      this.#busy = false
    }
    return written
  }

  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.tick(), this.#d.everyMs ?? TIMELINE_EVERY_MS)
    this.#timer.unref?.()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }
}

/** GET /api/sessions/:id/timeline: a session's summaries, oldest first, and whether they are being written. */
export function registerTimelineRoutes(
  app: FastifyInstance,
  d: { timeline: SessionTimeline; enabled: () => boolean; exists: (id: string) => boolean },
): void {
  app.get("/api/sessions/:id/timeline", async (req, reply) => {
    const id = String((req.params as { id: string }).id)
    if (!/^[A-Za-z0-9-]{1,100}$/.test(id)) return reply.code(400).send({ error: "That is not a session id." })
    const nodes = d.timeline.list(id)
    if (!nodes.length && !d.exists(id)) return reply.code(404).send({ error: "There is no such session." })
    return { nodes, everyMinutes: TIMELINE_EVERY_MS / 60_000, enabled: d.enabled() }
  })
}
