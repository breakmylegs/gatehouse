import type { FastifyInstance, FastifyReply } from "fastify"
import { redactString } from "@gatehouse/policy"
import type { GatehouseConfig } from "@gatehouse/shared/node"
import type { HostAudit } from "./hostaudit.js"
import { correctText, mergeRules, projectRules, readRules } from "./writing-rules.js"

/** The most text one export sends to be redacted. */
export const MAX_EXPORT_CHARS = 20_000_000
const FORMATS = new Set(["md", "html", "pdf"])

const bad = (reply: FastifyReply, status: number, error: string) =>
  reply.code(status).send({ error })

/**
 * An export goes through the Host before it is saved (W1-13): your redaction list and the built-in secret patterns
 * are masked, the preview shows exactly what will be saved, and each export is in the audit log, with how much
 * was masked and never the text itself.
 */
export function registerExportRoutes(
  app: FastifyInstance,
  ctx: { audit: HostAudit; config: () => GatehouseConfig; sessionCwd?: (sessionId: string) => string | undefined },
): void {
  app.post("/api/export/redact", { bodyLimit: 64 * 1024 * 1024 }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const text = typeof b.text === "string" ? b.text : undefined
    const format = typeof b.format === "string" ? b.format : ""
    if (text === undefined || text.length > MAX_EXPORT_CHARS)
      return bad(reply, 400, "Send the conversation as text, at most 20 million characters.")
    if (!FORMATS.has(format)) return bad(reply, 400, "The format is md, html or pdf.")
    const terms = ctx.config().redactTerms ?? []
    const redacted = redactString(text, { terms })
    const count = (s: string) => s.split("[REDACTED:").length - 1
    const masked = Math.max(0, count(redacted) - count(text))
    // E-086: this computer's writing rules and the session's project's, applied to the prose (never code); the
    // preview lists each change and any banned term, which is not replaced.
    const session = typeof b.session === "string" ? b.session : ""
    const rules = mergeRules(readRules(ctx.config().writingRules), projectRules(session ? ctx.sessionCwd?.(session) : undefined))
    const { text: out, changes, banned } = correctText(redacted, rules)
    // The preview is not an export: only saving is recorded, with the format chosen.
    if (b.preview === true) return { text: out, masked, changes, banned }
    const written = await ctx.audit.record({
      session: typeof b.session === "string" && b.session ? b.session : "desktop",
      event: "conversation_exported",
      channel: "desktop",
      tool: "export",
      input: {
        title: typeof b.title === "string" ? b.title.slice(0, 200) : "",
        format,
        chars: out.length,
        masked,
        corrected: changes.reduce((n, c) => n + c.count, 0),
      },
      verdict: {
        outcome: "allow",
        ruleId: "conversation-exported",
        reason: "A conversation was exported from the desktop, with your redaction list applied.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: "",
      },
      latencyMs: 0,
    })
    // Nothing leaves that the audit could not record.
    if (!written) return bad(reply, 503, "The export could not be recorded, so it was not made.")
    return { text: out, masked, changes, banned }
  })
}
