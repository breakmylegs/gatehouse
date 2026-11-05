import { randomUUID } from "node:crypto"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { HostAudit } from "../hostaudit.js"
import type { ChatStore } from "./db.js"
import {
  seedDocument,
  splitForBudget,
  tokensFor,
  type SeedOptions,
  type SeedTurn,
} from "./continue.js"

export interface ContinueDeps {
  store: ChatStore
  /** Turns kept word for word and the history budget, from Settings. */
  options: () => SeedOptions
  /** Invariant 12: before anything is sent. */
  redact: (text: string) => string
  /** A separate, labelled call that sums up the earlier part of a long history. */
  summarise: (turns: SeedTurn[]) => Promise<string>
  /** Starts the new chat with the seed in its instructions, through the organisation guard; its session id. */
  start: (o: {
    title: string
    seed: string
    forkOf: { conversation: string; message: string }
  }) => Promise<string>
  audit: HostAudit
  policyHash: () => string
  now?: () => number
}

interface Preview {
  conversation: string
  leaf: string
  title: string
  seed: string
  withInstructions: boolean
  withMemory: boolean
  summarised: boolean
  at: number
}

/** A preview is good for half an hour: what you saw is exactly what is sent. */
const PREVIEW_MS = 30 * 60_000

const textOf = (blocks: Array<{ type: string; text?: unknown }>) =>
  blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n\n")
    .trim()

/**
 * Continue locally (CH-07). The preview builds exactly what the new chat would be given and keeps it; Trust and
 * continue starts the chat with that and nothing else, records it as a fork of the imported chat, and audits the
 * fork, your choices and the size of what was sent.
 */
export function registerContinueRoutes(app: FastifyInstance, d: ContinueDeps): void {
  const previews = new Map<string, Preview>()
  const now = () => (d.now ?? Date.now)()

  app.post("/api/chat/continue/preview", async (req, reply) => {
    const b = z
      .object({
        conversation: z.string().max(100),
        withInstructions: z.boolean(),
        withMemory: z.boolean(),
      })
      .safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: "not a chat" })
    const c = d.store.conversation(b.data.conversation)
    if (!c || c.provenance.kind !== "imported")
      return reply
        .code(404)
        .send({ error: "Only a chat imported from claude.ai is continued here." })
    const steps = d.store.branch(c.id)
    const turns: SeedTurn[] = steps
      .filter((s) => s.message.role !== "system")
      .map((s) => ({
        who: s.message.role === "user" ? ("you" as const) : ("claude" as const),
        text: d.redact(textOf(s.message.blocks)),
      }))
      .filter((t) => t.text)
    const leaf = steps.at(-1)
    if (!turns.length || !leaf)
      return reply.code(422).send({ error: "That chat has nothing to carry on from." })
    const { earlier, kept } = splitForBudget(turns, d.options())
    const summary = earlier.length ? d.redact(await d.summarise(earlier)) : undefined
    const instructions = c.projectId ? d.store.projectInstructions(c.projectId) : undefined
    const memory = d.store.importedMemory().map((m) => d.redact(m))
    const seed = seedDocument({
      title: c.title,
      kept,
      ...(summary ? { summary } : {}),
      ...(b.data.withInstructions && instructions ? { instructions: d.redact(instructions) } : {}),
      ...(b.data.withMemory && memory.length ? { memory } : {}),
    })
    const id = randomUUID()
    for (const [k, p] of previews) if (now() - p.at > PREVIEW_MS) previews.delete(k)
    previews.set(id, {
      conversation: c.id,
      leaf: leaf.message.id,
      title: c.title,
      seed,
      withInstructions: b.data.withInstructions && !!instructions,
      withMemory: b.data.withMemory && memory.length > 0,
      summarised: earlier.length > 0,
      at: now(),
    })
    return {
      previewId: id,
      seed,
      chars: seed.length,
      tokens: tokensFor(seed.length),
      summarised: earlier.length > 0,
      ...(summary ? { summary } : {}),
      turnsKept: kept.length,
      instructionsAvailable: !!instructions,
      memoryAvailable: memory.length,
    }
  })

  app.post("/api/chat/continue", async (req, reply) => {
    const b = z.object({ previewId: z.string().max(100) }).safeParse(req.body)
    const p = b.success ? previews.get(b.data.previewId) : undefined
    if (!p || now() - p.at > PREVIEW_MS)
      return reply
        .code(410)
        .send({ error: "That preview has expired. Open Continue locally again." })
    previews.delete(b.data!.previewId)
    const leafSource = d.store.message(p.leaf)
    const sessionId = await d.start({
      title: p.title,
      seed: p.seed,
      forkOf: { conversation: p.conversation, message: leafSource?.id ?? p.leaf },
    })
    await d.audit.record({
      session: sessionId,
      event: "chat_fork",
      channel: "desktop",
      tool: "continue-locally",
      input: {
        conversation: p.conversation,
        withInstructions: p.withInstructions,
        withMemory: p.withMemory,
        seedChars: p.seed.length,
        summarised: p.summarised,
      },
      verdict: {
        outcome: "allow",
        ruleId: "chat-fork",
        reason:
          "You carried an imported claude.ai chat on as a new chat here, after seeing what would be sent.",
        risk: 0,
        decidedBy: "human-desktop",
        policyHash: d.policyHash(),
      },
      latencyMs: 0,
    })
    return { sessionId }
  })
}
