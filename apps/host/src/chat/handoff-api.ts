import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { HostAudit } from "../hostaudit.js"
import type { ChatStore } from "./db.js"
import {
  handOff,
  HandoffError,
  handoffUrl,
  type HandoffSettings,
  type Launcher,
} from "./handoff.js"

export interface HandoffDeps {
  store: ChatStore
  settings: () => HandoffSettings
  launcher: Launcher
  findEdge: () => Promise<string | undefined>
  hasAppLink: () => Promise<boolean>
  audit: HostAudit
  policyHash: () => string
}

/**
 * POST /api/chat/handoff (CH-06): Open in Claude for an imported chat, or a new chat in claude.ai. The address comes
 * from the chat's own claude.ai id, never from the request; each hand-off is audited with its target and address.
 */
export function registerHandoffRoutes(app: FastifyInstance, d: HandoffDeps): void {
  app.post("/api/chat/handoff", async (req, reply) => {
    const b = z
      .object({ conversation: z.string().max(100).optional(), new: z.boolean().optional() })
      .safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: "not a chat" })
    let url: string
    try {
      if (b.data.new) url = handoffUrl("new", undefined, d.settings().templates)
      else {
        const c = b.data.conversation ? d.store.conversation(b.data.conversation) : undefined
        const uuid = c?.provenance.kind === "imported" ? c.provenance.sourceUuid : undefined
        if (!uuid)
          return reply.code(404).send({ error: "Only a chat imported from claude.ai opens there." })
        url = handoffUrl("chat", uuid, d.settings().templates)
      }
      const done = await handOff(url, d.settings(), {
        launcher: d.launcher,
        findEdge: d.findEdge,
        hasAppLink: d.hasAppLink,
      })
      await d.audit.record({
        session: "desktop",
        event: "chat_handoff",
        channel: "desktop",
        tool: "open-in-claude",
        input: { target: done.target, url: done.opened },
        verdict: {
          outcome: "allow",
          ruleId: "chat-handoff",
          reason:
            "A chat was opened in claude.ai, in a separate program. Codehouse reads nothing back.",
          risk: 0,
          decidedBy: "human-desktop",
          policyHash: d.policyHash(),
        },
        latencyMs: 0,
      })
      return { ok: true, target: done.target }
    } catch (e) {
      if (e instanceof HandoffError) return reply.code(422).send({ error: e.message })
      throw e
    }
  })
}
