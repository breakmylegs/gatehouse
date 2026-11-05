import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { HostAudit } from "./hostaudit.js"
import type { RecapInput, RecapWriter } from "./recap-writer.js"

export interface RecapDeps {
  writer: RecapWriter
  /** Settings, Notifications: whether Claude writes the recap. On unless turned off. */
  enabled: () => boolean
  /** The session as the Host knows it: its project, and whether it runs on a model on this computer. */
  session: (id: string) => { project: string; local?: boolean } | undefined
  /** Invariant 14: the signed-in account passed the organisation check. */
  orgOk: () => boolean
  /** Invariant 12: before anything is sent. */
  redact: (text: string) => string
  audit: HostAudit
  policyHash: () => string
  now?: () => number
}

const Body = z.object({
  session: z.string().min(1).max(100),
  /** When you went away, so one absence gets one recap. */
  since: z.number().int().nonnegative(),
  minutes: z.number().int().min(0).max(100_000),
  state: z.string().max(60),
  waiting: z.number().int().min(0).max(1000),
  lines: z
    .array(z.object({ who: z.enum(["you", "claude"]), text: z.string().max(20_000) }))
    .max(400),
})

/** A recap is kept for its absence, and an absence asks at most once a minute. */
const KEEP = 200

/**
 * POST /api/recap: While you were away, written by Claude (owner, 4 Nov). It answers { summary } or { skipped } with a
 * reason, and the screen keeps its own list whenever there is no summary. Each one written is audited by session, size
 * and model, never by its words.
 */
export function registerRecapRoutes(app: FastifyInstance, d: RecapDeps): void {
  const done = new Map<string, Promise<string>>()
  app.post("/api/recap", async (req, reply) => {
    const b = Body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: "not a recap" })
    const { session, since } = b.data
    if (!d.enabled()) return { skipped: "off" }
    const s = d.session(session)
    if (!s) return reply.code(404).send({ error: "There is no such session." })
    // A model on this computer keeps its words on this computer: nothing is sent for it.
    if (s.local) return { skipped: "local" }
    if (!d.orgOk()) return { skipped: "account" }
    const lines = b.data.lines
      .map((l) => ({ who: l.who, text: d.redact(l.text) }))
      .filter((l) => l.text.trim())
    if (!lines.length) return { skipped: "nothing" }
    const key = `${session}@${since}`
    let writing = done.get(key)
    if (!writing) {
      const input: RecapInput = {
        project: d.redact(s.project),
        minutes: b.data.minutes,
        state: b.data.state,
        waiting: b.data.waiting,
        lines,
      }
      writing = d.writer(input)
      done.set(key, writing)
      if (done.size > KEEP) done.delete(done.keys().next().value!)
      writing.catch(() => done.delete(key))
      void d.audit.record({
        session,
        event: "recap_written",
        channel: "host",
        tool: "recap",
        input: { lines: lines.length, chars: lines.reduce((n, l) => n + l.text.length, 0) },
        verdict: {
          outcome: "allow",
          ruleId: "recap",
          reason: "Claude wrote the While you were away note from this session's messages.",
          risk: 0,
          decidedBy: "rules",
          policyHash: d.policyHash(),
        },
        latencyMs: 0,
      })
    }
    try {
      return { summary: await writing }
    } catch {
      return { skipped: "failed" }
    }
  })
}
