import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { HostAudit } from "./hostaudit.js"
import type { TitleWriter } from "./title-writer.js"

export interface TitleDeps {
  writer: TitleWriter
  /** Settings, Sessions: whether Claude names sessions. On unless turned off. */
  enabled: () => boolean
  /** Your instructions for titles, from Settings. */
  instructions: () => string | undefined
  session: (id: string) => { project: string; local?: boolean } | undefined
  /** Invariant 14: the signed-in account passed the organisation check. */
  orgOk: () => boolean
  /** Invariant 12: before anything is sent. */
  redact: (text: string) => string
  audit: HostAudit
  policyHash: () => string
}

const Body = z.object({
  session: z.string().min(1).max(100),
  lines: z
    .array(z.object({ who: z.enum(["you", "claude"]), text: z.string().max(20_000) }))
    .min(1)
    .max(6),
})

/**
 * POST /api/title (T-018, T-019): a title for a session from its first exchange, or { skipped } with why. Recorded
 * before it is asked for, by session and size, never by its words.
 */
export function registerTitleRoutes(app: FastifyInstance, d: TitleDeps): void {
  app.post("/api/title", async (req, reply) => {
    const b = Body.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: "not a title request" })
    if (!d.enabled()) return { skipped: "off" }
    const s = d.session(b.data.session)
    if (!s) return reply.code(404).send({ error: "There is no such session." })
    // A model on this computer keeps its words on this computer: nothing is sent for it.
    if (s.local) return { skipped: "local" }
    if (!d.orgOk()) return { skipped: "account" }
    const lines = b.data.lines.map((l) => ({ who: l.who, text: d.redact(l.text) })).filter((l) => l.text.trim())
    if (!lines.length) return { skipped: "nothing" }
    const written = await d.audit.record({
      session: b.data.session,
      event: "title_written",
      channel: "host",
      tool: "title",
      input: { lines: lines.length, chars: lines.reduce((n, l) => n + l.text.length, 0) },
      verdict: {
        outcome: "allow",
        ruleId: "title",
        reason: "Claude named this session from its first messages.",
        risk: 0,
        decidedBy: "rules",
        policyHash: d.policyHash(),
      },
      latencyMs: 0,
    })
    if (!written) return { skipped: "audit" }
    const yours = d.instructions()
    try {
      return {
        title: await d.writer({
          project: d.redact(s.project),
          lines,
          ...(yours?.trim() ? { instructions: d.redact(yours) } : {}),
        }),
      }
    } catch {
      return { skipped: "failed" }
    }
  })
}
