import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { ChatStoreError, type ChatStore } from "./db.js"
import type { ChatRecorder } from "./recorder.js"

export interface ChatDeps {
  store: ChatStore
  recorder: ChatRecorder
}

const Kind = z.enum(["native", "imported", "fork"])

/**
 * Chat's store over the admin API (CH-03): the branch a chat shows with its siblings for the "2 of 3" navigator,
 * switching to a sibling, the conversation list and search. Behind the Host's usual guard (invariant 7).
 */
export function registerChatRoutes(app: FastifyInstance, chat: ChatDeps): void {
  app.get("/api/chat/branch", async (req) => {
    const q = z.object({ session: z.string().max(100) }).safeParse(req.query)
    const conversation = q.success ? chat.recorder.conversationOf(q.data.session) : undefined
    if (!conversation) return { steps: [] }
    return {
      conversation,
      steps: chat.store.branch(conversation).map((s) => ({
        id: s.message.id,
        role: s.message.role,
        index: s.index,
        siblings: s.siblings,
      })),
    }
  })

  /** Shows the branch through a sibling. The screen then opens the SDK session that branch ends in. */
  app.post("/api/chat/switch", async (req, reply) => {
    const b = z
      .object({ session: z.string().max(100), messageId: z.string().max(100) })
      .safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: "not a branch" })
    const conversation = chat.recorder.conversationOf(b.data.session)
    if (!conversation) return reply.code(404).send({ error: "This chat has no branches yet." })
    try {
      const leaf = chat.store.switchTo(conversation, b.data.messageId)
      const m = chat.store.message(leaf)
      if (!m?.sdkSessionId)
        return reply
          .code(409)
          .send({ error: "That branch cannot be opened: it was made before branches were kept." })
      return { leaf, sdkSessionId: m.sdkSessionId }
    } catch (e) {
      if (e instanceof ChatStoreError) return reply.code(404).send({ error: e.message })
      throw e
    }
  })

  /** Where a conversation's shown branch ends, so the screen can open it (a search hit, the sidebar). */
  app.post("/api/chat/open", async (req, reply) => {
    const b = z.object({ conversation: z.string().max(100) }).safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: "not a conversation" })
    const steps = chat.store.branch(b.data.conversation)
    const end = [...steps].reverse().find((s) => s.message.sdkSessionId && s.message.cwd)?.message
    if (!end) return reply.code(404).send({ error: "That chat cannot be opened from here." })
    return { sdkSessionId: end.sdkSessionId, cwd: end.cwd }
  })

  app.get("/api/chat/conversations", async (req) => {
    const q = z
      .object({ kind: Kind.optional(), limit: z.coerce.number().int().min(1).max(1000).optional() })
      .safeParse(req.query)
    return { conversations: chat.store.listConversations(q.success ? q.data : {}) }
  })

  app.get("/api/chat/search", async (req) => {
    const q = z.object({ q: z.string().max(500), kind: Kind.optional() }).safeParse(req.query)
    if (!q.success) return { hits: [] }
    return { hits: chat.store.search(q.data.q, q.data.kind ? { kind: q.data.kind } : {}) }
  })
}
